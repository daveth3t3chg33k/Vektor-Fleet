// Package api exposes the platform over HTTP.
//
// Handlers stay thin: they decode, call an engine, and encode. All JSON shaping
// happens through the helpers in this file so every response has the same
// envelope and every error is machine-readable.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

// envelope is the shape of every successful response.
type envelope struct {
	Data any `json:"data"`
}

// errorBody is the shape of every failed response.
type errorBody struct {
	Error   string `json:"error"`
	Status  int    `json:"status"`
	Details string `json:"details,omitempty"`
}

// writeData writes a successful response inside the data envelope.
func writeData(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, envelope{Data: data})
}

// writeJSON encodes a payload. Encoding happens into a buffer first so a marshal
// failure cannot leave a half-written body with a 200 status already sent.
func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("failed to marshal response", "err", err)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal server error","status":500}`))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// writeError writes a machine-readable error envelope.
func writeError(w http.ResponseWriter, status int, message string, details string) {
	writeJSON(w, status, errorBody{Error: message, Status: status, Details: details})
}

// decodeJSON strictly decodes a request body.
//
// Unknown fields are rejected rather than ignored: an integration posting
// `phone_number` instead of `phone` should be told, not silently handed an empty
// conversation.
func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return fmt.Errorf("request body is empty")
		}
		return err
	}
	return nil
}
