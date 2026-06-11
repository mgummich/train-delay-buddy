// backend/internal/api/handlers/journeys.go
package handlers

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/problem"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

// JourneysHandler handles POST/GET/DELETE /v1/journeys[/{id}].
type JourneysHandler struct {
	store     journey.Store
	engine    routing.Engine
	maxActive int
}

func NewJourneysHandler(store journey.Store, engine routing.Engine, maxActive int) *JourneysHandler {
	return &JourneysHandler{store: store, engine: engine, maxActive: maxActive}
}

type createRequest struct {
	TrainNumber    string           `json:"trainNumber"`
	Destination    string           `json:"destination"`
	IAmOnThisTrain bool             `json:"iAmOnThisTrain"`
	Filters        *journey.Filters `json:"filters"`
}

type createResponse struct {
	JourneyID    string                `json:"journeyId"`
	Plausibility journey.Plausibility  `json:"plausibility"`
	Summary      journey.Summary       `json:"summary"`
	Alternatives []journey.Alternative `json:"alternatives"`
}

// Create handles POST /v1/journeys.
func (h *JourneysHandler) Create(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)

	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "application/json" {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:malformed-request",
			Title:  "Malformed Request",
			Status: http.StatusBadRequest,
			Detail: "Content-Type must be application/json.",
		})
		return
	}

	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			problem.Write(w, r, problem.Problem{
				Type:   "urn:verspbegl:error:malformed-request",
				Title:  "Malformed Request",
				Status: http.StatusRequestEntityTooLarge,
				Detail: "Request body too large.",
			})
			return
		}
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:malformed-request",
			Title:  "Malformed Request",
			Status: http.StatusBadRequest,
			Detail: "Request body is not valid JSON.",
		})
		return
	}

	// Validate required fields
	var fieldErrors []problem.FieldError
	if req.TrainNumber == "" {
		fieldErrors = append(fieldErrors, problem.FieldError{Field: "trainNumber", Message: "required"})
	}
	if req.Destination == "" {
		fieldErrors = append(fieldErrors, problem.FieldError{Field: "destination", Message: "required"})
	}
	if len(fieldErrors) > 0 {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:validation-error",
			Title:  "Validation Error",
			Status: http.StatusUnprocessableEntity,
			Errors: fieldErrors,
		})
		return
	}

	filters := journey.Filters{DBOnly: true, SafetyLevel: journey.SafetyLevelNormal}
	if req.Filters != nil {
		filters = *req.Filters
		if filters.SafetyLevel == "" {
			filters.SafetyLevel = journey.SafetyLevelNormal
		}
	}

	// Idempotency-Key handling
	idempKey := r.Header.Get("Idempotency-Key")
	if idempKey != "" {
		bodyHash := hashBody(req)
		existing, _ := h.store.GetIdempotency(r.Context(), idempKey)
		if existing != nil {
			if existing.BodyHash != bodyHash {
				problem.Write(w, r, problem.Problem{
					Type:   "urn:verspbegl:error:idempotency-conflict",
					Title:  "Idempotency Conflict",
					Status: http.StatusConflict,
					Detail: "Idempotency-Key was already used with a different request body.",
				})
				return
			}
			// Replay cached response
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Idempotency-Replayed", "true")
			w.WriteHeader(existing.StatusCode)
			w.Write(existing.ResponseBody)
			return
		}
	}

	// Capacity check
	count, _ := h.store.CountActive(r.Context())
	if count >= h.maxActive {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:capacity-exceeded",
			Title:  "Service Unavailable",
			Status: http.StatusServiceUnavailable,
			Detail: "Maximum active journey limit reached.",
		})
		return
	}

	// Route
	result, err := h.engine.Route(r.Context(), routing.RoutingRequest{
		TrainNumber:    req.TrainNumber,
		FromStationID:  "", // BFS will determine from trip data
		ToStationID:    req.Destination,
		DepartureAfter: time.Now(),
		Filters:        filters,
		InstallID:      r.Header.Get("X-Install-Id"),
	})
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:upstream-unavailable",
			Title:  "Service Unavailable",
			Status: http.StatusServiceUnavailable,
			Detail: "Routing data temporarily unavailable.",
		})
		return
	}

	j := result.Original
	j.InstallID = r.Header.Get("X-Install-Id")

	if err := h.store.Create(r.Context(), &j, result.Alternatives); err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:internal-error",
			Title:  "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}

	resp := createResponse{
		JourneyID:    j.ID,
		Plausibility: result.Plausibility,
		Summary:      j.Summary,
		Alternatives: result.Alternatives,
	}

	respBody, _ := json.Marshal(resp)

	if idempKey != "" {
		h.store.SetIdempotency(r.Context(), idempKey, journey.IdempotencyEntry{
			JourneyID:    j.ID,
			BodyHash:     hashBody(req),
			StatusCode:   http.StatusCreated,
			ResponseBody: respBody,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Location", "/v1/journeys/"+j.ID)
	w.WriteHeader(http.StatusCreated)
	w.Write(respBody)
}

// Get handles GET /v1/journeys/{id}.
func (h *JourneysHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	j, err := h.store.Get(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has expired.", id),
		})
		return
	}
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:internal-error",
			Title:  "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// Delete handles DELETE /v1/journeys/{id}.
func (h *JourneysHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	err := h.store.Terminate(r.Context(), id)
	if errors.Is(err, journey.ErrNotFound) {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:journey-not-found",
			Title:  "Journey Not Found",
			Status: http.StatusNotFound,
			Detail: fmt.Sprintf("Journey %s does not exist or has already been terminated.", id),
		})
		return
	}
	if err != nil {
		problem.Write(w, r, problem.Problem{
			Type:   "urn:verspbegl:error:internal-error",
			Title:  "Internal Server Error",
			Status: http.StatusInternalServerError,
		})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func hashBody(req createRequest) string {
	b, _ := json.Marshal(req)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
