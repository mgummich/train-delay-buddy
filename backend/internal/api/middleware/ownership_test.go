package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

type fakeStore struct{ j *journey.Journey }

func (f *fakeStore) Create(context.Context, *journey.Journey, []journey.Alternative) error {
	return nil
}
func (f *fakeStore) Get(_ context.Context, id string) (*journey.Journey, error) {
	if f.j == nil || f.j.ID != id {
		return nil, journey.ErrNotFound
	}
	return f.j, nil
}
func (f *fakeStore) GetAlternatives(context.Context, string) ([]journey.Alternative, string, error) {
	return nil, "", nil
}
func (f *fakeStore) UpdateState(context.Context, *journey.Journey, journey.Summary, []journey.Leg, bool) error {
	return nil
}
func (f *fakeStore) UpdateAlternatives(context.Context, string, []journey.Alternative) error {
	return nil
}
func (f *fakeStore) Terminate(context.Context, string) error                       { return nil }
func (f *fakeStore) GetActive(context.Context, int) ([]journey.Journey, error)     { return nil, nil }
func (f *fakeStore) CountActive(context.Context) (int, error)                      { return 0, nil }
func (f *fakeStore) GetIdempotency(context.Context, string) (*journey.IdempotencyEntry, error) {
	return nil, nil
}
func (f *fakeStore) SetIdempotency(context.Context, string, journey.IdempotencyEntry) error {
	return nil
}

func newRouter(store journey.Store, sentinel http.HandlerFunc) http.Handler {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(mw.JourneyOwnership(store))
		r.Get("/v1/journeys/{id}", sentinel)
	})
	return r
}

func TestJourneyOwnership_Match(t *testing.T) {
	store := &fakeStore{j: &journey.Journey{ID: "jrn_abc", InstallID: "install-1"}}
	called := false
	r := newRouter(store, func(w http.ResponseWriter, r *http.Request) {
		called = true
		if mw.JourneyFromContext(r.Context()) == nil {
			t.Error("expected journey in context")
		}
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_abc", nil)
	req.Header.Set("X-Install-Id", "install-1")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK || !called {
		t.Fatalf("expected handler called with 200, got %d called=%v", rr.Code, called)
	}
}

func TestJourneyOwnership_Mismatch_Returns404(t *testing.T) {
	store := &fakeStore{j: &journey.Journey{ID: "jrn_abc", InstallID: "owner"}}
	called := false
	r := newRouter(store, func(http.ResponseWriter, *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_abc", nil)
	req.Header.Set("X-Install-Id", "attacker")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 (not 403) on install mismatch, got %d", rr.Code)
	}
	if called {
		t.Error("handler must not be called on ownership mismatch")
	}
}

func TestJourneyOwnership_MissingHeader_Returns404(t *testing.T) {
	store := &fakeStore{j: &journey.Journey{ID: "jrn_abc", InstallID: "owner"}}
	r := newRouter(store, func(http.ResponseWriter, *http.Request) {
		t.Error("handler must not be called when X-Install-Id is missing")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_abc", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestJourneyOwnership_NotFound_Returns404(t *testing.T) {
	store := &fakeStore{}
	r := newRouter(store, func(http.ResponseWriter, *http.Request) {
		t.Error("handler must not be called when journey absent")
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_unknown", nil)
	req.Header.Set("X-Install-Id", "anyone")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}
