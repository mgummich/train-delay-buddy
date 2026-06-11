package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"

	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(reqid.Set(r.Context(), id)))
	})
}

// GetRequestID retrieves the request ID from ctx. Delegates to reqid.Get.
func GetRequestID(ctx context.Context) string {
	return reqid.Get(ctx)
}

// WithRequestID injects id into ctx. Used by the poller when making HAFAS calls
// without an inbound HTTP request (Plan 4).
func WithRequestID(ctx context.Context, id string) context.Context {
	return reqid.Set(ctx, id)
}

func newRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return hex.EncodeToString(b)
}
