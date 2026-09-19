// Package engine holds VektorFleet's domain logic: telemetry reconstruction, the
// fuel-match engine, compliance scheduling, the WhatsApp driver assistant and
// fleet analytics.
//
// Every engine is a plain function over the store. There is no hidden state and
// no global singleton, so each one is directly testable and safe to call
// concurrently.
package engine

import (
	"math"
	"sort"
	"time"

	"github.com/vektorfleet/backend/internal/corridors"
	"github.com/vektorfleet/backend/internal/domain"
	"github.com/vektorfleet/backend/internal/geo"
	"github.com/vektorfleet/backend/internal/store"
)

// PositionSource describes how a position was established.
type PositionSource string

const (
	// SourceTrip means a leg was in progress.
	SourceTrip PositionSource = "trip"
	// SourceParked means the tracker was holding its last known position.
	SourceParked PositionSource = "parked"
	// SourceDepot means the vehicle has no movement history at all.
	SourceDepot PositionSource = "depot"
)

// PositionEstimate answers "where was this vehicle at this instant".
type PositionEstimate struct {
	VehicleID        string
	TS               time.Time
	Point            domain.Point
	Source           PositionSource
	Corridor         string
	CorridorFraction *float64
	Moving           bool
}

// FindTripAt returns the leg in progress at an instant, if any.
func FindTripAt(st *store.Store, vehicleID string, ts time.Time) (domain.Trip, bool) {
	for _, t := range st.TripsFor(vehicleID) {
		if !ts.Before(t.StartTS) && !ts.After(t.EndTS) {
			return t, true
		}
	}
	return domain.Trip{}, false
}

// LastTripBefore returns the most recent leg that had already finished.
func LastTripBefore(st *store.Store, vehicleID string, ts time.Time) (domain.Trip, bool) {
	var latest domain.Trip
	found := false
	for _, t := range st.TripsFor(vehicleID) {
		if t.EndTS.After(ts) {
			continue
		}
		if !found || t.EndTS.After(latest.EndTS) {
			latest, found = t, true
		}
	}
	return latest, found
}

// PositionAt reconstructs where a vehicle was.
//
// Between legs a real tracker keeps reporting its last known position, which is
// wherever the previous journey ended. Modelling that honestly is what stops the
// fuel engine's location check from crying wolf on a fill taken at a
// mid-corridor stop.
func PositionAt(st *store.Store, vehicleID string, ts time.Time) (PositionEstimate, bool) {
	vehicle, ok := st.Vehicle(vehicleID)
	if !ok {
		return PositionEstimate{}, false
	}

	if trip, found := FindTripAt(st, vehicleID, ts); found {
		corridor := corridors.ByID[trip.Corridor]
		start, end := trip.StartTS, trip.EndTS
		progress := float64(ts.Sub(start)) / math.Max(1, float64(end.Sub(start)))
		frac := trip.StartFraction + (trip.EndFraction-trip.StartFraction)*progress
		fraction := frac
		return PositionEstimate{
			VehicleID:        vehicleID,
			TS:               ts,
			Point:            geo.PointAlongPolyline(corridor.Waypoints, clamp01(frac)),
			Source:           SourceTrip,
			Corridor:         trip.Corridor,
			CorridorFraction: &fraction,
			Moving:           true,
		}, true
	}

	if previous, found := LastTripBefore(st, vehicleID, ts); found {
		corridor := corridors.ByID[previous.Corridor]
		fraction := previous.EndFraction
		return PositionEstimate{
			VehicleID:        vehicleID,
			TS:               ts,
			Point:            geo.PointAlongPolyline(corridor.Waypoints, clamp01(previous.EndFraction)),
			Source:           SourceParked,
			Corridor:         previous.Corridor,
			CorridorFraction: &fraction,
			Moving:           false,
		}, true
	}

	return PositionEstimate{
		VehicleID: vehicleID,
		TS:        ts,
		Point:     corridors.DepotPoint(vehicle.HomeDepot),
		Source:    SourceDepot,
		Corridor:  vehicle.Corridor,
		Moving:    false,
	}, true
}

// DescribeTrackedState renders a position source as readable evidence.
func DescribeTrackedState(source PositionSource) string {
	switch source {
	case SourceTrip:
		return " on route"
	case SourceParked:
		return " stopped at its last known position"
	default:
		return " parked at its home depot"
	}
}

