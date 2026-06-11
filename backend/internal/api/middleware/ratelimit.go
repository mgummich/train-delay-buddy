package middleware

import (
	"fmt"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimiter is a per-key token-bucket limiter backed by an in-memory map.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rlEntry
	limit   rate.Limit
	burst   int
}

type rlEntry struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

// NewRateLimiter creates a RateLimiter allowing perMinute requests per minute per key.
func NewRateLimiter(perMinute int) *RateLimiter {
	return &RateLimiter{
		entries: make(map[string]*rlEntry),
		limit:   rate.Limit(perMinute) / 60.0,
		burst:   perMinute,
	}
}

// Allow reports whether the key is within its rate limit. Thread-safe.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[key]
	if !ok {
		e = &rlEntry{lim: rate.NewLimiter(rl.limit, rl.burst)}
		rl.entries[key] = e
	}
	e.lastSeen = time.Now()
	return e.lim.Allow()
}

// Remaining returns the approximate remaining token count for key.
// Returns burst capacity for keys not yet seen.
func (rl *RateLimiter) Remaining(key string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if e, ok := rl.entries[key]; ok {
		return int(e.lim.Tokens())
	}
	return rl.burst
}

// Cleanup removes entries not seen in the last olderThan duration.
func (rl *RateLimiter) Cleanup(olderThan time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	cutoff := time.Now().Add(-olderThan)
	for k, e := range rl.entries {
		if e.lastSeen.Before(cutoff) {
			delete(rl.entries, k)
		}
	}
}

// RateLimit returns an HTTP middleware that enforces per-install-id and per-IP limits.
func RateLimit(installLimiter, ipLimiter *RateLimiter, perInstallLimit, perIPLimit int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			installID := r.Header.Get("X-Install-Id")

			var allowed bool
			var limit, remaining int
			if installID != "" {
				allowed = installLimiter.Allow(installID)
				remaining = installLimiter.Remaining(installID)
				limit = perInstallLimit
			} else {
				ip := realIP(r)
				allowed = ipLimiter.Allow(ip)
				remaining = ipLimiter.Remaining(ip)
				limit = perIPLimit
			}

			reset := nextMinuteUnix()
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(reset, 10))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(remaining))

			if !allowed {
				w.Header().Set("Retry-After", "30")
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("Content-Type", "application/problem+json")
				w.Header().Set("Link", `<https://verspaetungsbegleiter.app/errors>; rel="describedby"`)
				w.WriteHeader(http.StatusTooManyRequests)
				fmt.Fprintf(w, `{"type":"urn:verspbegl:error:rate-limit-exceeded","title":"Rate Limit Exceeded","status":429,"instance":%q}`,
					r.URL.Path)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// realIP returns the client IP for rate-limit keying.
// Trusts X-Real-IP (set by nginx from $remote_addr, not forwarded from client).
// Never trusts X-Forwarded-For — it appends client-supplied values and is spoofable.
func realIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func nextMinuteUnix() int64 {
	now := time.Now()
	return now.Truncate(time.Minute).Add(time.Minute).Unix()
}
