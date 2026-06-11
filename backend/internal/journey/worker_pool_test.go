package journey_test

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

func TestWorkerPool_ExecutesTasks(t *testing.T) {
	var count atomic.Int64
	pool := journey.NewWorkerPool(4, 20)

	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		pool.Submit(func() {
			defer wg.Done()
			count.Add(1)
		})
	}
	wg.Wait()
	pool.Shutdown()

	if count.Load() != 10 {
		t.Errorf("expected 10 tasks executed, got %d", count.Load())
	}
}

func TestWorkerPool_DropWhenFull(t *testing.T) {
	var executed atomic.Int64
	pool := journey.NewWorkerPool(1, 1)

	started := make(chan struct{})
	unblock := make(chan struct{})
	pool.Submit(func() {
		close(started)
		<-unblock
	})
	<-started

	dropped := false
	for range 5 {
		if !pool.Submit(func() { executed.Add(1) }) {
			dropped = true
			break
		}
	}
	close(unblock)
	pool.Shutdown()

	if !dropped {
		t.Error("expected at least one task to be dropped when pool is full")
	}
}

func TestWorkerPool_Shutdown_WaitsForDrain(t *testing.T) {
	var count atomic.Int64
	pool := journey.NewWorkerPool(2, 10)
	for range 5 {
		pool.Submit(func() {
			time.Sleep(5 * time.Millisecond)
			count.Add(1)
		})
	}
	pool.Shutdown()
	if count.Load() < 5 {
		t.Errorf("shutdown returned before tasks completed: executed %d/5", count.Load())
	}
}