// DistanceInWindow returns the distance actually driven in a window. Partial
// trips are pro-rated by time, which is accurate enough for fuel reconciliation
// and immune to GPS drift.
func DistanceInWindow(st *store.Store, vehicleID string, from, to time.Time) float64 {
	total := 0.0
	for _, trip := range st.TripsFor(vehicleID) {
		if trip.EndTS.Before(from) || trip.StartTS.After(to) {
			continue
		}
		duration := math.Max(1, float64(trip.EndTS.Sub(trip.StartTS)))
		overlapStart := trip.StartTS
		if from.After(overlapStart) {
			overlapStart = from
		}
		overlapEnd := trip.EndTS
		if to.Before(overlapEnd) {
			overlapEnd = to
		}
		overlap := float64(overlapEnd.Sub(overlapStart))
		if overlap <= 0 {
			continue
		}
		total += trip.DistanceKm * (overlap / duration)
	}
	return total
}

// ExpectedLitresFor returns the fuel a distance should have consumed at a
// vehicle's nominal efficiency.
func ExpectedLitresFor(vehicle domain.Vehicle, distanceKm float64) float64 {
	return distanceKm / math.Max(0.1, vehicle.KmPerLitre)
}

// PingsFor returns raw fixes in a window, oldest first.
func PingsFor(st *store.Store, vehicleID string, from, to time.Time) []domain.TelemetryPing {
	var out []domain.TelemetryPing
	for _, p := range st.Telemetry() {
		if p.VehicleID != vehicleID {
			continue
		}
		if p.TS.Before(from) || p.TS.After(to) {
			continue
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TS.Before(out[j].TS) })
	return out
}

// LatestPing returns the most recent fix on record for a vehicle.
func LatestPing(st *store.Store, vehicleID string, since time.Time) (domain.TelemetryPing, bool) {
	pings := PingsFor(st, vehicleID, since, time.Now().Add(24*time.Hour))
	if len(pings) == 0 {
		return domain.TelemetryPing{}, false
	}
	return pings[len(pings)-1], true
}

// DenoisePings drops stationary GPS drift and impossible jumps.
func DenoisePings(pings []domain.TelemetryPing, maxJumpKm float64) []domain.TelemetryPing {
	out := make([]domain.TelemetryPing, 0, len(pings))
	for _, ping := range pings {
		if len(out) > 0 {
			prev := out[len(out)-1]
			jump := geo.HaversineKm(prev.Position, ping.Position)
			gapMin := math.Max(0.05, ping.TS.Sub(prev.TS).Minutes())
			// Reject jumps that imply over 140 km/h; keep genuine movement.
			if jump > maxJumpKm && jump/(gapMin/60) > 140 {
				continue
			}
		}
		out = append(out, ping)
	}
	return out
}

// GPSDistanceKm measures geodesic distance over a ping series.
func GPSDistanceKm(pings []domain.TelemetryPing, minStepKm float64) float64 {
	clean := DenoisePings(pings, 3)
	total := 0.0
	for i := 1; i < len(clean); i++ {
		if step := geo.HaversineKm(clean[i-1].Position, clean[i].Position); step >= minStepKm {
			total += step
		}
	}
	return total
}

// OverspeedEvent is a recorded breach of the governor limit.
type OverspeedEvent struct {
	VehicleID string
	TS        time.Time
	SpeedKph  float64
	LimitKph  float64
	Position  domain.Point
}

// OverspeedEvents lists breaches with a tolerance so noise does not raise alerts.
func OverspeedEvents(pings []domain.TelemetryPing, limitKph, toleranceKph float64) []OverspeedEvent {
	var events []OverspeedEvent
	for _, p := range DenoisePings(pings, 3) {
		if p.SpeedKph > limitKph+toleranceKph {
			events = append(events, OverspeedEvent{
				VehicleID: p.VehicleID,
				TS:        p.TS,
				SpeedKph:  math.Round(p.SpeedKph),
				LimitKph:  limitKph,
				Position:  p.Position,
			})
		}
	}
	return events
}

// IdlingMinutes sums stationary-with-ignition time, bounding the gap to the next
// fix so a parked vehicle does not inflate the number.
func IdlingMinutes(pings []domain.TelemetryPing, maxGapMinutes float64) float64 {
	total := 0.0
	for i := 0; i < len(pings)-1; i++ {
		ping := pings[i]
		if !ping.Ignition || ping.SpeedKph >= 3 {
			continue
		}
		gap := pings[i+1].TS.Sub(ping.TS).Minutes()
		if gap > 0 && gap <= maxGapMinutes {
			total += gap
		}
	}
	return math.Round(total)
}

// CorridorDeviationKm reports how far a vehicle strayed from its modelled route.
func CorridorDeviationKm(st *store.Store, vehicleID string, ts time.Time) float64 {
	vehicle, ok := st.Vehicle(vehicleID)
	if !ok {
		return 0
	}
	position, ok := PositionAt(st, vehicleID, ts)
	if !ok {
		return 0
	}
	return geo.DistanceToCorridorKm(position.Point, corridors.ByID[vehicle.Corridor].Waypoints)
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }
