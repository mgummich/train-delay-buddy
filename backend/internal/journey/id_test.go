package journey_test

import (
	"regexp"
	"testing"

	"github.com/verspaetungsbegleiter/backend/internal/journey"
)

var journeyIDPattern = regexp.MustCompile(`^jrn_[0-9a-z]{26}$`)

func TestNewID_MatchesPattern(t *testing.T) {
	id := journey.NewID()
	if !journeyIDPattern.MatchString(id) {
		t.Errorf("NewID() = %q does not match ^jrn_[0-9a-z]{26}$", id)
	}
}

func TestNewID_Unique(t *testing.T) {
	seen := make(map[string]bool, 1000)
	for range 1000 {
		id := journey.NewID()
		if seen[id] {
			t.Fatalf("duplicate ID generated: %q", id)
		}
		seen[id] = true
	}
}
