import { CORRIDORS_BY_ID } from "@/lib/domain/corridors";
import { distanceToCorridorKm, haversineKm, offsetPoint, pointAlongCorridor } from "@/lib/domain/geo";
import type { CorridorId, GeoPoint, TelemetryPing, Trip, Vehicle } from "@/lib/domain/types";
import { getDataset, tripsForVehicle, vehicleById } from "@/lib/store/db";

/**
 * Telemetry engine — the position/odometry source of truth.
 *
 * Two complementary views are exposed:
 *  - `positionAt()` reconstructs where a vehicle was at any instant from the
 *    trip index, so fuel forensics works even on transactions older than the
 *    raw ping window.
 *  - `pingsFor()` returns raw normalised fixes for the live map and safety
 *    analytics.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PositionEstimate {
  vehicleId: string;
  ts: number;
  point: GeoPoint;
  /**
   * `trip` while a leg is in progress, `parked` when the tracker is holding its
   * last known position between legs, and `depot` for a vehicle with no history
   * at all.
   */
  source: "trip" | "parked" | "depot";
  corridor: CorridorId;
  /** 0-1 progress along the corridor, when moving. */
  corridorFraction: number | null;
  moving: boolean;
}

function depotPoint(vehicle: Vehicle): GeoPoint {
  const anchor: Record<string, GeoPoint> = {
    "Nairobi Industrial Area": { lat: -1.308, lng: 36.854 },
    "Mombasa Changamwe": { lat: -4.0237, lng: 39.6293 },
    "Nakuru ICD": { lat: -0.3031, lng: 36.08 },
    "Eldoret Depot": { lat: 0.5143, lng: 35.2698 },
    "Athi River Yard": { lat: -1.4565, lng: 36.9784 },
  };
  return anchor[vehicle.homeDepot] ?? { lat: -1.308, lng: 36.854 };
}

/** Where was this vehicle at `tsMs`? Null when the vehicle is unknown. */
export function positionAt(vehicleId: string, tsMs: number): PositionEstimate | null {
  const vehicle = vehicleById(vehicleId);
  if (!vehicle) return null;
  const trip = findTripAt(vehicleId, tsMs);
  const corridor = CORRIDORS_BY_ID[vehicle.corridor]!;

  if (!trip) {
    // Between legs a real tracker keeps reporting its last known position,
    // which is wherever the previous journey ended. Modelling that honestly is
    // what keeps the fuel engine's location check from crying wolf on a fill
    // taken at a mid-corridor stop.
    const previous = lastTripBefore(vehicleId, tsMs);
    if (previous) {
      const previousCorridor = CORRIDORS_BY_ID[previous.corridor]!;
      return {
        vehicleId,
        ts: tsMs,
        point: pointAlongCorridor(
          previousCorridor,
          Math.max(0, Math.min(1, previous.endFraction)),
        ),
        source: "parked",
        corridor: previous.corridor,
        corridorFraction: previous.endFraction,
        moving: false,
      };
    }
    return {
      vehicleId,
      ts: tsMs,
      point: depotPoint(vehicle),
      source: "depot",
      corridor: vehicle.corridor,
      corridorFraction: null,
      moving: false,
    };
  }

  const start = Date.parse(trip.startTs);
  const end = Date.parse(trip.endTs);
  const progress = (tsMs - start) / Math.max(1, end - start);
  const fraction = trip.startFraction + (trip.endFraction - trip.startFraction) * progress;
  return {
    vehicleId,
    ts: tsMs,
    point: pointAlongCorridor(corridor, Math.max(0, Math.min(1, fraction))),
    source: "trip",
    corridor: trip.corridor,
    corridorFraction: fraction,
    moving: true,
  };
}

export function findTripAt(vehicleId: string, tsMs: number): Trip | null {
  const ts = new Date(tsMs).toISOString();
  return (
    tripsForVehicle(vehicleId).find((t) => t.startTs <= ts && ts <= t.endTs) ?? null
  );
}

/** The most recent leg that had already finished by `tsMs`. */
export function lastTripBefore(vehicleId: string, tsMs: number): Trip | null {
  const ts = new Date(tsMs).toISOString();
  const prior = tripsForVehicle(vehicleId).filter((t) => t.endTs <= ts);
  if (prior.length === 0) return null;
  return prior.reduce((latest, candidate) =>
    candidate.endTs > latest.endTs ? candidate : latest,
  );
}

export function tripsInWindow(vehicleId: string, fromMs: number, toMs: number): Trip[] {
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  return tripsForVehicle(vehicleId).filter((t) => t.endTs >= from && t.startTs <= to);
}

/**
 * Distance actually driven in a window. Partial trips are pro-rated by time,
 * which is accurate enough for fuel reconciliation and immune to GPS drift.
 */
