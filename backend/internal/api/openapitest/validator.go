// Package openapitest provides spec-validation harness for handler tests.
//
// Usage:
//
//	v := openapitest.New(t)
//	wrapped := v.Wrap(handler)
//	wrapped.ServeHTTP(rr, req) // fails t if request or response violate spec
package openapitest

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	legacyrouter "github.com/getkin/kin-openapi/routers/legacy"
)

var (
	loadOnce sync.Once
	loadedT  *openapi3.T
	loadedR  routers.Router
	loadErr  error
)

// specPath resolves backend/openapi.yaml from any package under backend/.
func specPath() string {
	_, file, _, _ := runtime.Caller(0)
	// file: .../backend/internal/api/openapitest/validator.go
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "openapi.yaml")
}

func loadSpec() (*openapi3.T, routers.Router, error) {
	loadOnce.Do(func() {
		loader := openapi3.NewLoader()
		loader.IsExternalRefsAllowed = true
		doc, err := loader.LoadFromFile(specPath())
		if err != nil {
			loadErr = err
			return
		}
		if err := doc.Validate(loader.Context); err != nil {
			loadErr = err
			return
		}
		r, err := legacyrouter.NewRouter(doc)
		if err != nil {
			loadErr = err
			return
		}
		loadedT = doc
		loadedR = r
	})
	return loadedT, loadedR, loadErr
}

// Validator wraps an http.Handler and asserts every request/response pair
// conforms to backend/openapi.yaml. Failures call t.Errorf.
type Validator struct {
	t      testing.TB
	router routers.Router
}

// New returns a Validator. Fails t immediately if the spec is invalid.
func New(t testing.TB) *Validator {
	t.Helper()
	_, r, err := loadSpec()
	if err != nil {
		t.Fatalf("load openapi spec: %v", err)
	}
	return &Validator{t: t, router: r}
}

// Wrap returns a handler that validates request + response against the spec.
// Paths must include the /v1 server prefix where applicable (matches real router).
func (v *Validator) Wrap(next http.Handler) http.Handler {
	return v.wrap(next, true)
}

// WrapResponseOnly validates only the response. Use for negative tests that
// deliberately send invalid requests to assert 400/404/etc handling.
func (v *Validator) WrapResponseOnly(next http.Handler) http.Handler {
	return v.wrap(next, false)
}

func (v *Validator) wrap(next http.Handler, validateReq bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v.t.Helper()

		route, pathParams, err := v.router.FindRoute(r)
		if err != nil {
			// Path not in spec — skip validation (e.g. /metrics). Still serve.
			next.ServeHTTP(w, r)
			return
		}

		// Buffer request body so we can validate then forward.
		var reqBody []byte
		if r.Body != nil {
			reqBody, _ = io.ReadAll(r.Body)
			r.Body = io.NopCloser(bytes.NewReader(reqBody))
		}

		reqInput := &openapi3filter.RequestValidationInput{
			Request:    r,
			PathParams: pathParams,
			Route:      route,
			Options: &openapi3filter.Options{
				AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
			},
		}
		if validateReq {
			if err := openapi3filter.ValidateRequest(context.Background(), reqInput); err != nil {
				v.t.Errorf("openapi: request %s %s violates spec: %v", r.Method, r.URL.Path, err)
			}
		}
		// Restore body for downstream handler.
		if reqBody != nil {
			r.Body = io.NopCloser(bytes.NewReader(reqBody))
		}

		// Capture response.
		rec := httptest.NewRecorder()
		next.ServeHTTP(rec, r)

		respInput := &openapi3filter.ResponseValidationInput{
			RequestValidationInput: reqInput,
			Status:                 rec.Code,
			Header:                 rec.Header(),
			Options: &openapi3filter.Options{
				IncludeResponseStatus: true,
			},
		}
		respInput.SetBodyBytes(rec.Body.Bytes())

		if err := openapi3filter.ValidateResponse(context.Background(), respInput); err != nil {
			v.t.Errorf("openapi: response %s %s (%d) violates spec: %v",
				r.Method, r.URL.Path, rec.Code, err)
		}

		// Copy recorded response to real writer.
		for k, vs := range rec.Header() {
			for _, val := range vs {
				w.Header().Add(k, val)
			}
		}
		w.WriteHeader(rec.Code)
		_, _ = w.Write(rec.Body.Bytes())
	})
}
