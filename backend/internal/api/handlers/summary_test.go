package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func makeTestJourney(id string) *journey.Journey {
	return &journey.Journey{
		ID:          id,
		ETagEpoch:   1749600000,
		ETagCounter: 42,
		Summary: journey.Summary{
			ETA:            time.Date(2026, 6, 10, 17, 24, 0, 0, time.UTC),
			Status:         journey.StatusOK,
			DataConfidence: journey.DataConfidenceHigh,
			DataFetchedAt:  time.Now(),
			LastUpdatedAt:  time.Now(),
		},
		Legs:  []journey.Leg{},
		Stops: []journey.Stop{},
	}
}

func routeSummaryRequest(t testing.TB, h *handlers.SummaryHandler, id, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}/summary", h.Get)
	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/"+id+"/summary", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	serveRouter(t, r, rr, req)
	return rr
}

func TestSummary_NoETag_Returns200WithBody(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_testid00000000000000000001")
	store.journeys[j.ID] = j
	h := handlers.NewSummaryHandler(store)

	rr := routeSummaryRequest(t, h, j.ID, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("ETag") == "" {
		t.Error("ETag header must be set on 200")
	}
	if rr.Header().Get("Cache-Control") != "private, no-cache, must-revalidate" {
		t.Errorf("Cache-Control: got %q", rr.Header().Get("Cache-Control"))
	}
	var body journey.Summary
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("body not decodable: %v", err)
	}
}

func TestSummary_MatchingETag_Returns304NoBody(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_testid00000000000000000002")
	store.journeys[j.ID] = j
	h := handlers.NewSummaryHandler(store)

	etag := fmt.Sprintf(`"%s"`, j.ETag())
	rr := routeSummaryRequest(t, h, j.ID, etag)

	if rr.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", rr.Code)
	}
	if rr.Body.Len() != 0 {
		t.Errorf("304 must have no body, got %d bytes", rr.Body.Len())
	}
}

func TestSummary_StaleETag_Returns200(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_testid00000000000000000003")
	store.journeys[j.ID] = j
	h := handlers.NewSummaryHandler(store)

	rr := routeSummaryRequest(t, h, j.ID, `"jrn_testid00000000000000000003:1749600000:41"`)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for stale ETag, got %d", rr.Code)
	}
}

func TestSummary_NotFound_Returns404(t *testing.T) {
	h := handlers.NewSummaryHandler(newMockStore())
	rr := routeSummaryRequest(t, h, "jrn_notexist0000000000000001", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}
