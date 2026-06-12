package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func routeTrainRequest(h *handlers.TrainsHandler, trainNumber, date string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/v1/trains/{number}", h.Get)
	path := "/v1/trains/" + trainNumber
	if date != "" {
		path += "?date=" + date
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
	return rr
}

func TestTrains_ValidTrain_Returns200(t *testing.T) {
	today := time.Now().UTC().Format("2006-01-02")
	// Anchor to noon UTC so Berlin conversion (UTC+2) stays on the same calendar day
	// regardless of when the test runs — avoids date-crossing after 22:00 UTC.
	noon := time.Now().UTC().Truncate(24 * time.Hour).Add(12 * time.Hour)
	dep := noon.Add(-2 * time.Hour)
	arr := noon.Add(4 * time.Hour)

	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{
			Trips: []hafas.HAFASTrip{
				{
					Line:        hafas.HAFASLine{Name: "ICE 123", Operator: &hafas.HAFASOperator{Name: "DB Fernverkehr AG"}},
					Origin:      hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"},
					Destination: hafas.HAFASPlace{ID: "8011160", Name: "Berlin Hbf"},
					Departure:   &dep,
					Arrival:     &arr,
					Stopovers: []hafas.HAFASStopover{
						{Stop: hafas.HAFASPlace{ID: "8000261", Name: "München Hbf"}, PlannedDeparture: &dep},
					},
				},
			},
		})
	})
	h := handlers.NewTrainsHandler(client)

	rr := routeTrainRequest(h, "ICE123", today)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	json.NewDecoder(rr.Body).Decode(&body)
	if body["trainNumber"] != "ICE 123" {
		t.Errorf("trainNumber: got %v, want ICE 123", body["trainNumber"])
	}
	if body["status"] == nil {
		t.Error("status field missing")
	}
}

func TestTrains_NotFound_Returns404(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(hafas.HAFASTripsResponse{Trips: []hafas.HAFASTrip{}})
	})
	h := handlers.NewTrainsHandler(client)

	rr := routeTrainRequest(h, "ICE999", "2020-01-01")

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type: got %q, want application/problem+json", ct)
	}
}

func TestTrains_InvalidDate_Returns400(t *testing.T) {
	client := newTestHAFASClient(t, func(w http.ResponseWriter, r *http.Request) {})
	h := handlers.NewTrainsHandler(client)

	rr := routeTrainRequest(h, "ICE123", "not-a-date")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}
