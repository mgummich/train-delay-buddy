package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
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

	HAFASCircuitState = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "hafas_circuit_state",
			Help: "HAFAS circuit breaker state: 0=closed, 1=half-open, 2=open.",
		},
	)
)
