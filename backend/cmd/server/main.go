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
	_ "time/tzdata" // embed timezone data for Europe/Berlin

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/verspaetungsbegleiter/backend/internal/api"
	"github.com/verspaetungsbegleiter/backend/internal/api/handlers"
	mw "github.com/verspaetungsbegleiter/backend/internal/api/middleware"
	"github.com/verspaetungsbegleiter/backend/internal/config"
	"github.com/verspaetungsbegleiter/backend/internal/hafas"
	"github.com/verspaetungsbegleiter/backend/internal/journey"
	"github.com/verspaetungsbegleiter/backend/internal/migrate"
	_ "github.com/verspaetungsbegleiter/backend/internal/metrics" // register Prometheus metrics
	"github.com/verspaetungsbegleiter/backend/internal/routing"
)

func main() {
	cfg := config.Load()
	logger := newLogger(cfg.LogLevel)

	// Server lifetime context — cancelled on shutdown to stop all goroutines.
	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()

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
	coalescer := &hafas.Coalescer{}
	store := journey.NewStore(db, rdb, cfg.JourneyTTLHours, cfg.DBWriteTimeout, logger)
	engine := routing.NewBFSEngine(hafasClient)

	// Functional injection — closures break the journey ← routing ← hafas ← journey cycle.
	fetchUpdates := buildFetchUpdatesFn(hafasClient, coalescer)
	recomputeAlts := buildRecomputeAltsFn(engine)

	pool := journey.NewWorkerPool(cfg.HAFASWorkerPoolSize, cfg.HAFASQueueDepth)
	pollerManager := journey.NewPollerManager(
		serverCtx, store,
		fetchUpdates, recomputeAlts, hafasClient.CircuitState,
		pool,
		30*time.Second, cfg.JourneyTTLHours, logger,
	)

	if err := bootRecovery(serverCtx, store, pollerManager, cfg.JourneyTTLHours, logger); err != nil {
		logger.Warn("boot recovery partial failure", "error", err)
	}

	installLimiter := mw.NewRateLimiter(cfg.RateLimitPerInstall)
	ipLimiter := mw.NewRateLimiter(cfg.RateLimitPerIP)

	go rateLimiterCleanup(serverCtx, installLimiter, ipLimiter)
	go gcJob(serverCtx, db, logger)

	router := api.NewRouter(api.Deps{
		Health:             handlers.NewHealthHandler(db, rdb, cfg.HAFASBaseURL),
		Stations:           handlers.NewStationsHandler(hafasClient, rdb),
		Trains:             handlers.NewTrainsHandler(hafasClient),
		Journeys:           handlers.NewJourneysHandler(store, engine, pollerManager, cfg.MaxActiveJourneys),
		Summary:            handlers.NewSummaryHandler(store),
		Legs:               handlers.NewLegsHandler(store),
		Alternatives:       handlers.NewAlternativesHandler(store, engine),
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

		// 1. Stop accepting new requests; drain in-flight HTTP requests.
		httpCtx, httpCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer httpCancel()
		srv.Shutdown(httpCtx)

		// 2. Cancel all poller goroutines.
		serverCancel()

		// 3. Drain worker pool (bounded by HAFAS_REQUEST_TIMEOUT).
		pool.Shutdown()

		logger.Info("shutdown complete")
		close(done)
	}()

	logger.Info("server starting", "port", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server error", "error", err)
		os.Exit(1)
	}
	<-done
}

// buildFetchUpdatesFn returns a FetchTripUpdatesFn that calls HAFAS via the coalescer.
func buildFetchUpdatesFn(h *hafas.Client, c *hafas.Coalescer) journey.FetchTripUpdatesFn {
	return func(ctx context.Context, legs []journey.Leg) map[string]journey.TripUpdate {
		updates := make(map[string]journey.TripUpdate)
		seen := make(map[string]bool)
		for _, leg := range legs {
			if leg.TripID == "" || leg.IsWalkingSegment || seen[leg.TripID] {
				continue
			}
			seen[leg.TripID] = true
			tripID := leg.TripID

			v, err := c.Do(tripID, func() (any, error) {
				return h.GetTrip(ctx, tripID)
			})
			if err != nil || v == nil {
				continue
			}
			hafasTrip := v.(*hafas.HAFASTrip)
			update := journey.TripUpdate{}
			for _, s := range hafasTrip.Stopovers {
				su := journey.StopoverUpdate{StationID: s.Stop.ID}
				if s.Arrival != nil {
					su.ActualArrival = s.Arrival
				}
				if s.ArrivalDelay != nil {
					su.ArrivalDelaySecs = s.ArrivalDelay
				}
				if s.ArrivalPlatform != nil {
					su.ArrivalPlatform = s.ArrivalPlatform
				}
				if s.Cancelled {
					b := true
					su.Cancelled = &b
				}
				update.Stopovers = append(update.Stopovers, su)
			}
			updates[tripID] = update
		}
		return updates
	}
}

// buildRecomputeAltsFn returns a RecomputeAlternativesFn that calls the routing engine.
func buildRecomputeAltsFn(e routing.Engine) journey.RecomputeAlternativesFn {
	return func(ctx context.Context, j *journey.Journey) []journey.Alternative {
		result, err := e.Route(ctx, routing.RoutingRequest{
			TrainNumber:    j.TrainNumber,
			ToStationID:    j.Destination.ID,
			ToStationName:  j.Destination.Name,
			DepartureAfter: time.Now(),
			Filters:        j.Filters,
			InstallID:      j.InstallID,
		})
		if err != nil {
			return nil
		}
		return result.Alternatives
	}
}

// bootRecovery rehydrates Redis and restarts pollers with a staggered start.
func bootRecovery(ctx context.Context, store *journey.RedisPostgresStore, pm *journey.PollerManager, ttlHours int, logger *slog.Logger) error {
	active, err := store.GetActive(ctx, ttlHours)
	if err != nil {
		return err
	}
	if len(active) == 0 {
		logger.Info("boot recovery: no active journeys")
		return nil
	}
	logger.Info("boot recovery: rehydrating journeys", "count", len(active))

	// Spread poller launches over 10s to avoid a HAFAS burst on restart.
	delay := time.Duration(10000/len(active)) * time.Millisecond

	for _, j := range active {
		pm.Start(j.ID)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	logger.Info("boot recovery complete", "restarted", len(active))
	return nil
}

// gcJob deletes terminated or stale journeys every 30 minutes.
func gcJob(ctx context.Context, db *pgxpool.Pool, logger *slog.Logger) {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			res, err := db.Exec(ctx, `
				WITH to_delete AS (
					SELECT id FROM journeys
					WHERE (terminated_at IS NOT NULL OR created_at < now() - interval '6 hours')
					FOR UPDATE SKIP LOCKED
				)
				DELETE FROM journeys WHERE id IN (SELECT id FROM to_delete)
			`)
			if err != nil {
				logger.Warn("GC job error", "error", err)
				continue
			}
			if n := res.RowsAffected(); n > 0 {
				logger.Info("GC job complete", "deleted", n)
			}
		}
	}
}

func rateLimiterCleanup(ctx context.Context, limiters ...*mw.RateLimiter) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, rl := range limiters {
				rl.Cleanup(2 * time.Minute)
			}
		}
	}
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
