package engine

import (
	"fmt"
	"time"

	"github.com/vektorfleet/backend/internal/domain"
)

// Hardware-agnostic telemetry ingestion.
//
// VektorFleet never asks a customer to change hardware. Every supported vendor
// posts a differently-shaped payload; the adapters below flatten them into one
// canonical domain.TelemetryPing. Adding a tracker brand means adding one entry
// to Adapters — nothing else in the platform changes.

// AdapterContext lets the caller supply identity the vendor payload omits.
type AdapterContext struct {
	VehicleID string
	DeviceID  string
}

// Adapter normalises one vendor's payload shape.
type Adapter struct {
	Vendor      domain.GpsVendorID
	Label       string
	Integration string
	DocsURL     string
	Normalise   func(raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error)
}

// Adapters is the vendor registry, keyed by vendor identifier.
var Adapters = map[domain.GpsVendorID]Adapter{
	domain.VendorCarTrack: {
		Vendor:      domain.VendorCarTrack,
		Label:       "CarTrack",
		Integration: "Partner REST endpoint — poll every 60s per device ID.",
		DocsURL:     "https://www.cartrack.co.ke/",
		Normalise: func(raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error) {
			odo := num(raw["Odometer"]) * 0.001
			fuel := num(raw["Fuel1"]) * 0.01
			ping := domain.TelemetryPing{
				VehicleID:  ctx.VehicleID,
				DeviceID:   firstNonEmpty(ctx.DeviceID, str(raw["DeviceID"])),
				Vendor:     domain.VendorCarTrack,
				TS:         tsFrom(firstNonNil(raw["Timestamp"], raw["EventTime"])),
				Position:   domain.Point{Lat: coord(firstNonNil(raw["Lat"], raw["Latitude"])), Lng: coord(firstNonNil(raw["Lon"], raw["Longitude"]))},
				SpeedKph:   num(raw["Speed"]),
				HeadingDeg: num(firstNonNil(raw["Heading"], raw["Course"])),
				Ignition:   truthy(raw["Ignition"]),
			}
			if raw["Odometer"] != nil {
				ping.OdometerKm = &odo
			}
			if raw["Fuel1"] != nil {
				ping.FuelLevelL = &fuel
			}
			return ping, nil
		},
	},
	domain.VendorSafeRide: {
		Vendor:      domain.VendorSafeRide,
		Label:       "SafeRide",
		Integration: "Webhook push — configure the VektorFleet ingest URL on the customer account.",
		DocsURL:     "https://saferide.co.ke/",
		Normalise: func(raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error) {
			ping := domain.TelemetryPing{
				VehicleID:  firstNonEmpty(ctx.VehicleID, str(raw["vehicle_id"])),
				DeviceID:   ctx.DeviceID,
				Vendor:     domain.VendorSafeRide,
				TS:         tsFrom(raw["date_time"]),
				Position:   domain.Point{Lat: coord(raw["latitude"]), Lng: coord(raw["longitude"])},
				SpeedKph:   num(raw["velocity_kmh"]),
				HeadingDeg: num(raw["direction"]),
				Ignition:   truthy(raw["acc_status"]),
			}
			if raw["mileage_km"] != nil {
				odo := num(raw["mileage_km"])
				ping.OdometerKm = &odo
			}
			if raw["fuel_litres"] != nil {
				fuel := num(raw["fuel_litres"])
				ping.FuelLevelL = &fuel
			}
			return ping, nil
		},
	},
	domain.VendorTeltonika: {
		Vendor:      domain.VendorTeltonika,
		Label:       "Teltonika FMB (Codec 8 / TCP)",
		Integration: "Raw TCP AVL stream opened by the device to the VektorFleet ingest node.",
		DocsURL:     "https://wiki.teltonika-gps.com/",
		Normalise: func(raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error) {
			gps := asMap(raw["gps"])
			io := asMap(raw["io"])
			ping := domain.TelemetryPing{
				VehicleID:  ctx.VehicleID,
				DeviceID:   firstNonEmpty(ctx.DeviceID, str(raw["imei"])),
				Vendor:     domain.VendorTeltonika,
				TS:         tsFrom(firstNonNil(raw["ts"], gps["timestamp"])),
				Position:   domain.Point{Lat: coord(gps["lat"]), Lng: coord(gps["lon"])},
				SpeedKph:   num(gps["spd"]),
				HeadingDeg: num(gps["ang"]),
				Ignition:   truthy(io["239"]),
			}
			// Teltonika reports total odometer in metres on AVL ID 16.
			if io["16"] != nil {
				odo := num(io["16"]) / 1000
				ping.OdometerKm = &odo
			}
			if io["48"] != nil {
				fuel := num(io["48"]) / 10
				ping.FuelLevelL = &fuel
			}
			return ping, nil
		},
	},
	domain.VendorRuptela: {
		Vendor:      domain.VendorRuptela,
		Label:       "Ruptela FM (EcoDrive)",
		Integration: "FMS/AVL REST pull with per-device API keys.",
		DocsURL:     "https://ruptela.com/",
		Normalise: func(raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error) {
			ping := domain.TelemetryPing{
				VehicleID:  ctx.VehicleID,
				DeviceID:   firstNonEmpty(ctx.DeviceID, str(raw["tracker_id"])),
				Vendor:     domain.VendorRuptela,
				TS:         tsFrom(raw["timestamp_utc"]),
				Position:   domain.Point{Lat: coord(raw["gps_lat"]), Lng: coord(raw["gps_lng"])},
				SpeedKph:   num(raw["gps_speed"]),
				HeadingDeg: num(raw["gps_angle"]),
				Ignition:   truthy(raw["ignition_status"]),
			}
			if raw["total_odometer_km"] != nil {
				odo := num(raw["total_odometer_km"])
				ping.OdometerKm = &odo
			}
			if raw["fuel_level_l"] != nil {
				fuel := num(raw["fuel_level_l"])
				ping.FuelLevelL = &fuel
			}
			return ping, nil
		},
	},
	domain.VendorGenericTCP: {
		Vendor:      domain.VendorGenericTCP,
		Label:       "Generic JT/T 808 or NMEA gateway",
		Integration: "Any gateway that can POST JSON to the ingest endpoint.",
		Normalise: func(raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error) {
			ping := domain.TelemetryPing{
				VehicleID:  ctx.VehicleID,
				DeviceID:   firstNonEmpty(ctx.DeviceID, str(raw["device"])),
				Vendor:     domain.VendorGenericTCP,
				TS:         tsFrom(firstNonNil(raw["time"], raw["timestamp"])),
				Position:   domain.Point{Lat: coord(raw["lat"]), Lng: coord(raw["lng"])},
				SpeedKph:   num(raw["speed"]),
				HeadingDeg: num(raw["heading"]),
				Ignition:   truthy(raw["ignition"]),
			}
			if raw["odometer_km"] != nil {
				odo := num(raw["odometer_km"])
				ping.OdometerKm = &odo
			}
			if raw["fuel_l"] != nil {
				fuel := num(raw["fuel_l"])
				ping.FuelLevelL = &fuel
			}
			return ping, nil
		},
	},
}

