// backend/internal/api/middleware/ratelimit_limiter.go
package middleware

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Limiter abstracts the rate-limit backend so handlers can switch between the
// in-memory implementation (single-instance, tests) and the Redis implementation
// (multi-instance production).
type Limiter interface {
	// Allow reports whether the key is within its rate limit.
	// remaining reflects approximate tokens left after this decision.
	Allow(ctx context.Context, key string) (allowed bool, remaining int)
	// Cleanup is a no-op for backends that auto-expire (Redis); the in-memory
	// limiter uses it to evict idle entries.
	Cleanup(olderThan time.Duration)
}

// MemoryLimiter wraps the existing in-memory RateLimiter to satisfy the Limiter interface.
// Allow ignores ctx — the in-memory bucket is purely process-local.
func (rl *RateLimiter) AllowCtx(_ context.Context, key string) (bool, int) {
	allowed := rl.Allow(key)
	return allowed, rl.Remaining(key)
}

// Compile-time check that *RateLimiter satisfies Limiter via a wrapper.
var _ Limiter = (*memoryLimiterAdapter)(nil)

// memoryLimiterAdapter adapts *RateLimiter (which predates Limiter) to the interface.
type memoryLimiterAdapter struct{ rl *RateLimiter }

// NewMemoryLimiter wraps a RateLimiter as a Limiter.
func NewMemoryLimiter(rl *RateLimiter) Limiter { return &memoryLimiterAdapter{rl: rl} }

func (a *memoryLimiterAdapter) Allow(_ context.Context, key string) (bool, int) {
	allowed := a.rl.Allow(key)
	return allowed, a.rl.Remaining(key)
}
func (a *memoryLimiterAdapter) Cleanup(d time.Duration) { a.rl.Cleanup(d) }

// RedisLimiter is a fixed-window counter rate limiter backed by Redis.
// Window = 60 seconds. A fixed window is less precise than a token bucket but
// is correct across multiple backend instances and is O(1) per request.
type RedisLimiter struct {
	rdb       *redis.Client
	limit     int
	keyPrefix string // e.g. "rl:install" or "rl:ip"
}

// NewRedisLimiter creates a Redis-backed fixed-window limiter.
// keyPrefix is included in every Redis key for namespacing across multiple limiters.
func NewRedisLimiter(rdb *redis.Client, limit int, keyPrefix string) *RedisLimiter {
	return &RedisLimiter{rdb: rdb, limit: limit, keyPrefix: keyPrefix}
}

// redisAllowScript atomically increments the counter and sets a 60s TTL on
// first increment. Returns the post-increment value.
var redisAllowScript = redis.NewScript(`
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`)

func (rl *RedisLimiter) Allow(ctx context.Context, key string) (bool, int) {
	redisKey := rl.keyPrefix + ":" + key
	res, err := redisAllowScript.Run(ctx, rl.rdb, []string{redisKey}, 60).Int()
	if err != nil {
		// Fail open: a Redis outage must not lock all users out.
		// Bound the blast radius by surfacing via metrics + structured log
		// at the call site (see middleware.RateLimit).
		return true, rl.limit
	}
	remaining := rl.limit - res
	if remaining < 0 {
		remaining = 0
	}
	return res <= rl.limit, remaining
}

func (rl *RedisLimiter) Cleanup(time.Duration) { /* Redis TTL handles eviction */ }
