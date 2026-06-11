package config_test

import (
	"os"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	os.Clearenv()
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
