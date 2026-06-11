package reqid_test

import (
	"context"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/reqid"
)

func TestSetAndGet(t *testing.T) {
	ctx := reqid.Set(context.Background(), "abc123")
	if got := reqid.Get(ctx); got != "abc123" {
		t.Errorf("Get: got %q, want %q", got, "abc123")
	}
}

func TestGet_MissingReturnsEmpty(t *testing.T) {
	if got := reqid.Get(context.Background()); got != "" {
		t.Errorf("Get on empty context: got %q, want %q", got, "")
	}
}
