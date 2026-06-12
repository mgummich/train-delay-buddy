package middleware_test

import (
	"context"
	"testing"

	"github.com/redis/go-redis/v9"

	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

// failingRedis returns the zero-value Redis client whose dialer points at a
// closed socket — every command errors. Used to confirm fail-open behaviour.
func failingRedis() *redis.Client {
	return redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
}

func TestRedisLimiter_FailsOpenOnRedisOutage(t *testing.T) {
	rl := mw.NewRedisLimiter(failingRedis(), 5, "rl:test")

	allowed, remaining := rl.Allow(context.Background(), "key-1")
	if !allowed {
		t.Fatal("RedisLimiter must fail open on backend error to avoid locking out all users")
	}
	if remaining != 5 {
		t.Errorf("expected remaining=limit on failure, got %d", remaining)
	}
}
