// Package config loads server configuration from environment variables with typed defaults.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime configuration values loaded from environment variables.
// Use Load() to obtain a populated instance with defaults applied.
type Config struct {
	Port                 string
	RedisURL             string
	DatabaseURL          string
	HAFASBaseURL         string
	HAFASWorkerPoolSize  int
	MaxActiveJourneys    int
	JourneyTTLHours      int
	RateLimitPerInstall  int
	RateLimitPerIP       int
	LogLevel             string
	HAFASRequestTimeout  time.Duration
	HAFASQueueDepth      int
	HAFASCBThreshold     int           // consecutive failures before circuit opens
	HAFASCBProbeInterval time.Duration // wait time before a half-open probe is attempted
	DBMaxOpenConns       int
	DBMinConns           int           // minimum idle connections kept alive in the pool
	DBWriteTimeout       time.Duration // context timeout applied to write queries
	MigrationsDir        string
	CORSAllowedOrigins   []string
}

// Load reads environment variables and returns a Config with defaults applied.
// VALKEY_URL takes precedence over REDIS_URL for backwards compatibility.
func Load() Config {
	return Config{
		Port: env("PORT", "8080"),
		// Valkey is a BSD-licensed Redis fork and is wire-compatible.
		// Prefer VALKEY_URL; fall back to REDIS_URL for backwards compatibility.
		RedisURL:    env("VALKEY_URL", env("REDIS_URL", "redis://valkey:6379")),
		DatabaseURL: env("DATABASE_URL", "postgres://vbb:vbb@postgres:5432/vbb"),
		// Compose sets HAFAS_BASE_URL to the bundled db-vendo-client sidecar.
		// Public v6.db.transport.rest is the fallback for bare-metal runs without the sidecar.
		HAFASBaseURL:         env("HAFAS_BASE_URL", "https://v6.db.transport.rest"),
		HAFASWorkerPoolSize:  envInt("HAFAS_WORKER_POOL_SIZE", 50),
		MaxActiveJourneys:    envInt("MAX_ACTIVE_JOURNEYS", 2000),
		JourneyTTLHours:      envInt("JOURNEY_TTL_HOURS", 2),
		RateLimitPerInstall:  envInt("RATE_LIMIT_PER_INSTALL", 60),
		RateLimitPerIP:       envInt("RATE_LIMIT_PER_IP", 30),
		LogLevel:             env("LOG_LEVEL", "INFO"),
		HAFASRequestTimeout:  envDuration("HAFAS_REQUEST_TIMEOUT", 8*time.Second),
		HAFASQueueDepth:      envInt("HAFAS_QUEUE_DEPTH", 200),
		HAFASCBThreshold:     envInt("HAFAS_CB_THRESHOLD", 5),
		HAFASCBProbeInterval: envDuration("HAFAS_CB_PROBE_INTERVAL", 30*time.Second),
		DBMaxOpenConns:       envInt("DB_MAX_OPEN_CONNS", 20),
		DBMinConns:           envInt("DB_MIN_CONNS", 5),
		DBWriteTimeout:       envDuration("DB_WRITE_TIMEOUT", 5*time.Second),
		MigrationsDir:        env("MIGRATIONS_DIR", "./migrations"),
		CORSAllowedOrigins:   envList("CORS_ALLOWED_ORIGINS"),
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func envList(key string) []string {
	v := os.Getenv(key)
	if v == "" {
		return nil
	}
	var out []string
	for _, s := range strings.Split(v, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
