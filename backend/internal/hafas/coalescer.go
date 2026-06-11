package hafas

import "golang.org/x/sync/singleflight"

// Coalescer deduplicates concurrent HAFAS fetches keyed on (trainNumber, date) or tripId.
type Coalescer struct {
	group singleflight.Group
}

// Do calls fn if no in-flight call with key exists; otherwise joins the in-flight call.
func (c *Coalescer) Do(key string, fn func() (any, error)) (any, error) {
	v, err, _ := c.group.Do(key, fn)
	return v, err
}
