package hafas_test

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/verspaetungsbegleiter/backend/internal/hafas"
)

func TestCoalescer_DeduplicatesConcurrentCalls(t *testing.T) {
	var callCount atomic.Int64
	c := &hafas.Coalescer{}

	start := make(chan struct{})
	var wg sync.WaitGroup

	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			c.Do("same-key", func() (any, error) {
				callCount.Add(1)
				time.Sleep(20 * time.Millisecond)
				return "result", nil
			})
		}()
	}
	close(start)
	wg.Wait()

	if callCount.Load() >= 10 {
		t.Errorf("expected deduplication; function called %d times (want < 10)", callCount.Load())
	}
}

func TestCoalescer_DifferentKeysAreIndependent(t *testing.T) {
	var callCount atomic.Int64
	c := &hafas.Coalescer{}

	c.Do("key-a", func() (any, error) { callCount.Add(1); return nil, nil })
	c.Do("key-b", func() (any, error) { callCount.Add(1); return nil, nil })

	if callCount.Load() != 2 {
		t.Errorf("expected 2 calls for 2 different keys, got %d", callCount.Load())
	}
}

func TestCoalescer_PropagatesError(t *testing.T) {
	c := &hafas.Coalescer{}
	_, err := c.Do("err-key", func() (any, error) {
		return nil, hafas.ErrCircuitOpen
	})
	if err == nil {
		t.Fatal("expected error to be propagated")
	}
}
