package hafas_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *hafas.Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     3,
		HAFASCBProbeInterval: 30 * time.Second,
	})
}

func TestSearchStations_ReturnsStations(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/locations" {
			t.Errorf("unexpected path: %q", r.URL.Path)
		}
		if r.URL.Query().Get("query") != "Frank" {
			t.Errorf("unexpected query param: %q", r.URL.Query().Get("query"))
		}
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{
			{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
		})
	})

	stations, err := client.SearchStations(context.Background(), "Frank", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(stations) != 1 || stations[0].ID != "8000105" {
		t.Errorf("unexpected stations: %+v", stations)
	}
}

func TestSearchStations_PropagatesRequestID(t *testing.T) {
	var gotHeader string
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("X-Request-Id")
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	})

	ctx := hafas.ContextWithRequestID(context.Background(), "test-request-id-123")
	client.SearchStations(ctx, "Frank", 5)

	if gotHeader != "test-request-id-123" {
		t.Errorf("X-Request-Id not propagated: got %q", gotHeader)
	}
}

func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         "http://localhost:1",
		HAFASRequestTimeout:  50 * time.Millisecond,
		HAFASCBThreshold:     2,
		HAFASCBProbeInterval: 10 * time.Second,
	})

	for range 2 {
		client.SearchStations(context.Background(), "test", 1)
	}

	_, err := client.SearchStations(context.Background(), "test", 1)
	if !errors.Is(err, hafas.ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen after threshold, got: %v", err)
	}
}

func TestCircuitBreaker_ClosesAfterProbeSuccess(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	}))
	defer srv.Close()

	client := hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     1,
		HAFASCBProbeInterval: 0,
	})

	client.RecordFailureForTest()

	_, err := client.SearchStations(context.Background(), "test", 1)
	if err != nil {
		t.Fatalf("probe should succeed: %v", err)
	}

	if client.CircuitState() != 0 {
		t.Errorf("expected circuit closed (0), got %d", client.CircuitState())
	}
}
