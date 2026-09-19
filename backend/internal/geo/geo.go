// Package geo implements the small amount of spherical geometry the platform
// needs: distance, corridor projection and interpolation.
//
// Everything here is hand-rolled. The fleet operates inside Kenya, where the
// operations that matter — haversine distance and projecting a point onto a
// polyline — are a few lines of trigonometry. A geometry library would add a
// dependency without adding accuracy at these scales.
package geo

import (
	"math"

	"github.com/vektorfleet/backend/internal/domain"
)

const earthRadiusKm = 6371.0088

func toRad(deg float64) float64 { return deg * math.Pi / 180 }
func toDeg(rad float64) float64 { return rad * 180 / math.Pi }

// HaversineKm returns the great-circle distance between two points in kilometres.
func HaversineKm(a, b domain.Point) float64 {
	dLat := toRad(b.Lat - a.Lat)
	dLng := toRad(b.Lng - a.Lng)
	lat1 := toRad(a.Lat)
	lat2 := toRad(b.Lat)

	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(h)))
}

// projectOnSegment returns the closest point on segment a→b to p, and how far
// along that segment it falls (0 at a, 1 at b).
func projectOnSegment(p, a, b domain.Point) (domain.Point, float64) {
	dx := b.Lng - a.Lng
	dy := b.Lat - a.Lat
	lenSq := dx*dx + dy*dy
	if lenSq == 0 {
		return a, 0
	}
	t := ((p.Lng-a.Lng)*dx + (p.Lat-a.Lat)*dy) / lenSq
	t = math.Max(0, math.Min(1, t))
	return domain.Point{Lat: a.Lat + t*dy, Lng: a.Lng + t*dx}, t
}

// DistanceToCorridorKm returns the shortest distance from a point to a corridor
// centreline.
func DistanceToCorridorKm(p domain.Point, waypoints []domain.Point) float64 {
	if len(waypoints) == 0 {
		return math.Inf(1)
	}
	if len(waypoints) == 1 {
		return HaversineKm(p, waypoints[0])
	}
	best := math.Inf(1)
	for i := 0; i < len(waypoints)-1; i++ {
		projected, _ := projectOnSegment(p, waypoints[i], waypoints[i+1])
		if d := HaversineKm(p, projected); d < best {
			best = d
		}
	}
	return best
}

// PolylineLengthKm returns the total length of a polyline in kilometres.
func PolylineLengthKm(waypoints []domain.Point) float64 {
	total := 0.0
	for i := 1; i < len(waypoints); i++ {
		total += HaversineKm(waypoints[i-1], waypoints[i])
	}
	return total
}

// LerpPoint interpolates linearly between two points.
func LerpPoint(a, b domain.Point, t float64) domain.Point {
	return domain.Point{Lat: a.Lat + (b.Lat-a.Lat)*t, Lng: a.Lng + (b.Lng-a.Lng)*t}
}

// PointAlongPolyline returns the point at fraction f (0-1) of a polyline's
// length, measured in real distance rather than in vertex count.
func PointAlongPolyline(waypoints []domain.Point, f float64) domain.Point {
	switch len(waypoints) {
	case 0:
		return domain.Point{}
	case 1:
		return waypoints[0]
	}

	clamped := math.Max(0, math.Min(1, f))
	cumulative := make([]float64, len(waypoints))
	total := 0.0
	for i := 1; i < len(waypoints); i++ {
		total += HaversineKm(waypoints[i-1], waypoints[i])
		cumulative[i] = total
	}

	target := clamped * total
	for i := 0; i < len(waypoints)-1; i++ {
		if target <= cumulative[i+1] {
			segment := cumulative[i+1] - cumulative[i]
			t := 0.0
			if segment > 0 {
				t = (target - cumulative[i]) / segment
			}
			return LerpPoint(waypoints[i], waypoints[i+1], t)
		}
	}
	return waypoints[len(waypoints)-1]
}

// OffsetPoint moves a point by km along a compass bearing in degrees.
func OffsetPoint(p domain.Point, km, bearingDeg float64) domain.Point {
	bearing := toRad(bearingDeg)
	lat1 := toRad(p.Lat)
	lng1 := toRad(p.Lng)
	angular := km / earthRadiusKm

	lat2 := math.Asin(math.Sin(lat1)*math.Cos(angular) +
		math.Cos(lat1)*math.Sin(angular)*math.Cos(bearing))
	lng2 := lng1 + math.Atan2(
		math.Sin(bearing)*math.Sin(angular)*math.Cos(lat1),
		math.Cos(angular)-math.Sin(lat1)*math.Sin(lat2),
	)
	return domain.Point{Lat: toDeg(lat2), Lng: toDeg(lng2)}
}

// BearingBetween returns the initial compass bearing from a to b, in degrees.
func BearingBetween(a, b domain.Point) float64 {
	lat1 := toRad(a.Lat)
	lat2 := toRad(b.Lat)
	dLng := toRad(b.Lng - a.Lng)

	y := math.Sin(dLng) * math.Cos(lat2)
	x := math.Cos(lat1)*math.Sin(lat2) - math.Sin(lat1)*math.Cos(lat2)*math.Cos(dLng)
	return math.Mod(toDeg(math.Atan2(y, x))+360, 360)
}

// BoundingBox is the padded geographic extent of a set of points.
type BoundingBox struct {
	MinLat, MaxLat, MinLng, MaxLng float64
}

// Bounds computes the bounding box of a set of points with a degree of padding.
func Bounds(points []domain.Point, padDeg float64) BoundingBox {
	if len(points) == 0 {
		return BoundingBox{}
	}
	box := BoundingBox{
		MinLat: math.Inf(1), MaxLat: math.Inf(-1),
		MinLng: math.Inf(1), MaxLng: math.Inf(-1),
	}
	for _, p := range points {
		box.MinLat = math.Min(box.MinLat, p.Lat)
		box.MaxLat = math.Max(box.MaxLat, p.Lat)
		box.MinLng = math.Min(box.MinLng, p.Lng)
		box.MaxLng = math.Max(box.MaxLng, p.Lng)
	}
	return BoundingBox{
		MinLat: box.MinLat - padDeg,
		MaxLat: box.MaxLat + padDeg,
		MinLng: box.MinLng - padDeg,
		MaxLng: box.MaxLng + padDeg,
	}
}
