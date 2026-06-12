# syntax=docker/dockerfile:1
# backend/Dockerfile

# ── dev stage (used by docker-compose.override.yml) ─────────────────────────
FROM golang:1.25-alpine AS dev
WORKDIR /app
RUN apk add --no-cache curl \
    && adduser -D -u 10001 app \
    && chown -R app:app /app
COPY --chown=app:app go.mod go.sum ./
USER app
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
FROM alpine:3.21 AS production
LABEL org.opencontainers.image.title="verspaetungs-begleiter-backend" \
      org.opencontainers.image.source="https://github.com/mgummich/train-delay-buddy" \
      org.opencontainers.image.licenses="MIT"
RUN apk --no-cache add ca-certificates curl \
    && adduser -D -u 10001 app
WORKDIR /app
COPY --from=builder --chown=app:app /bin/server ./server
COPY --from=builder --chown=app:app /app/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1
ENTRYPOINT ["./server"]
