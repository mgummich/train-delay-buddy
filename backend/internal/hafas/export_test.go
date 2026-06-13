package hafas

func (c *Client) RecordFailureForTest() { c.cb.recordFailure() }
