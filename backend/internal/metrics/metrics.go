package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	HAFASFetchTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "hafas_fetch_total",
			Help: "Outbound HAFAS calls by status.",
		},
		[]string{"status"},
	)

	HAFASFetchDuration = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "hafas_fetch_duration_seconds",
			Help:    "HAFAS request latency.",
			Buckets: prometheus.DefBuckets,
		},
	)

	ActiveJourneys = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "active_journeys_total",
			Help: "Currently active poller goroutines.",
		},
	)

	PollETag304Total = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "poll_etag_304_total",
			Help: "Frontend summary polls returning 304 Not Modified.",
		},
	)

	PollETag200Total = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "poll_etag_200_total",
			Help: "Frontend summary polls returning 200 OK.",
		},
	)

	RedisMissTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "redis_miss_total",
			Help: "Redis miss → Postgres fallback.",
		},
	)

	CoalescerDedupTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "coalescer_dedup_total",
			Help: "HAFAS requests deduplicated by singleflight.",
		},
	)

	HAFASTimeoutTotal = promauto.NewCounter(
		prometheus.CounterOpts{
			Name: "hafas_timeout_total",
			Help: "HAFAS calls that exceeded the configured request timeout.",
		},
	)

	HAFASCircuitState = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "hafas_circuit_state",
			Help: "HAFAS circuit breaker state: 0=closed, 1=half-open, 2=open.",
		},
	)

	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency by path and status code.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"path", "status"},
	)
)
