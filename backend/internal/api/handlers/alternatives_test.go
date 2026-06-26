package handlers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func routeAltsRequest(t testing.TB, h *handlers.AlternativesHandler, method, id, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}/alternatives", h.Get)
	r.Post("/v1/journeys/{id}/alternatives", h.Trigger)
	req := httptest.NewRequest(method, "/v1/journeys/"+id+"/alternatives", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	serveRouter(t, r, rr, req)
	return rr
}

var mockAltsEngineResult = routing.RoutingResult{
	Alternatives: []journey.Alternative{},
	Plausibility: journey.Plausibility{OnTrainConfidence: "high"},
}

func TestAlternatives_Get_Returns200(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_altstest00000000000001")
	store.journeys[j.ID] = j
	store.alts[j.ID] = []journey.Alternative{
		{
			JourneyID: "jrn_alt1000000000000000000001",
			Summary:   journey.Summary{Status: journey.StatusOK, DataConfidence: journey.DataConfidenceHigh},
		},
	}
	h := handlers.NewAlternativesHandler(store, &mockEngine{result: &mockAltsEngineResult}, 30*time.Second, context.Background())

	rr := routeAltsRequest(t, h, http.MethodGet, j.ID, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	json.NewDecoder(rr.Body).Decode(&body)
	if body["data"] == nil {
		t.Error("response must have 'data' field")
	}
}

func TestAlternatives_Get_MatchingETag_Returns304(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_altstest00000000000002")
	store.journeys[j.ID] = j
	store.alts[j.ID] = []journey.Alternative{}
	h := handlers.NewAlternativesHandler(store, &mockEngine{}, 30*time.Second, context.Background())

	rr1 := routeAltsRequest(t, h, http.MethodGet, j.ID, "")
	etag := rr1.Header().Get("ETag")
	if etag == "" {
		t.Fatal("ETag must be set on first GET")
	}

	rr2 := routeAltsRequest(t, h, http.MethodGet, j.ID, etag)
	if rr2.Code != http.StatusNotModified {
		t.Errorf("expected 304, got %d", rr2.Code)
	}
}

func TestAlternatives_Post_Returns202(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_altstest00000000000003")
	store.journeys[j.ID] = j
	h := handlers.NewAlternativesHandler(store, &mockEngine{result: &mockAltsEngineResult}, 30*time.Second, context.Background())

	rr := routeAltsRequest(t, h, http.MethodPost, j.ID, "")

	if rr.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	json.NewDecoder(rr.Body).Decode(&body)
	if body["status"] != "computing" {
		t.Errorf("body.status: got %v, want computing", body["status"])
	}
	if body["pollPath"] == nil || body["pollPath"] == "" {
		t.Error("pollPath must be set")
	}
}
