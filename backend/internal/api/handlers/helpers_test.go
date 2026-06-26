package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/verspaetungsbegleiter/backend/internal/api/openapitest"
)

// serveRouter routes req through r with spec validation enabled.
func serveRouter(t testing.TB, r chi.Router, rr *httptest.ResponseRecorder, req *http.Request) {
	t.Helper()
	openapitest.New(t).Wrap(r).ServeHTTP(rr, req)
}

// serveRouterResp routes req through r with response-only spec validation.
// Use for negative tests with deliberately invalid requests.
func serveRouterResp(t testing.TB, r chi.Router, rr *httptest.ResponseRecorder, req *http.Request) {
	t.Helper()
	openapitest.New(t).WrapResponseOnly(r).ServeHTTP(rr, req)
}

// validate invokes h(rr, req) wrapped in spec validation. Any request or
// response body that does not conform to backend/openapi.yaml fails the test.
func validate(t testing.TB, h http.HandlerFunc, rr *httptest.ResponseRecorder, req *http.Request) {
	t.Helper()
	openapitest.New(t).Wrap(h).ServeHTTP(rr, req)
}

// validateResp invokes h(rr, req) and validates only the response. Use for
// negative tests that deliberately send a malformed request to exercise
// 400/404/etc handling.
func validateResp(t testing.TB, h http.HandlerFunc, rr *httptest.ResponseRecorder, req *http.Request) {
	t.Helper()
	openapitest.New(t).WrapResponseOnly(h).ServeHTTP(rr, req)
}
