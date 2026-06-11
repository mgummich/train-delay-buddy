// backend/internal/api/middleware/requestid_test.go
package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

func TestRequestID_SetsHeader(t *testing.T) {
	handler := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	id := rr.Header().Get("X-Request-Id")
	if id == "" {
		t.Fatal("X-Request-Id header not set")
	}
	if len(id) != 32 {
		t.Errorf("X-Request-Id length: got %d, want 32 hex chars", len(id))
	}
}

func TestRequestID_UniquePerRequest(t *testing.T) {
	var ids [2]string
	i := 0
	handler := middleware.RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ids[i] = middleware.GetRequestID(r.Context())
		i++
	}))

	for range 2 {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
	}

	if ids[0] == "" || ids[1] == "" {
		t.Fatal("request ID not propagated to context")
	}
	if ids[0] == ids[1] {
		t.Errorf("request IDs should be unique, both are %q", ids[0])
	}
}
