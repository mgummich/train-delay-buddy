package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

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
	HAFASCBThreshold     int
	HAFASCBProbeInterval time.Duration
	DBMaxOpenConns       int
	DBMaxIdleConns       int
	DBWriteTimeout       time.Duration
	MigrationsDir        string
	CORSAllowedOrigins   []string
}

func Load() Config {
	return Config{
		Port:                 env("PORT", "8080"),
		RedisURL:             env("REDIS_URL", "redis://redis:6379"),
		DatabaseURL:          env("DATABASE_URL", "postgres://vbb:vbb@postgres:5432/vbb"),
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
		DBMaxIdleConns:       envInt("DB_MAX_IDLE_CONNS", 5),
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