// AdapterInfo is the catalogue entry the integrations console renders.
type AdapterInfo struct {
	Vendor      domain.GpsVendorID `json:"vendor"`
	Label       string             `json:"label"`
	Integration string             `json:"integration"`
	DocsURL     string             `json:"docsUrl"`
}

// SupportedVendors lists every registered adapter in a stable order.
func SupportedVendors() []AdapterInfo {
	order := []domain.GpsVendorID{
		domain.VendorCarTrack,
		domain.VendorSafeRide,
		domain.VendorTeltonika,
		domain.VendorRuptela,
		domain.VendorGenericTCP,
	}
	out := make([]AdapterInfo, 0, len(order))
	for _, v := range order {
		a := Adapters[v]
		out = append(out, AdapterInfo{Vendor: a.Vendor, Label: a.Label, Integration: a.Integration, DocsURL: a.DocsURL})
	}
	return out
}

// Normalise converts a single vendor payload into the canonical shape.
func Normalise(vendor domain.GpsVendorID, raw map[string]any, ctx AdapterContext) (domain.TelemetryPing, error) {
	adapter, ok := Adapters[vendor]
	if !ok {
		return domain.TelemetryPing{}, fmt.Errorf("unsupported GPS vendor %q", vendor)
	}
	return adapter.Normalise(raw, ctx)
}

