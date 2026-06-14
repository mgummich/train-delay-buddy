package openapitest_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/openapitest"
)

// Confirms validator loads the spec and forwards conforming responses.
func TestValidator_ConformingResponsePasses(t *testing.T) {
	v := openapitest.New(t)

	// /v1/stations requires q query param per spec; respond with valid shape.
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"stations":[]}`))
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=Berlin", nil)
	v.Wrap(h).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200", rr.Code)
	}
}

// Confirms validator flags response bodies that violate the spec schema.
func TestValidator_NonConformingResponseFails(t *testing.T) {
	// Use a fakeT to capture validator's t.Errorf without failing this test.
	ft := &fakeT{TB: t}
	v := openapitest.New(ft)

	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Wrong shape: spec requires {stations: [...]}.
		_, _ = w.Write([]byte(`{"wrong":"shape"}`))
	})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/stations?q=Berlin", nil)
	v.Wrap(h).ServeHTTP(rr, req)

	if !ft.errored {
		t.Fatal("expected validator to flag schema violation, got none")
	}
}

type fakeT struct {
	testing.TB
	errored bool
}

func (f *fakeT) Errorf(format string, args ...any) { f.errored = true }
func (f *fakeT) Helper()                           {}
