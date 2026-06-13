package hafas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

// ErrCircuitOpen is returned when the circuit breaker is in the open state.
var ErrCircuitOpen = errors.New("hafas: circuit breaker open — upstream likely unavailable")

// ErrUpstreamUnavailable is returned for 5xx responses from the HAFAS backend.
var ErrUpstreamUnavailable = errors.New("hafas: upstream returned server error")

// germanyHubs is the set of major German rail hubs queried in parallel when
// searching for a trip by line name. Covers virtually all ICE/IC routes.
var germanyHubs = []string{
	"8011160", // Berlin Hbf
	"8002549", // Hamburg Hbf
	"8000105", // Frankfurt(Main)Hbf
	"8000261", // München Hbf
	"8000207", // Köln Hbf
	"8000152", // Hannover Hbf
	"8000096", // Stuttgart Hbf
	"8000080", // Dortmund Hbf
	"8000284", // Nürnberg Hbf
	"8010205", // Leipzig Hbf
}

type cbState int

const (
	cbClosed   cbState = 0
	cbHalfOpen cbState = 1
	cbOpen     cbState = 2
)

type circuitBreaker struct {
	mu            sync.Mutex
	failures      int
	threshold     int
	state         cbState
	lastFailure   time.Time
	probeInterval time.Duration
}

func (cb *circuitBreaker) allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	switch cb.state {
	case cbOpen:
		if time.Since(cb.lastFailure) >= cb.probeInterval {
			cb.state = cbHalfOpen
			return true
		}
		return false
	default:
		return true
	}
}

func (cb *circuitBreaker) recordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures = 0
	cb.state = cbClosed
}

func (cb *circuitBreaker) recordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures++
	cb.lastFailure = time.Now()
	if cb.failures >= cb.threshold || cb.state == cbHalfOpen {
		cb.state = cbOpen
	}
}

// Client wraps the HAFAS REST backend with a circuit breaker, Redis cache,
// and per-request ID propagation.
type Client struct {
	baseURL string
	http    *http.Client
	cb      *circuitBreaker
	redis   *redis.Client // nil = no caching
	sf      singleflight.Group
}

// NewClient creates a HAFAS client. rdb may be nil to disable Redis caching.
func NewClient(cfg config.Config, rdb *redis.Client) *Client {
	return &Client{
		baseURL: cfg.HAFASBaseURL,
		http:    &http.Client{Timeout: cfg.HAFASRequestTimeout},
		cb: &circuitBreaker{
			threshold:     cfg.HAFASCBThreshold,
			probeInterval: cfg.HAFASCBProbeInterval,
		},
		redis: rdb,
	}
}

// CircuitState returns 0=closed, 1=half-open, 2=open.
func (c *Client) CircuitState() int {
	c.cb.mu.Lock()
	defer c.cb.mu.Unlock()
	return int(c.cb.state)
}

// SearchStations searches /locations for stops matching query.
func (c *Client) SearchStations(ctx context.Context, query string, limit int) ([]HAFASLocationResult, error) {
	params := url.Values{
		"query":     {query},
		"results":   {fmt.Sprintf("%d", limit)},
		"stops":     {"true"},
		"addresses": {"false"},
		"poi":       {"false"},
		"language":  {"de"},
	}
	var result []HAFASLocationResult
	return result, c.withCB(ctx, "/locations", params, &result)
}

// SearchTripByLineName finds a trip for the given line name (e.g. "ICE 123") and date
// (YYYY-MM-DD in Europe/Berlin). It queries departure boards at major German hubs in
// parallel, then fetches the full trip stopovers via /trips/{id}.
//
// Returns (nil, nil) when no departure is found at any hub.
// Results for found trips are cached in Redis until midnight Berlin time.
func (c *Client) SearchTripByLineName(ctx context.Context, lineName, date string) (*HAFASTrip, error) {
	normalized := NormalizeTrainNumber(lineName)
	cacheKey := "hafas:train:" + url.QueryEscape(normalized) + ":" + date

	if c.redis != nil {
		if b, err := c.redis.Get(ctx, cacheKey).Bytes(); err == nil {
			var trip HAFASTrip
			if json.Unmarshal(b, &trip) == nil {
				return &trip, nil
			}
		}
	}

	v, err, _ := c.sf.Do(cacheKey, func() (any, error) {
		return c.findTripByNameAtHubs(ctx, normalized, date)
	})
	if err != nil {
		return nil, err
	}

	trip, _ := v.(*HAFASTrip)
	if trip != nil && c.redis != nil {
		if b, marshalErr := json.Marshal(trip); marshalErr == nil {
			cacheCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			c.redis.Set(cacheCtx, cacheKey, b, ttlUntilMidnightBerlin(date)) //nolint:errcheck
		}
	}

	return trip, nil
}