// IngestBatch normalises a batch for one already-resolved device and drops
// samples with no usable fix.
//
// The device is resolved before ingestion and passed in, deliberately: a payload
// that carries only an IMEI must be matched to the plate the fleet actually owns,
// not trusted to assert its own identity.
//
// A batch for an unknown vendor is an error rather than an empty success, so an
// integrator pointing at the wrong endpoint is told so instead of watching nothing
// happen.
func IngestBatch(vendor domain.GpsVendorID, raws []map[string]any, ctx AdapterContext) ([]domain.TelemetryPing, error) {
	if _, ok := Adapters[vendor]; !ok {
		return nil, fmt.Errorf("unsupported GPS vendor %q", vendor)
	}

	out := make([]domain.TelemetryPing, 0, len(raws))
	for _, raw := range raws {
		ping, err := Normalise(vendor, raw, ctx)
		if err != nil {
			continue
		}
		if !isUsableFix(ping) {
			continue
		}
		ping.VehicleID = ctx.VehicleID
		ping.DeviceID = ctx.DeviceID
		ping.Vendor = vendor
		out = append(out, ping)
	}
	return out, nil
}

func isUsableFix(p domain.TelemetryPing) bool {
	if p.Position.Lat != p.Position.Lat || p.Position.Lng != p.Position.Lng { // NaN check
		return false
	}
	if p.Position.Lat < -90 || p.Position.Lat > 90 {
		return false
	}
	if p.Position.Lng < -180 || p.Position.Lng > 180 {
		return false
	}
	// (0,0) is the classic "tracker never got a fix" sentinel.
	if p.Position.Lat == 0 && p.Position.Lng == 0 {
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Payload coercion helpers
//
// Vendor payloads arrive from JSON, so numbers are float64, strings are string,
// and anything can be missing. These helpers make that explicit rather than
// letting a zero value masquerade as real data.
// ---------------------------------------------------------------------------

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func num(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		var parsed float64
		if _, err := fmt.Sscanf(n, "%g", &parsed); err == nil {
			return parsed
		}
	}
	return 0
}

// coord returns NaN for a missing or corrupt value, so the sample is rejected
// rather than silently placing the vehicle in the Gulf of Guinea.
func coord(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		var parsed float64
		if _, err := fmt.Sscanf(n, "%g", &parsed); err == nil {
			return parsed
		}
	}
	return nan()
}

func nan() float64 {
	var zero float64
	return zero / zero
}

func truthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case float64:
		return t == 1
	case string:
		return t == "1" || t == "true" || t == "ACC_ON" || t == "on"
	case int:
		return t == 1
	}
	return false
}

func tsFrom(v any) time.Time {
	switch t := v.(type) {
	case float64:
		// Ten-digit values are seconds, thirteen-digit are milliseconds.
		if t < 1e12 {
			return time.UnixMilli(int64(t * 1000)).UTC()
		}
		return time.UnixMilli(int64(t)).UTC()
	case int64:
		if t < 1e12 {
			return time.UnixMilli(t * 1000).UTC()
		}
		return time.UnixMilli(t).UTC()
	case string:
		if parsed, err := time.Parse(time.RFC3339, t); err == nil {
			return parsed.UTC()
		}
	}
	return time.Now().UTC()
}

func firstNonNil(values ...any) any {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
