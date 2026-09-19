import type { Corridor, GeoPoint } from "@/lib/domain/types";

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Projects a point onto a segment, returning the closest point and its fraction. */
function projectOnSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint) {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const px = p.lng;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { point: a, t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { point: { lat: ay + t * dy, lng: ax + t * dx }, t };
}

/** Minimum distance from a point to a corridor polyline, in km. */
export function distanceToCorridorKm(point: GeoPoint, corridor: Corridor): number {
  const pts = corridor.waypoints;
  if (pts.length === 1) return haversineKm(point, pts[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pts.length - 1; i++) {
    const { point: projected } = projectOnSegment(point, pts[i]!, pts[i + 1]!);
    const d = haversineKm(point, projected);
    if (d < best) best = d;
  }
  return best;
}

/** Interpolates a point at fraction `f` (0-1) along a corridor's length. */
export function pointAlongCorridor(corridor: Corridor, f: number): GeoPoint {
  return pointAlongPolyline(corridor.waypoints, f);
}

export function pointAlongPolyline(waypoints: GeoPoint[], f: number): GeoPoint {
  const pts = waypoints;
  if (pts.length === 0) throw new Error("polyline needs at least one point");
  if (pts.length === 1) return pts[0]!;
  const clamped = Math.max(0, Math.min(1, f));

  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += haversineKm(pts[i]!, pts[i + 1]!);
    cumulative.push(total);
  }
  const target = clamped * total;
  for (let i = 0; i < pts.length - 1; i++) {
    if (target <= cumulative[i + 1]!) {
      const segLen = cumulative[i + 1]! - cumulative[i]!;
      const t = segLen === 0 ? 0 : (target - cumulative[i]!) / segLen;
      return lerpPoint(pts[i]!, pts[i + 1]!, t);
    }
  }
  return pts[pts.length - 1]!;
}

export function lerpPoint(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Moves a point by `km` on the given compass bearing (degrees). */
export function offsetPoint(p: GeoPoint, km: number, bearingDeg: number): GeoPoint {
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(p.lat);
  const lng1 = toRad(p.lng);
  const angular = km / EARTH_RADIUS_KM;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

export function bearingBetween(a: GeoPoint, b: GeoPoint): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Total length of a polyline in kilometres. */
export function polylineLengthKm(waypoints: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineKm(waypoints[i - 1]!, waypoints[i]!);
  }
  return total;
}

/** Bounding box for the modelled operating region, with padding. */
export function boundingBox(points: GeoPoint[], padDeg = 0.35) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    minLat: Math.min(...lats) - padDeg,
    maxLat: Math.max(...lats) + padDeg,
    minLng: Math.min(...lngs) - padDeg,
    maxLng: Math.max(...lngs) + padDeg,
  };
}