// findTripByNameAtHubs searches hubs sequentially and returns on first match.
// Sequential queries avoid overwhelming the upstream Vendo API's concurrency limit.
func (c *Client) findTripByNameAtHubs(ctx context.Context, normalizedLineName, date string) (*HAFASTrip, error) {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		loc = time.UTC
	}
	startOfDay, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return nil, fmt.Errorf("invalid date %q: %w", date, err)
	}

	var lastErr error
	for _, hubID := range germanyHubs {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		deps, fetchErr := c.fetchDepartures(ctx, hubID, startOfDay, 1440, 300)
		if fetchErr != nil {
			lastErr = fetchErr
			continue
		}
		for i := range deps {
			d := &deps[i]
			if d.Line != nil && NormalizeTrainNumber(d.Line.Name) == normalizedLineName {
				// Fetch full stopovers for the matched trip.
				params := url.Values{"stopovers": {"true"}, "polyline": {"false"}}
				var resp struct {
					Trip HAFASTrip `json:"trip"`
				}
				if err := c.withCB(ctx, "/trips/"+url.PathEscape(d.TripId), params, &resp); err != nil {
					return nil, err
				}
				return &resp.Trip, nil
			}
		}
	}

	if lastErr != nil && lastErr == ctx.Err() {
		return nil, lastErr
	}
	return nil, nil
}

// fetchDepartures fetches the departure board at stopID without going through the
// circuit breaker — hub searches are best-effort and must not trip the CB.
func (c *Client) fetchDepartures(ctx context.Context, stopID string, when time.Time, durationMins, results int) ([]HAFASDeparture, error) {
	params := url.Values{
		"when":     {when.UTC().Format(time.RFC3339)},
		"duration": {fmt.Sprintf("%d", durationMins)},
		"results":  {fmt.Sprintf("%d", results)},
	}
	var resp HAFASDeparturesResponse
	return resp.Departures, c.get(ctx, "/stops/"+stopID+"/departures", params, &resp)
}

// SearchJourneys searches for connections from→to departing after departureAfter.
func (c *Client) SearchJourneys(ctx context.Context, fromID, toID string, departureAfter time.Time, results int) ([]HAFASJourney, error) {
	params := url.Values{
		"from":      {fromID},
		"to":        {toID},
		"departure": {departureAfter.UTC().Format(time.RFC3339)},
		"results":   {fmt.Sprintf("%d", results)},
		"stopovers": {"true"},
		"polyline":  {"false"},
	}
	var resp HAFASJourneysResponse
	return resp.Journeys, c.withCB(ctx, "/journeys", params, &resp)
}

// GetTrip fetches realtime data for a specific trip ID. Never cached.
func (c *Client) GetTrip(ctx context.Context, tripID string) (*HAFASTrip, error) {
	params := url.Values{
		"stopovers": {"true"},
		"polyline":  {"false"},
	}
	var resp struct {
		Trip HAFASTrip `json:"trip"`
	}
	if err := c.withCB(ctx, "/trips/"+url.PathEscape(tripID), params, &resp); err != nil {
		return nil, err
	}
	return &resp.Trip, nil
}

func (c *Client) withCB(ctx context.Context, path string, params url.Values, out any) error {
	if !c.cb.allow() {
		return ErrCircuitOpen
	}
	if err := c.get(ctx, path, params, out); err != nil {
		// Context cancellation is not an upstream failure.
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			c.cb.recordFailure()
		}
		return err
	}
	c.cb.recordSuccess()
	return nil
}

func (c *Client) get(ctx context.Context, path string, params url.Values, out any) error {
	u := c.baseURL + path
	if len(params) > 0 {
		u += "?" + params.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if id := reqid.Get(ctx); id != "" {
		req.Header.Set("X-Request-Id", id)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("hafas fetch: %w", err)
	}
	defer func() {
		io.Copy(io.Discard, resp.Body) //nolint:errcheck
		resp.Body.Close()
	}()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("%w: HTTP %d", ErrUpstreamUnavailable, resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("hafas error: HTTP %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out)
}

func ttlUntilMidnightBerlin(date string) time.Duration {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		loc = time.UTC
	}
	t, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return time.Hour
	}
	ttl := time.Until(t.Add(24 * time.Hour))
	if ttl < time.Minute {
		return time.Minute
	}
	return ttl
}
