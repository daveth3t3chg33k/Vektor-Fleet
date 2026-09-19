package geo

import (
	"math"
	"testing"

	"github.com/vektorfleet/backend/internal/domain"
)

func TestHaversineKnownDistance(t *testing.T) {
	// Nairobi CBD to Mombasa CBD is about 440 km as the crow flies.
	nairobi := domain.Point{Lat: -1.2921, Lng: 36.8219}
	mombasa := domain.Point{Lat: -4.0435, Lng: 39.6682}

	got := HaversineKm(nairobi, mombasa)
	if math.Abs(got-440) > 25 {
		t.Errorf("expected ~440 km, got %.1f km", got)
	}
}

func TestHaversineIsSymmetricAndZeroAtIdentity(t *testing.T) {
	a := domain.Point{Lat: -1.2921, Lng: 36.8219}
	b := domain.Point{Lat: -1.3192, Lng: 36.9278}

	if d := HaversineKm(a, a); d != 0 {
		t.Errorf("distance to self should be 0, got %f", d)
	}
	if forward, backward := HaversineKm(a, b), HaversineKm(b, a); math.Abs(forward-backward) > 1e-9 {
		t.Errorf("distance not symmetric: %f vs %f", forward, backward)
	}
}

func TestPolylineLengthIsSumOfSegments(t *testing.T) {
	line := []domain.Point{
		{Lat: -1.2921, Lng: 36.8219},
		{Lat: -1.3500, Lng: 36.9000},
		{Lat: -1.4500, Lng: 37.0000},
	}
	want := HaversineKm(line[0], line[1]) + HaversineKm(line[1], line[2])
	if got := PolylineLengthKm(line); math.Abs(got-want) > 1e-6 {
		t.Errorf("expected %.4f, got %.4f", want, got)
	}
	if PolylineLengthKm(nil) != 0 {
		t.Error("empty polyline should have zero length")
	}
}

func TestPointAlongPolylineEndpoints(t *testing.T) {
	line := []domain.Point{
		{Lat: -1.2921, Lng: 36.8219},
		{Lat: -2.0000, Lng: 37.5000},
	}

	start := PointAlongPolyline(line, 0)
	if math.Abs(start.Lat-line[0].Lat) > 1e-6 || math.Abs(start.Lng-line[0].Lng) > 1e-6 {
		t.Errorf("fraction 0 should be the first vertex, got %+v", start)
	}

	end := PointAlongPolyline(line, 1)
	if math.Abs(end.Lat-line[1].Lat) > 1e-6 || math.Abs(end.Lng-line[1].Lng) > 1e-6 {
		t.Errorf("fraction 1 should be the last vertex, got %+v", end)
	}
}

func TestPointAlongPolylineMidpointIsBetween(t *testing.T) {
	line := []domain.Point{{Lat: -1.0, Lng: 36.0}, {Lat: -2.0, Lng: 37.0}}
	mid := PointAlongPolyline(line, 0.5)
	if mid.Lat >= -1.0 || mid.Lat <= -2.0 {
		t.Errorf("midpoint latitude %.4f not between endpoints", mid.Lat)
	}
}

func TestDistanceToCorridorOnTheLineIsNearZero(t *testing.T) {
	line := []domain.Point{{Lat: -1.0, Lng: 36.0}, {Lat: -1.0, Lng: 37.0}}
	onLine := domain.Point{Lat: -1.0, Lng: 36.5}
	if d := DistanceToCorridorKm(onLine, line); d > 0.5 {
		t.Errorf("point on the corridor should be ~0 km away, got %.3f", d)
	}

	far := domain.Point{Lat: -1.5, Lng: 36.5}
	if d := DistanceToCorridorKm(far, line); d < 40 {
		t.Errorf("point 0.5 degrees south should be >40 km away, got %.1f", d)
	}
}

func TestBearingBetweenCardinalDirections(t *testing.T) {
	origin := domain.Point{Lat: 0, Lng: 0}

	north := BearingBetween(origin, domain.Point{Lat: 1, Lng: 0})
	if math.Abs(north-0) > 1 && math.Abs(north-360) > 1 {
		t.Errorf("due north should be ~0 degrees, got %.1f", north)
	}

	east := BearingBetween(origin, domain.Point{Lat: 0, Lng: 1})
	if math.Abs(east-90) > 1 {
		t.Errorf("due east should be ~90 degrees, got %.1f", east)
	}
}
