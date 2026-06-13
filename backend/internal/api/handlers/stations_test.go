package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func newTestHAFASClient(t *testing.T, h http.HandlerFunc) *hafas.Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return hafas.NewClient(config.Config{
		HAFASBaseURL:         srv.URL,
		HAFASRequestTimeout:  5 * time.Second,
		HAFASCBThreshold:     5,
		HAFASCBProbeInterval: 30 * time.Second,
	}, nil)
}

func TestStations_ShortQuery_Returns400(t *testing.T) {
	h := handlers.NewStationsHandler(newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {}), nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=x", nil)
	rr := httptest.NewRecorder()
	validateResp(t, h.Search, rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: got %q, want application/problem+json", ct)
	}
}

func TestStations_ValidQuery_ReturnsStations(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{
			{Type: "stop", ID: "8000105", Name: "Frankfurt (Main) Hbf"},
			{Type: "stop", ID: "8000104", Name: "Frankfurt (Main) Süd"},
		})
	})
	h := handlers.NewStationsHandler(client, nil)

	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=Frank", nil)
	rr := httptest.NewRecorder()
	validate(t, h.Search, rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body struct {
		Stations []journey.StationRef `json:"stations"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Stations) != 2 {
		t.Errorf("expected 2 stations, got %d", len(body.Stations))
	}
}

func TestStations_EmptyResult_ReturnsEmptyArray(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]hafas.HAFASLocationResult{})
	})
	h := handlers.NewStationsHandler(client, nil)

	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=xyz", nil)
	rr := httptest.NewRecorder()
	validate(t, h.Search, rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if body := rr.Body.String(); body == "" {
		t.Fatal("empty body")
	}
	var m map[string]any
	json.Unmarshal(rr.Body.Bytes(), &m)
	if m["stations"] == nil {
		t.Error("stations field must be [] not null")
	}
}
