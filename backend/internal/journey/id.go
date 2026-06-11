package journey

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
)

// NewID generates a journey ID matching ^jrn_[0-9a-z]{26}$.
// Uses 16 random bytes encoded as lowercase base32 (no padding) = 26 chars.
// base32 alphabet a–z + 2–7 ⊆ [0-9a-z].
func NewID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic("journey.NewID: crypto/rand unavailable: " + err.Error())
	}
	enc := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	return "jrn_" + enc
}
