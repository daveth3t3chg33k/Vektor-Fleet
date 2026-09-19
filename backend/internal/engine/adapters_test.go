package engine

import (
	"testing"

	"github.com/vektorfleet/backend/internal/domain"
)

var adapterCases = []struct {
	vendor domain.GpsVendorID
	raw    map[string]any
}{
	{domain.VendorCarTrack, map[string]any{"Lat": -1.2921, "Lon": 36.8219, "Timestamp": 1_773_000_000_000.0, "Speed": 62.0, "Heading": 180.0, "Ignition": true, "Odometer": 154_320_000.0}},
	{domain.VendorSafeRide, map[string]any{"latitude": -1.2921, "longitude": 36.8219, "date_time": "2026-03-14T09:00:00Z", "velocity_kmh": 55.0, "acc_status": "1", "mileage_km": 88340.0}},
	{domain.VendorTeltonika, map[string]any{"gps": map[string]any{"lat": -1.2921, "lon": 36.8219, "spd": 48.0, "ang": 90.0}, "io": map[string]any{"239": 1.0, "16": 88_340_000.0}}},
	{domain.VendorRuptela, map[string]any{"gps_lat": -1.2921, "gps_lng": 36.8219, "timestamp_utc": "2026-03-14T09:00:00Z", "gps_speed": 44.0, "ignition_status": true}},
	{domain.VendorGenericTCP, map[string]any{"lat": -1.2921, "lng": 36.8219, "timestamp": "2026-03-14T09:00:00Z", "speed": 30.0, "ignition": true}},
}

func TestEveryAdapterNormalisesToTheSameShape(t *testing.T) {
	ctx := AdapterContext{VehicleID: "veh-1", DeviceID: "dev-1"}

	for _, tc := range adapterCases {
		t.Run(string(tc.vendor), func(t *testing.T) {
			ping, err := Normalise(tc.vendor, tc.raw, ctx)
			if err != nil {
				t.Fatalf("normalise failed: %v", err)
			}
			if ping.Vendor != tc.vendor {
				t.Errorf("vendor = %s, want %s", ping.Vendor, tc.vendor)
			}
			if ping.VehicleID != "veh-1" || ping.DeviceID != "dev-1" {
				t.Errorf("identity not carried: %s/%s", ping.VehicleID, ping.DeviceID)
			}
			if ping.Position.Lat == 0 || ping.Position.Lng == 0 {
				t.Errorf("position not parsed: %+v", ping.Position)
			}
			if ping.TS.IsZero() {
				t.Error("timestamp not parsed")
			}
			if ping.SpeedKph <= 0 {
				t.Errorf("speed not parsed: %f", ping.SpeedKph)
			}
		})
	}
}

func TestUnsupportedVendorIsAnError(t *testing.T) {
	if _, err := Normalise("does-not-exist", map[string]any{}, AdapterContext{}); err == nil {
		t.Error("expected an error for an unsupported vendor")
	}
	if _, err := IngestBatch("does-not-exist", []map[string]any{{}}, AdapterContext{}); err == nil {
		t.Error("expected IngestBatch to reject an unsupported vendor")
	}
}

func TestIngestBatchDropsUnusableFixes(t *testing.T) {
	ctx := AdapterContext{VehicleID: "veh-1", DeviceID: "dev-1"}
	raws := []map[string]any{
		{"lat": -1.2921, "lng": 36.8219, "timestamp": "2026-03-14T09:00:00Z", "speed": 30.0},
		{"lat": 0, "lng": 0, "timestamp": "2026-03-14T09:01:00Z", "speed": 0.0},       // no-fix sentinel
		{"lat": 999, "lng": 36.8219, "timestamp": "2026-03-14T09:02:00Z", "speed": 0.0}, // out of range
		{"speed": 12.0}, // missing coordinates
	}

	pings, err := IngestBatch(domain.VendorGenericTCP, raws, ctx)
	if err != nil {
		t.Fatalf("ingest failed: %v", err)
	}
	if len(pings) != 1 {
		t.Fatalf("expected exactly one usable fix, got %d", len(pings))
	}
	if pings[0].VehicleID != "veh-1" || pings[0].DeviceID != "dev-1" {
		t.Errorf("identity not forced onto the batch: %+v", pings[0])
	}
}

func TestSupportedVendorsCatalogueIsComplete(t *testing.T) {
	vendors := SupportedVendors()
	if len(vendors) != len(Adapters) {
		t.Errorf("catalogue lists %d vendors but %d are registered", len(vendors), len(Adapters))
	}
	for _, v := range vendors {
		if v.Label == "" || v.Integration == "" {
			t.Errorf("vendor %s is missing catalogue copy", v.Vendor)
		}
	}
}
