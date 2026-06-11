package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // embed timezone data for Europe/Berlin in FilterTripsByDate

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/api"
	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/migrate"
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func main() {
	cfg := config.Load()
	logger := newLogger(cfg.LogLevel)

	rdb, err := connectRedis(cfg.RedisURL)
	if err != nil {
		logger.Error("redis connect failed", "error", err)
		os.Exit(1)
	}
	defer rdb.Close()

	db, err := connectDB(context.Background(), cfg)
	if err != nil {
		logger.Error("postgres connect failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	migrateCtx, migrateCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer migrateCancel()
	if err := migrate.Run(migrateCtx, db, cfg.MigrationsDir); err != nil {
		logger.Error("migration failed", "error", err)
		os.Exit(1)
	}
	logger.Info("migrations complete")

	hafasClient := hafas.NewClient(cfg)

	store := journey.NewStore(db, rdb, cfg.JourneyTTLHours, cfg.DBWriteTimeout, logger)
	engine := routing.NewBFSEngine(hafasClient)

	installLimiter := mw.NewRateLimiter(cfg.RateLimitPerInstall)
	ipLimiter := mw.NewRateLimiter(cfg.RateLimitPerIP)

	stopCleanup := make(chan struct{})
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				installLimiter.Cleanup(2 * time.Minute)
				ipLimiter.Cleanup(2 * time.Minute)
			case <-stopCleanup:
				return
			}
		}
	}()

	router := api.NewRouter(api.Deps{
		Health:             handlers.NewHealthHandler(db, rdb, cfg.HAFASBaseURL),
		Stations:           handlers.NewStationsHandler(hafasClient, rdb),
		Trains:             handlers.NewTrainsHandler(hafasClient),
		Journeys:           handlers.NewJourneysHandler(store, engine, cfg.MaxActiveJourneys),
		Logger:             logger,
		CORSOrigins:        cfg.CORSAllowedOrigins,
		InstallRateLimiter: installLimiter,
		IPRateLimiter:      ipLimiter,
		PerInstallLimit:    cfg.RateLimitPerInstall,
		PerIPLimit:         cfg.RateLimitPerIP,
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 20 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan struct{})
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
		sig := <-quit
		logger.Info("shutdown signal received", "signal", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("shutdown error", "error", err)
		}
		close(done)
	}()

	logger.Info("server starting", "port", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
	<-done
	close(stopCleanup)
	logger.Info("server stopped")
}

func connectRedis(rawURL string) (*redis.Client, error) {
	opt, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	c := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return c, c.Ping(ctx).Err()
}

func connectDB(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	pcfg.MaxConns = int32(cfg.DBMaxOpenConns)
	pcfg.MinConns = int32(cfg.DBMinConns)
	db, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}
	ctx2, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.Ping(ctx2); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch strings.ToUpper(level) {
	case "DEBUG":
		l = slog.LevelDebug
	case "WARN":
		l = slog.LevelWarn
	case "ERROR":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
