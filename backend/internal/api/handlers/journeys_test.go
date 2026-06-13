package handlers_test

import (
	"bytes"
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

// mockStore is an in-memory Store for handler tests.
type mockStore struct {
	journeys map[string]*journey.Journey
	alts     map[string][]journey.Alternative
}

func newMockStore() *mockStore {
	return &mockStore{
		journeys: make(map[string]*journey.Journey),
		alts:     make(map[string][]journey.Alternative),
	}
}
func (m *mockStore) Create(_ context.Context, j *journey.Journey, alts []journey.Alternative) error {
	m.journeys[j.ID] = j
	m.alts[j.ID] = alts
	return nil
}
func (m *mockStore) Get(_ context.Context, id string) (*journey.Journey, error) {
	j, ok := m.journeys[id]
	if !ok {
		return nil, journey.ErrNotFound
	}
	return j, nil
}
func (m *mockStore) GetAlternatives(_ context.Context, id string) ([]journey.Alternative, string, error) {
	return m.alts[id], id + ":alts:1", nil
}
func (m *mockStore) UpdateState(_ context.Context, _ *journey.Journey, _ journey.Summary, _ []journey.Leg, _ bool) error {
	return nil
}
func (m *mockStore) UpdateAlternatives(_ context.Context, id string, alts []journey.Alternative) error {
	m.alts[id] = alts
	return nil
}
func (m *mockStore) Terminate(_ context.Context, id string) error {
	if _, ok := m.journeys[id]; !ok {
		return journey.ErrNotFound
	}
	delete(m.journeys, id)
	return nil
}
func (m *mockStore) GetActive(_ context.Context, _ int) ([]journey.Journey, error)   { return nil, nil }
func (m *mockStore) CountActive(_ context.Context) (int, error)                       { return 0, nil }
func (m *mockStore) GetIdempotency(_ context.Context, _ string) (*journey.IdempotencyEntry, error) {
	return nil, nil
}
func (m *mockStore) SetIdempotency(_ context.Context, _ string, _ journey.IdempotencyEntry) error {
	return nil
}

// mockEngine returns a fixed RoutingResult.
type mockEngine struct {
	result *routing.RoutingResult
}

func (e *mockEngine) Route(_ context.Context, _ routing.RoutingRequest) (*routing.RoutingResult, error) {
	return e.result, nil
}

func newTestJourneysHandler(store journey.Store, engine routing.Engine, max int) *handlers.JourneysHandler {
	return handlers.NewJourneysHandler(store, engine, nil, max)
}

func TestCreateJourney_Returns201(t *testing.T) {
	store := newMockStore()
	eta := time.Now().Add(3 * time.Hour)
	engine := &mockEngine{result: &routing.RoutingResult{
		Original: journey.Journey{
			ID: "jrn_testid00000000000000000",
			Summary: journey.Summary{
				ETA: eta, Status: journey.StatusOK,
				DataFetchedAt: time.Now(), LastUpdatedAt: time.Now(),
			},
		},
		Alternatives: []journey.Alternative{},
		Plausibility: journey.Plausibility{OnTrainConfidence: "high"},
	}}

	h := newTestJourneysHandler(store, engine, 2000)

	body := `{"trainNumber":"ICE 123","destination":"8000105","iAmOnThisTrain":true}`
	req := httptest.NewRequest(http.MethodPost, "/v1/journeys",
		bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Location") == "" {
		t.Error("Location header must be set")
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["journeyId"] == "" {
		t.Error("journeyId missing in response")
	}
}

func TestCreateJourney_MissingTrainNumber_Returns422(t *testing.T) {
	h := newTestJourneysHandler(newMockStore(), &mockEngine{}, 2000)
	body := `{"destination":"8000105"}`
	req := httptest.NewRequest(http.MethodPost, "/v1/journeys", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.Create(rr, req)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rr.Code)
	}
}

func TestGetJourney_Returns200(t *testing.T) {
	store := newMockStore()
	j := &journey.Journey{
		ID: "jrn_test00000000000000000001",
		Summary: journey.Summary{ETA: time.Now(), DataFetchedAt: time.Now(), LastUpdatedAt: time.Now()},
		Legs: []journey.Leg{}, Stops: []journey.Stop{},
	}
	store.journeys[j.ID] = j

	h := newTestJourneysHandler(store, &mockEngine{}, 2000)

	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}", h.Get)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/journeys/"+j.ID, nil))

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestGetJourney_NotFound_Returns404(t *testing.T) {
	h := newTestJourneysHandler(newMockStore(), &mockEngine{}, 2000)
	r := chi.NewRouter()
	r.Get("/v1/journeys/{id}", h.Get)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_notexist0000000000000", nil))
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestDeleteJourney_Returns204(t *testing.T) {
	store := newMockStore()
	store.journeys["jrn_del00000000000000000001"] = &journey.Journey{ID: "jrn_del00000000000000000001"}

	h := newTestJourneysHandler(store, &mockEngine{}, 2000)
	r := chi.NewRouter()
	r.Delete("/v1/journeys/{id}", h.Delete)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/v1/journeys/jrn_del00000000000000000001", nil))
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}

func TestDeleteJourney_NotFound_Returns404(t *testing.T) {
	h := newTestJourneysHandler(newMockStore(), &mockEngine{}, 2000)
	r := chi.NewRouter()
	r.Delete("/v1/journeys/{id}", h.Delete)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodDelete, "/v1/journeys/jrn_notexist0000000000000", nil))
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}
