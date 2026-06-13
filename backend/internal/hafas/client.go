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

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

// ErrCircuitOpen is returned when the circuit breaker is in the open state.
var ErrCircuitOpen = errors.New("hafas: circuit breaker open — upstream likely unavailable")

// ErrUpstreamUnavailable is returned for 5xx responses from db.transport.rest.
var ErrUpstreamUnavailable = errors.New("hafas: upstream returned server error")

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

// Client wraps db.transport.rest with a circuit breaker and per-request ID propagation.
type Client struct {
	baseURL string
	http    *http.Client
	cb      *circuitBreaker
}

// NewClient creates a HAFAS client from cfg.
func NewClient(cfg config.Config) *Client {
	return &Client{
		baseURL: cfg.HAFASBaseURL,
		http:    &http.Client{Timeout: cfg.HAFASRequestTimeout},
		cb: &circuitBreaker{
			threshold:     cfg.HAFASCBThreshold,
			probeInterval: cfg.HAFASCBProbeInterval,
		},
	}
}

// CircuitState returns 0=closed, 1=half-open, 2=open. Used for Prometheus gauge in Plan 4.
func (c *Client) CircuitState() int {
	c.cb.mu.Lock()
	defer c.cb.mu.Unlock()
	return int(c.cb.state)
}

// SearchStations searches db.transport.rest /locations for stops matching query.
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

// SearchTrips searches db.transport.rest /trips for trips matching trainName (e.g. "ICE 123").
func (c *Client) SearchTrips(ctx context.Context, trainName string, results int) ([]HAFASTrip, error) {
	params := url.Values{
		"query":     {trainName},
		"results":   {fmt.Sprintf("%d", results)},
		"stopovers": {"true"},
		"polyline":  {"false"},
	}
	var resp HAFASTripsResponse
	return resp.Trips, c.withCB(ctx, "/trips", params, &resp)
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

// GetTrip fetches realtime data for a specific trip ID.
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
		c.cb.recordFailure()
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
		io.Copy(io.Discard, resp.Body) // drain so connection can be reused
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
