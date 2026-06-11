package middleware_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/api/middleware"
)

func TestLogging_LogsRequest(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	handler := middleware.Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/test", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	logged := buf.String()
	if !strings.Contains(logged, "GET") {
		t.Errorf("log missing method: %s", logged)
	}
	if !strings.Contains(logged, "/v1/test") {
		t.Errorf("log missing path: %s", logged)
	}
	if !strings.Contains(logged, "201") {
		t.Errorf("log missing status 201: %s", logged)
	}
}

func TestCORS_AllowedOrigin(t *testing.T) {
	handler := middleware.CORS([]string{"http://localhost:5173"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Errorf("CORS header missing for allowed origin")
	}
}

func TestCORS_BlockedOrigin(t *testing.T) {
	handler := middleware.CORS([]string{"http://localhost:5173"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://evil.example.com")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("CORS header should not be set for blocked origin")
	}
}

func TestCORS_OPTIONS_Returns204(t *testing.T) {
	handler := middleware.CORS([]string{"http://localhost:5173"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called for OPTIONS")
		}),
	)

	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("OPTIONS status: got %d, want 204", rr.Code)
	}
}

func TestCORS_EmptyOrigins_Noop(t *testing.T) {
	called := false
	handler := middleware.CORS(nil)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			w.WriteHeader(http.StatusOK)
		}),
	)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if !called {
		t.Error("noop CORS should pass through to handler")
	}
}
