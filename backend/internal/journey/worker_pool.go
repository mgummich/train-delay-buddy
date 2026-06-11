package journey

import "sync"

// WorkerPool is a bounded goroutine pool for HAFAS fetch tasks.
// When the task channel is full, Submit returns false and drops the task —
// the poller goroutine retains last-known state for that tick.
type WorkerPool struct {
	tasks chan func()
	wg    sync.WaitGroup
}

// NewWorkerPool creates a pool with size worker goroutines and a task channel of depth.
func NewWorkerPool(size, depth int) *WorkerPool {
	p := &WorkerPool{tasks: make(chan func(), depth)}
	for range size {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for task := range p.tasks {
				task()
			}
		}()
	}
	return p
}

// Submit enqueues task without blocking. Returns false if channel is full (task dropped).
func (p *WorkerPool) Submit(task func()) bool {
	select {
	case p.tasks <- task:
		return true
	default:
		return false
	}
}

// Shutdown closes the task channel and waits for all in-flight tasks to complete.
// Must be called exactly once after all Submit calls are done.
func (p *WorkerPool) Shutdown() {
	close(p.tasks)
	p.wg.Wait()
}
