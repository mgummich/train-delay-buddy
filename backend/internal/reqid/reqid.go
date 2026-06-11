package reqid

import "context"

type contextKey struct{}

func Set(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}

func Get(ctx context.Context) string {
	if v, ok := ctx.Value(contextKey{}).(string); ok {
		return v
	}
	return ""
}
