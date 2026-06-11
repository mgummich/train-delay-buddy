package problem

import (
	"encoding/json"
	"net/http"
)

// Problem is an RFC 7807 problem details object.
type Problem struct {
	Type     string       `json:"type"`
	Title    string       `json:"title"`
	Status   int          `json:"status"`
	Detail   string       `json:"detail,omitempty"`
	Instance string       `json:"instance,omitempty"`
	Errors   []FieldError `json:"errors,omitempty"`
}

// FieldError is a field-level validation error included on 422 responses.
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Write serialises p as application/problem+json.
func Write(w http.ResponseWriter, r *http.Request, p Problem) {
	if p.Instance == "" && r != nil {
		p.Instance = r.URL.Path
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Link", `<https://verspaetungsbegleiter.app/errors>; rel="describedby"`)
	w.WriteHeader(p.Status)
	json.NewEncoder(w).Encode(p)
}
