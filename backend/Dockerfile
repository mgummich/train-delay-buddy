# backend/Dockerfile

# ── dev stage (used by docker-compose.override.yml) ─────────────────────────
FROM golang:1.25-alpine AS dev
WORKDIR /app
RUN apk add --no-cache curl
COPY go.mod go.sum ./
RUN go mod download
CMD ["go", "run", "./cmd/server"]

# ── builder ──────────────────────────────────────────────────────────────────
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /bin/server \
    ./cmd/server

# ── production ───────────────────────────────────────────────────────────────
FROM alpine:3.21
RUN apk --no-cache add ca-certificates curl
WORKDIR /app
COPY --from=builder /bin/server ./server
COPY --from=builder /app/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
CMD ["./server"]