export function distanceInWindow(vehicleId: string, fromMs: number, toMs: number): number {
  let total = 0;
  for (const trip of tripsInWindow(vehicleId, fromMs, toMs)) {
    const start = Date.parse(trip.startTs);
    const end = Date.parse(trip.endTs);
    const duration = Math.max(1, end - start);
    const overlap = Math.min(end, toMs) - Math.max(start, fromMs);
    if (overlap <= 0) continue;
    total += trip.distanceKm * (overlap / duration);
  }
  return total;
}

/**
 * Fuel burnt in a window, derived from nominal efficiency. This is the baseline
 * the fuel-match engine compares card volumes against.
 */
export function expectedLitresInWindow(
  vehicle: Vehicle,
  fromMs: number,
  toMs: number,
  efficiencyFactor = 1,
): number {
  const km = distanceInWindow(vehicle.id, fromMs, toMs);
  return (km / Math.max(0.1, vehicle.kmPerLitre)) * efficiencyFactor;
}

export function lastMovementEnd(vehicleId: string): number | null {
  const trips = tripsForVehicle(vehicleId);
  if (trips.length === 0) return null;
  return Math.max(...trips.map((t) => Date.parse(t.endTs)));
}

export function lastMovementStart(vehicleId: string): number | null {
  const trips = tripsForVehicle(vehicleId);
  if (trips.length === 0) return null;
  return Math.min(...trips.map((t) => Date.parse(t.startTs)));
}

/** Raw fixes for a vehicle in a window, oldest first. */
export function pingsFor(
  vehicleId: string,
  fromMs: number,
  toMs = Number.POSITIVE_INFINITY,
): TelemetryPing[] {
  return getDataset()
    .telemetry.filter(
      (p) =>
        p.vehicleId === vehicleId &&
        Date.parse(p.ts) >= fromMs &&
        Date.parse(p.ts) <= toMs,
    )
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Most recent fix on record for a vehicle. */
export function latestPing(vehicleId: string): TelemetryPing | null {
  const pings = pingsFor(vehicleId, 0);
  return pings.length > 0 ? pings[pings.length - 1]! : null;
}

/** Drops stationary GPS drift and impossible jumps from a ping series. */
export function denoisePings(pings: TelemetryPing[], maxJumpKm = 3): TelemetryPing[] {
  const out: TelemetryPing[] = [];
  for (const ping of pings) {
    const prev = out[out.length - 1];
    if (prev) {
      const jump = haversineKm(prev.position, ping.position);
      const gapMin = Math.max(0.05, (Date.parse(ping.ts) - Date.parse(prev.ts)) / 60000);
      // Reject jumps faster than 140 km/h; keep genuine movement.
      if (jump > maxJumpKm && jump / (gapMin / 60) > 140) continue;
    }
    out.push(ping);
  }
  return out;
}

/** GPS-derived geodesic distance over a ping series (noise filtered). */
export function gpsDistanceKm(pings: TelemetryPing[], minStepKm = 0.05): number {
  const clean = denoisePings(pings);
  let total = 0;
  for (let i = 1; i < clean.length; i++) {
    const step = haversineKm(clean[i - 1]!.position, clean[i]!.position);
    if (step >= minStepKm) total += step;
  }
  return total;
}

export interface OverspeedEvent {
  vehicleId: string;
  ts: string;
  speedKph: number;
  limitKph: number;
  position: GeoPoint;
}

export function overspeedEvents(
  pings: TelemetryPing[],
  limitKph: number,
  toleranceKph = 3,
): OverspeedEvent[] {
  return denoisePings(pings)
    .filter((p) => p.speedKph > limitKph + toleranceKph)
    .map((p) => ({
      vehicleId: p.vehicleId,
      ts: p.ts,
      speedKph: Math.round(p.speedKph),
      limitKph,
      position: p.position,
    }));
}

/**
 * Idling minutes from raw fixes: ignition on, stationary, and the gap to the
 * next fix bounded so a parked vehicle does not inflate the number.
 */
export function idlingMinutes(pings: TelemetryPing[], maxGapMinutes = 20): number {
  let minutes = 0;
  for (let i = 0; i < pings.length - 1; i++) {
    const ping = pings[i]!;
    if (!ping.ignition || ping.speedKph >= 3) continue;
    const gap = (Date.parse(pings[i + 1]!.ts) - Date.parse(ping.ts)) / 60000;
    if (gap > 0 && gap <= maxGapMinutes) minutes += gap;
  }
  return Math.round(minutes);
}

/** How far off the modelled corridor a vehicle has strayed (km). */
export function corridorDeviationKm(vehicleId: string, tsMs: number): number {
  const vehicle = vehicleById(vehicleId);
  const position = positionAt(vehicleId, tsMs);
  if (!vehicle || !position) return 0;
  const corridor = CORRIDORS_BY_ID[vehicle.corridor]!;
  return distanceToCorridorKm(position.point, corridor);
}

/**
 * Nearest plausible off-route stop: used when a fuel transaction is logged away
 * from the corridor centreline.
 */
export function pointAwayFrom(point: GeoPoint, km: number, bearingDeg: number): GeoPoint {
  return offsetPoint(point, km, bearingDeg);
}

export const WINDOWS = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};
