package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	"github.com/verspaetungsbegleiter/backend/internal/api/openapitest"
)

func TestLiveness_Returns200(t *testing.T) {
	h := handlers.NewHealthHandler(nil, nil, "")
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rr := httptest.NewRecorder()

	v := openapitest.New(t)
	v.Wrap(http.HandlerFunc(h.Liveness)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("body.status: got %q, want %q", body["status"], "ok")
	}
}

func TestLiveness_ContentType(t *testing.T) {
	h := handlers.NewHealthHandler(nil, nil, "")
	rr := httptest.NewRecorder()
	h.Liveness(rr, httptest.NewRequest(http.MethodGet, "/health", nil))

	ct := rr.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type: got %q, want %q", ct, "application/json")
	}
}
