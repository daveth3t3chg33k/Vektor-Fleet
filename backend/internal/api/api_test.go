package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vektorfleet/backend/internal/store"
)

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	anchor := time.Date(2026, 3, 14, 9, 0, 0, 0, time.UTC)
	st := store.New(anchor)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv := NewServer(st, Config{
		AllowedOrigins: []string{"http://localhost:3000"},
		Version:        "test",
		Now:            func() time.Time { return anchor },
	}, logger)
	return srv.Handler()
}

// getJSON performs a GET and decodes the data envelope.
func getJSON(t *testing.T, h http.Handler, path string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	var body map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("GET %s: invalid JSON: %v", path, err)
		}
	}
	return rec.Code, body
}

func TestHealthEndpoint(t *testing.T) {
	h := newTestHandler(t)
	code, body := getJSON(t, h, "/api/health")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatal("missing data envelope")
	}
	if data["status"] != "ok" {
		t.Errorf("status field = %v, want ok", data["status"])
	}
	if data["vehicles"].(float64) == 0 {
		t.Error("expected a non-zero vehicle count")
	}
}

func TestAllReadEndpointsRespond(t *testing.T) {
	h := newTestHandler(t)
	paths := []string{
		"/api/health",
		"/api/fleet/summary",
		"/api/vehicles",
		"/api/fuel/audit",
		"/api/compliance",
		"/api/whatsapp/thread",
		"/api/integrations",
	}
	for _, path := range paths {
		code, body := getJSON(t, h, path)
		if code != http.StatusOK {
			t.Errorf("GET %s: status = %d, want 200", path, code)
			continue
		}
		if _, ok := body["data"]; !ok {
			t.Errorf("GET %s: missing data envelope", path)
		}
	}
}

func TestVehicleEndpointByIDAndPlate(t *testing.T) {
	h := newTestHandler(t)

	// Discover a real plate from the register, then fetch by both keys.
	_, list := getJSON(t, h, "/api/vehicles")
	data := list["data"].(map[string]any)
	vehicles := data["vehicles"].([]any)
	if len(vehicles) == 0 {
		t.Fatal("no vehicles in register")
	}
	first := vehicles[0].(map[string]any)["vehicle"].(map[string]any)
	id := first["id"].(string)
	plate := first["plate"].(string)

	for _, key := range []string{id, plate} {
		code, body := getJSON(t, h, "/api/vehicles/"+key)
		if code != http.StatusOK {
			t.Fatalf("GET /api/vehicles/%s: status = %d", key, code)
		}
		payload := body["data"].(map[string]any)
		if payload["snapshot"] == nil {
			t.Errorf("vehicle %s: missing snapshot", key)
		}
	}
}

func TestVehicleNotFound(t *testing.T) {
	h := newTestHandler(t)
	code, body := getJSON(t, h, "/api/vehicles/nope-999")
	if code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", code)
	}
	if body["error"] == nil {
		t.Error("expected an error envelope")
	}
}

func TestVehicleFilterByStatus(t *testing.T) {
	h := newTestHandler(t)
	code, body := getJSON(t, h, "/api/vehicles?status=active")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	data := body["data"].(map[string]any)
	vehicles := data["vehicles"].([]any)
	for _, raw := range vehicles {
		status := raw.(map[string]any)["vehicle"].(map[string]any)["status"]
		if status != "active" {
			t.Errorf("filter leaked a %v vehicle", status)
		}
	}
}

func TestWhatsAppThreadAndInboundTurn(t *testing.T) {
	h := newTestHandler(t)

	_, thread := getJSON(t, h, "/api/whatsapp/thread")
	data := thread["data"].(map[string]any)
	roster := data["roster"].([]any)
	if len(roster) == 0 {
		t.Fatal("expected a non-empty roster")
	}
	phone := roster[0].(map[string]any)["phone"].(string)

	post := func(body map[string]any) (int, map[string]any) {
		payload, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/whatsapp/inbound", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	code, turn := post(map[string]any{"phone": phone, "body": "START"})
	if code != http.StatusOK {
		t.Fatalf("inbound status = %d, want 200", code)
	}
	turnData := turn["data"].(map[string]any)
	if len(turnData["replies"].([]any)) == 0 {
		t.Error("expected at least one bot reply")
	}
	session := turnData["session"].(map[string]any)
	if session["step"] != "PRE_TRIP" {
		t.Errorf("session step = %v, want PRE_TRIP", session["step"])
	}

	code, body := post(map[string]any{"phone": ""})
	if code != http.StatusUnprocessableEntity {
		t.Errorf("missing phone status = %d, want 422", code)
	}
	if body["error"] == nil {
		t.Error("expected an error envelope for a missing phone")
	}
}

func TestTelemetryIngestRejectsUnknownFields(t *testing.T) {
	h := newTestHandler(t)
	payload := []byte(`{"vendor":"cartrack","vehicleId":"v1","deviceId":"d1","pings":[],"bogus":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/telemetry/ingest", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for an unknown field", rec.Code)
	}
}

func TestTelemetryIngestAcceptsValidBatch(t *testing.T) {
	h := newTestHandler(t)
	payload := []byte(`{
		"vendor":"generic_tcp",
		"vehicleId":"veh-1",
		"deviceId":"dev-1",
		"pings":[{"lat":-1.2921,"lng":36.8219,"timestamp":"2026-03-14T09:00:00Z","speed":42}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/telemetry/ingest", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	data := body["data"].(map[string]any)
	if data["accepted"].(float64) != 1 {
		t.Errorf("accepted = %v, want 1", data["accepted"])
	}
}

func TestCORSPreflightAndAllowList(t *testing.T) {
	h := newTestHandler(t)

	// Allowed origin is echoed.
	req := httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Errorf("allowed origin not echoed: %q", got)
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", rec.Code)
	}

	// A foreign origin gets nothing.
	req = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://evil.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("unexpected CORS header for foreign origin: %q", got)
	}
}

func TestRequestIDEchoAndGeneration(t *testing.T) {
	h := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("X-Request-ID", "trace-123")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("X-Request-ID"); got != "trace-123" {
		t.Errorf("upstream request id not honoured: %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("X-Request-ID"); got == "" {
		t.Error("expected a generated request id")
	}
}

func TestMethodMismatchIsNotAllowed(t *testing.T) {
	h := newTestHandler(t)
	req := httptest.NewRequest(http.MethodPost, "/api/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST /api/health status = %d, want 405", rec.Code)
	}
}
