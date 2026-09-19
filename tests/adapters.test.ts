import { describe, expect, it } from "vitest";
import { ADAPTERS, ingestBatch, normalizePing, SUPPORTED_VENDORS } from "@/lib/engines/adapters";
import { CORRIDORS_BY_ID } from "@/lib/domain/corridors";
import { pointAlongCorridor } from "@/lib/domain/geo";
import { distanceInWindow, expectedLitresInWindow, positionAt } from "@/lib/engines/telemetry";
import { getDataset, vehicleById } from "@/lib/store/db";

describe("vendor adapters", () => {
  it("registers every vendored brand the platform claims to support", () => {
    expect(SUPPORTED_VENDORS).toHaveLength(5);
    expect(Object.keys(ADAPTERS).sort()).toEqual(
      ["cartrack", "generic_tcp", "ruptela", "saferide", "teltonika"].sort(),
    );
  });

  it("flattens a CarTrack polling payload", () => {
    const ping = normalizePing("cartrack", {
      DeviceID: "CT-1",
      Lat: -1.3085,
      Lon: 36.8541,
      Speed: 62,
      Ignition: 1,
      Timestamp: 1789800000,
      Odometer: 154320000,
      Fuel1: 4820,
    });
    expect(ping.position.lat).toBeCloseTo(-1.3085, 4);
    expect(ping.speedKph).toBe(62);
    expect(ping.ignition).toBe(true);
    expect(ping.odometerKm).toBeCloseTo(154320, 1);
    expect(ping.fuelLevelL).toBeCloseTo(48.2, 1);
  });

  it("flattens a SafeRide webhook payload and parses its timestamp", () => {
    const ping = normalizePing("saferide", {
      vehicle_id: "SR-1",
      latitude: -3.3958,
      longitude: 38.5567,
      velocity_kmh: 71,
      acc_status: true,
      date_time: "2026-09-19T07:42:00Z",
      mileage_km: 421880.4,
    });
    expect(ping.ts).toBe("2026-09-19T07:42:00.000Z");
    expect(ping.speedKph).toBe(71);
    expect(ping.odometerKm).toBeCloseTo(421880.4, 1);
  });

  it("decodes Teltonika IO element ids into engineering units", () => {
    const ping = normalizePing("teltonika", {
      imei: "864025060123456",
      ts: 1789800120000,
      gps: { lat: -1.4565, lon: 36.9784, spd: 54, ang: 205 },
      io: { "239": 1, "16": 274118000, "48": 1184 },
    });
    expect(ping.ignition).toBe(true);
    expect(ping.odometerKm).toBeCloseTo(274118, 1);
    expect(ping.fuelLevelL).toBeCloseTo(118.4, 1);
  });

  it("treats 13-digit epochs as milliseconds and 10-digit as seconds", () => {
    const ms = normalizePing("ruptela", { timestamp_utc: 1789800000000 });
    const sec = normalizePing("generic_tcp", { time: 1789800000 });
    expect(Date.parse(ms.ts)).toBe(Date.parse(sec.ts));
  });

  it("drops samples with no usable fix or an unknown device", () => {
    const dataset = getDataset();
    const device = dataset.devices[0]!;
    const accepted = ingestBatch(
      "cartrack",
      [
        { DeviceID: device.id, Lat: -1.3, Lon: 36.8, Speed: 20, Timestamp: 1789800000 },
        { DeviceID: device.id, Lat: "not-a-number", Lon: 36.8, Speed: 20, Timestamp: 1789800000 },
        { DeviceID: "unknown-device", Lat: -1.3, Lon: 36.8, Speed: 20, Timestamp: 1789800000 },
      ],
      dataset.devices,
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.vehicleId).toBe(device.vehicleId);
  });

  it("rejects an unsupported vendor loudly", () => {
    expect(() => normalizePing("nokia" as never, {})).toThrow(/Unsupported GPS vendor/);
  });
});

describe("telemetry analytics", () => {
  it("reconstructs where a vehicle was during a trip", () => {
    const vehicle = getDataset().vehicles[0]!;
    const trip = getDataset().trips.find((t) => t.vehicleId === vehicle.id)!;
    const midTs = (Date.parse(trip.startTs) + Date.parse(trip.endTs)) / 2;
    const estimate = positionAt(vehicle.id, midTs);
    expect(estimate).not.toBeNull();
    expect(estimate!.source).toBe("trip");
    expect(estimate!.moving).toBe(true);
  });

  it("holds the last known position between trips rather than teleporting home", () => {
    const vehicle = vehicleById(getDataset().vehicles[0]!.id)!;
    const estimate = positionAt(vehicle.id, Date.now() + 30 * 24 * 3600 * 1000);
    expect(estimate!.source).toBe("parked");
    expect(estimate!.moving).toBe(false);

    // It must sit where the final recorded leg ended, not at the depot.
    const lastTrip = getDataset()
      .trips.filter((t) => t.vehicleId === vehicle.id)
      .sort((a, b) => a.endTs.localeCompare(b.endTs))
      .at(-1)!;
    const corridor = CORRIDORS_BY_ID[vehicle.corridor]!;
    const expected = pointAlongCorridor(corridor, lastTrip.endFraction);
    expect(estimate!.point.lat).toBeCloseTo(expected.lat, 4);
    expect(estimate!.point.lng).toBeCloseTo(expected.lng, 4);
  });

  it("pro-rates partial trips when measuring a window", () => {
    const vehicle = getDataset().vehicles[0]!;
    const now = Date.now();
    const day = distanceInWindow(vehicle.id, now - 24 * 3600 * 1000, now);
    const week = distanceInWindow(vehicle.id, now - 7 * 24 * 3600 * 1000, now);
    expect(day).toBeGreaterThanOrEqual(0);
    expect(week).toBeGreaterThanOrEqual(day);
  });

  it("derives expected litres from distance and nominal efficiency", () => {
    const vehicle = getDataset().vehicles[0]!;
    const now = Date.now();
    const km = distanceInWindow(vehicle.id, now - 24 * 3600 * 1000, now);
    const litres = expectedLitresInWindow(vehicle, now - 24 * 3600 * 1000, now);
    expect(litres).toBeCloseTo(km / vehicle.kmPerLitre, 6);
  });

  it("returns null for an unknown vehicle", () => {
    expect(positionAt("veh_nope", Date.now())).toBeNull();
  });
});
