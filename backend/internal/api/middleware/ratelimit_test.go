package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

func TestRateLimiter_AllowsUnderBurst(t *testing.T) {
	rl := middleware.NewRateLimiter(60)
	for range 5 {
		if !rl.Allow("user-1") {
			t.Fatal("expected Allow=true for first 5 requests (burst=60)")
		}
	}
}

func TestRateLimiter_BlocksOverBurst(t *testing.T) {
	rl := middleware.NewRateLimiter(5)
	allowed := 0
	for range 20 {
		if rl.Allow("user-1") {
			allowed++
		}
	}
	if allowed > 5 {
		t.Errorf("expected ≤5 allowed with burst=5, got %d", allowed)
	}
}

func TestRateLimiter_IsolatesKeys(t *testing.T) {
	rl := middleware.NewRateLimiter(1)
	if !rl.Allow("user-a") {
		t.Fatal("first call for user-a must be allowed")
	}
	if rl.Allow("user-a") {
		t.Fatal("second call for user-a must be blocked (burst=1)")
	}
	if !rl.Allow("user-b") {
		t.Fatal("user-b must be unaffected by user-a rate limit")
	}
}

func TestRateLimiter_Cleanup_RemovesOldEntries(t *testing.T) {
	rl := middleware.NewRateLimiter(60)
	rl.Allow("user-x")
	rl.Cleanup(0)
	if !rl.Allow("user-x") {
		t.Fatal("expected Allow=true after cleanup (fresh limiter)")
	}
}

func TestRateLimit_Middleware_Returns429WhenExceeded(t *testing.T) {
	install := middleware.NewRateLimiter(1)
	ip := middleware.NewRateLimiter(60)

	handler := middleware.RateLimit(middleware.NewMemoryLimiter(install), middleware.NewMemoryLimiter(ip), 1, 60)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Install-Id", "install-abc")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	if call() != http.StatusOK {
		t.Fatal("first call must be 200")
	}
	if call() != http.StatusTooManyRequests {
		t.Fatal("second call must be 429 (burst=1)")
	}
}

func TestRateLimit_Middleware_FallsBackToIPWhenNoInstallId(t *testing.T) {
	install := middleware.NewRateLimiter(60)
	ip := middleware.NewRateLimiter(1)

	handler := middleware.RateLimit(middleware.NewMemoryLimiter(install), middleware.NewMemoryLimiter(ip), 60, 1)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	if call() != http.StatusOK {
		t.Fatal("first IP call must be 200")
	}
	if call() != http.StatusTooManyRequests {
		t.Fatal("second IP call must be 429 (IP burst=1)")
	}
}

func TestRateLimiter_RemainingDecrements(t *testing.T) {
	rl := middleware.NewRateLimiter(10) // burst = 10
	rl.Allow("u")
	rl.Allow("u")
	remaining := rl.Remaining("u")
	if remaining >= 10 {
		t.Errorf("Remaining should be < 10 after 2 allows, got %d", remaining)
	}
}

func TestRateLimiter_RemainingUnseenKeyReturnsBurst(t *testing.T) {
	rl := middleware.NewRateLimiter(60)
	if got := rl.Remaining("never-seen"); got != 60 {
		t.Errorf("unseen key: expected burst=60, got %d", got)
	}
}
