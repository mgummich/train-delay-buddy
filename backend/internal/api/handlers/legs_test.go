package handlers_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
)

func routeLegsRequest(t testing.TB, h *handlers.LegsHandler, id, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}/legs", h.Get)
	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/"+id+"/legs", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rr := httptest.NewRecorder()
	serveRouter(t, r, rr, req)
	return rr
}

func TestLegs_Returns200WithLegsAndStops(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_legstest000000000000001")
	store.journeys[j.ID] = j
	h := handlers.NewLegsHandler(store)

	rr := routeLegsRequest(t, h, j.ID, "")

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("ETag") == "" {
		t.Error("ETag header must be set")
	}
}

func TestLegs_MatchingETag_Returns304(t *testing.T) {
	store := newMockStore()
	j := makeTestJourney("jrn_legstest000000000000002")
	store.journeys[j.ID] = j
	h := handlers.NewLegsHandler(store)

	etag := fmt.Sprintf(`"%s"`, j.ETag())
	rr := routeLegsRequest(t, h, j.ID, etag)

	if rr.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", rr.Code)
	}
}

func TestLegs_NotFound_Returns404(t *testing.T) {
	h := handlers.NewLegsHandler(newMockStore())
	rr := routeLegsRequest(t, h, "jrn_notexist0000000000000002", "")
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}
