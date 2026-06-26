package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestServerWriteTimeout_AllowsSlowHandler is a regression test for the
// `WriteTimeout: 20s` bug that caused nginx 502 ("upstream prematurely closed
// connection") when hub search exceeded 20s. The handler sleeps for longer than
// the old 20s budget to prove the configured WriteTimeout is large enough.
func TestServerWriteTimeout_AllowsSlowHandler(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping slow timeout test")
	}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(25 * time.Second):
		case <-r.Context().Done():
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	srv := httptest.NewUnstartedServer(handler)
	srv.Config.ReadTimeout = serverReadTimeout
	srv.Config.WriteTimeout = serverWriteTimeout
	srv.Config.IdleTimeout = serverIdleTimeout
	srv.Start()
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithTimeout(context.Background(), serverWriteTimeout+5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	client := &http.Client{Timeout: serverWriteTimeout + 5*time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("client.Do: %v (server killed conn mid-write?)", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if string(body) != `{"ok":true}` {
		t.Errorf("body = %q", body)
	}
}

// TestServerWriteTimeout_ConstantBound pins WriteTimeout against the worst-case
// hub search budget. Reduce only if you genuinely reduce the search budget.
func TestServerWriteTimeout_ConstantBound(t *testing.T) {
	const minBudget = 60 * time.Second
	if serverWriteTimeout < minBudget {
		t.Errorf("serverWriteTimeout = %s, must be ≥ %s to cover hub-search worst case",
			serverWriteTimeout, minBudget)
	}
}
