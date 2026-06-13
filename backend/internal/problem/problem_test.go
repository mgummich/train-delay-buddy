package problem_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/problem"
)

func TestWrite(t *testing.T) {
	p := problem.Problem{
		Type:   "urn:vbb:error:not-found",
		Title:  "Not Found",
		Status: http.StatusNotFound,
		Detail: "journey not found",
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/journeys/jrn_test", nil)
	w := httptest.NewRecorder()
	problem.Write(w, req, p)

	resp := w.Result()

	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if got := resp.Header.Get("Content-Type"); got != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", got)
	}

	var got problem.Problem
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Instance != "/v1/journeys/jrn_test" {
		t.Errorf("Instance = %q, want /v1/journeys/jrn_test", got.Instance)
	}
	if got.Title != "Not Found" {
		t.Errorf("Title = %q, want Not Found", got.Title)
	}
}

func TestWrite_NilRequest_NoInstancePanic(t *testing.T) {
	p := problem.Problem{
		Type:   "urn:vbb:error:internal",
		Title:  "Internal Server Error",
		Status: http.StatusInternalServerError,
	}
	w := httptest.NewRecorder()
	problem.Write(w, nil, p) // must not panic
	if w.Code != http.StatusInternalServerError {
		t.Errorf("code = %d, want 500", w.Code)
	}
}

func TestWrite_ExplicitInstance(t *testing.T) {
	p := problem.Problem{
		Type:     "urn:vbb:error:bad-request",
		Title:    "Bad Request",
		Status:   http.StatusBadRequest,
		Instance: "/custom-instance",
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/journeys", nil)
	w := httptest.NewRecorder()
	problem.Write(w, req, p)

	var got problem.Problem
	json.NewDecoder(w.Result().Body).Decode(&got)
	// Explicit instance must not be overridden by request path.
	if got.Instance != "/custom-instance" {
		t.Errorf("Instance = %q, want /custom-instance", got.Instance)
	}
}
