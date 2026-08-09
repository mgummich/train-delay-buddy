package config_test

import (
	"os"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	for _, k := range []string{
		"PORT", "REDIS_URL", "DATABASE_URL", "HAFAS_BASE_URL",
		"HAFAS_WORKER_POOL_SIZE", "MAX_ACTIVE_JOURNEYS", "JOURNEY_TTL_HOURS",
		"RATE_LIMIT_PER_INSTALL", "RATE_LIMIT_PER_IP", "LOG_LEVEL",
		"HAFAS_REQUEST_TIMEOUT", "HAFAS_QUEUE_DEPTH", "HAFAS_CB_THRESHOLD",
		"HAFAS_CB_PROBE_INTERVAL", "DB_MAX_OPEN_CONNS", "DB_MIN_CONNS",
		"DB_WRITE_TIMEOUT", "MIGRATIONS_DIR", "CORS_ALLOWED_ORIGINS",
	} {
		t.Setenv(k, "")
	}
	cfg := config.Load()

	if cfg.Port != "8080" {
		t.Errorf("Port: got %q, want %q", cfg.Port, "8080")
	}
	if cfg.HAFASWorkerPoolSize != 50 {
		t.Errorf("HAFASWorkerPoolSize: got %d, want 50", cfg.HAFASWorkerPoolSize)
	}
	if cfg.HAFASRequestTimeout != 8*time.Second {
		t.Errorf("HAFASRequestTimeout: got %v, want 8s", cfg.HAFASRequestTimeout)
	}
}

func TestLoad_EnvOverride(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("HAFAS_WORKER_POOL_SIZE", "100")
	t.Cleanup(func() {
		os.Unsetenv("PORT")
		os.Unsetenv("HAFAS_WORKER_POOL_SIZE")
	})

	cfg := config.Load()

	if cfg.Port != "9090" {
		t.Errorf("Port: got %q, want %q", cfg.Port, "9090")
	}
	if cfg.HAFASWorkerPoolSize != 100 {
		t.Errorf("HAFASWorkerPoolSize: got %d, want 100", cfg.HAFASWorkerPoolSize)
	}
}

func TestLoad_IntOverflowFallsBackToDefault(t *testing.T) {
	// Values beyond int32 would overflow when narrowed for pgxpool.
	os.Setenv("DB_MAX_OPEN_CONNS", "99999999999")
	t.Cleanup(func() { os.Unsetenv("DB_MAX_OPEN_CONNS") })

	if got := config.Load().DBMaxOpenConns; got != 20 {
		t.Errorf("DBMaxOpenConns: got %d, want default 20", got)
	}
}
