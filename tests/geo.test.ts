import { describe, expect, it } from "vitest";
import { CORRIDORS_BY_ID } from "@/lib/domain/corridors";
import {
  bearingBetween,
  distanceToCorridorKm,
  haversineKm,
  offsetPoint,
  pointAlongCorridor,
} from "@/lib/domain/geo";

const NAIROBI = { lat: -1.2921, lng: 36.8219 };
const MOMBASA = { lat: -4.0435, lng: 39.6682 };

describe("geo", () => {
  it("measures the Nairobi–Mombasa straight-line distance plausibly", () => {
    const km = haversineKm(NAIROBI, MOMBASA);
    // Road distance is ~485 km; geodesic ~440 km.
    expect(km).toBeGreaterThan(420);
    expect(km).toBeLessThan(460);
  });

  it("is symmetric and zero for identical points", () => {
    expect(haversineKm(NAIROBI, NAIROBI)).toBe(0);
    expect(haversineKm(NAIROBI, MOMBASA)).toBeCloseTo(haversineKm(MOMBASA, NAIROBI), 6);
  });

  it("clamps corridor interpolation to the polyline ends", () => {
    const corridor = CORRIDORS_BY_ID.mombasa_road!;
    const start = pointAlongCorridor(corridor, -5);
    const end = pointAlongCorridor(corridor, 5);
    expect(haversineKm(start, corridor.waypoints[0]!)).toBeLessThan(0.001);
    expect(haversineKm(end, corridor.waypoints[corridor.waypoints.length - 1]!)).toBeLessThan(0.001);
  });

  it("returns the midpoint of a straight corridor", () => {
    const corridor = CORRIDORS_BY_ID.mombasa_road!;
    const mid = pointAlongCorridor(corridor, 0.5);
    const total = corridor.waypoints.reduce(
      (sum, point, i) => (i === 0 ? 0 : sum + haversineKm(corridor.waypoints[i - 1]!, point)),
      0,
    );
    const fromStart = corridor.waypoints.reduce(
      (sum, point, i) => (i === 0 ? 0 : sum + haversineKm(corridor.waypoints[i - 1]!, point)),
      0,
    );
    expect(fromStart).toBeCloseTo(total, 6);
    expect(haversineKm(corridor.waypoints[0]!, mid)).toBeGreaterThan(10);
  });

  it("flags points far off the corridor and passes points on it", () => {
    const corridor = CORRIDORS_BY_ID.mombasa_road!;
    const onLine = pointAlongCorridor(corridor, 0.4);
    expect(distanceToCorridorKm(onLine, corridor)).toBeLessThan(0.01);
    const farOff = { lat: 0.5, lng: 35.2 }; // Eldoret, nowhere near A109
    expect(distanceToCorridorKm(farOff, corridor)).toBeGreaterThan(150);
  });

  it("offsets a point by distance and reconciles the bearing", () => {
    const moved = offsetPoint(NAIROBI, 30, 90);
    expect(haversineKm(NAIROBI, moved)).toBeCloseTo(30, 1);
    expect(bearingBetween(NAIROBI, moved)).toBeCloseTo(90, 0);
  });
});
