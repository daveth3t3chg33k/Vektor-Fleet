import type { GpsDevice, GpsVendorId, TelemetryPing } from "@/lib/domain/types";

/**
 * Hardware-agnostic telemetry ingestion.
 *
 * VektorFleet never asks a customer to change hardware. Every supported vendor
 * posts a differently-shaped payload; the adapters below flatten them into one
 * canonical `TelemetryPing`. Adding a new tracker brand means adding one entry
 * to `ADAPTERS` — nothing else in the platform changes.
 */

export type RawVendorPayload = Record<string, unknown>;

interface Adapter {
  vendor: GpsVendorId;
  label: string;
  docsUrl: string;
  /** Human description of how integrators connect. */
  integration: string;
  adapt(raw: RawVendorPayload, ctx: AdapterContext): TelemetryPing;
}

export interface AdapterContext {
  vehicleId?: string;
  deviceId?: string;
}

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Coordinates are the one field we cannot default. A missing or corrupt fix
 * must surface as NaN so `ingestBatch` rejects the sample rather than dropping
 * the vehicle into the Gulf of Guinea at (0, 0).
 */
const coord = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
};

const tsFrom = (v: unknown): string => {
  if (typeof v === "number") {
    // Heuristic: 10-digit values are seconds, 13-digit are milliseconds.
    return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  }
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
};

const truthy = (v: unknown): boolean =>
  v === true || v === 1 || v === "1" || v === "true" || v === "ACC_ON" || v === "on";

export const ADAPTERS: Record<GpsVendorId, Adapter> = {
  cartrack: {
    vendor: "cartrack",
    label: "CarTrack",
    docsUrl: "https://www.cartrack.co.ke/",
    integration: "Partner REST endpoint — poll every 60s per device ID.",
    adapt(raw, ctx) {
      return {
        vehicleId: ctx.vehicleId ?? "",
        deviceId: ctx.deviceId ?? String(raw.DeviceID ?? ""),
        vendor: "cartrack",
        ts: tsFrom(raw.Timestamp ?? raw.EventTime),
        position: { lat: coord(raw.Lat ?? raw.Latitude), lng: coord(raw.Lon ?? raw.Longitude) },
        speedKph: num(raw.Speed),
        headingDeg: num(raw.Heading ?? raw.Course),
        ignition: truthy(raw.Ignition),
        odometerKm: raw.Odometer === undefined ? undefined : num(raw.Odometer) * 0.001,
        fuelLevelL: raw.Fuel1 === undefined ? undefined : num(raw.Fuel1) * 0.01,
      };
    },
  },
  saferide: {
    vendor: "saferide",
    label: "SafeRide",
    docsUrl: "https://saferide.co.ke/",
    integration: "Webhook push — configure the VektorFleet ingest URL on the customer account.",
    adapt(raw, ctx) {
      return {
        vehicleId: ctx.vehicleId ?? String(raw.vehicle_id ?? ""),
        deviceId: ctx.deviceId ?? "",
        vendor: "saferide",
        ts: tsFrom(raw.date_time),
        position: { lat: coord(raw.latitude), lng: coord(raw.longitude) },
        speedKph: num(raw.velocity_kmh),
        headingDeg: num(raw.direction),
        ignition: truthy(raw.acc_status),
        odometerKm: raw.mileage_km === undefined ? undefined : num(raw.mileage_km),
        fuelLevelL: raw.fuel_litres === undefined ? undefined : num(raw.fuel_litres),
      };
    },
  },
  teltonika: {
    vendor: "teltonika",
    label: "Teltonika FMB (Codec 8 / TCP)",
    docsUrl: "https://wiki.teltonika-gps.com/",
    integration: "Raw TCP AVL stream opened by the device to the VektorFleet ingest node.",
    adapt(raw, ctx) {
      const gps = (raw.gps ?? {}) as RawVendorPayload;
      const io = (raw.io ?? {}) as RawVendorPayload;
      return {
        vehicleId: ctx.vehicleId ?? "",
        deviceId: ctx.deviceId ?? String(raw.imei ?? ""),
        vendor: "teltonika",
        ts: tsFrom(raw.ts ?? gps.timestamp),
        position: { lat: coord(gps.lat), lng: coord(gps.lon) },
        speedKph: num(gps.spd),
        headingDeg: num(gps.ang),
        ignition: truthy(io["239"]),
        // Teltonika reports total odometer in metres on AVL ID 16.
        odometerKm: io["16"] === undefined ? undefined : num(io["16"]) / 1000,
        fuelLevelL: io["48"] === undefined ? undefined : num(io["48"]) / 10,
      };
    },
  },
  ruptela: {
    vendor: "ruptela",
    label: "Ruptela FM (EcoDrive)",
    docsUrl: "https://ruptela.com/",
    integration: "FMS/AVL REST pull with per-device API keys.",
    adapt(raw, ctx) {
      return {
        vehicleId: ctx.vehicleId ?? "",
        deviceId: ctx.deviceId ?? String(raw.tracker_id ?? ""),
        vendor: "ruptela",
        ts: tsFrom(raw.timestamp_utc),
        position: { lat: coord(raw.gps_lat), lng: coord(raw.gps_lng) },
        speedKph: num(raw.gps_speed),
        headingDeg: num(raw.gps_angle),
        ignition: truthy(raw.ignition_status),
        odometerKm: raw.total_odometer_km === undefined ? undefined : num(raw.total_odometer_km),
        fuelLevelL: raw.fuel_level_l === undefined ? undefined : num(raw.fuel_level_l),
      };
    },
  },
  generic_tcp: {
    vendor: "generic_tcp",
    label: "Generic JT/T 808 / NMEA gateway",
    docsUrl: "",
    integration: "Any gateway that can POST JSON to the ingest endpoint.",
    adapt(raw, ctx) {
      return {
        vehicleId: ctx.vehicleId ?? "",
        deviceId: ctx.deviceId ?? String(raw.device ?? ""),
        vendor: "generic_tcp",
        ts: tsFrom(raw.time ?? raw.timestamp),
        position: { lat: coord(raw.lat), lng: coord(raw.lng) },
        speedKph: num(raw.speed),
        headingDeg: num(raw.heading),
        ignition: truthy(raw.ignition),
        odometerKm: raw.odometer_km === undefined ? undefined : num(raw.odometer_km),
        fuelLevelL: raw.fuel_l === undefined ? undefined : num(raw.fuel_l),
      };
    },
  },
};

export function normalizePing(
  vendor: GpsVendorId,
  raw: RawVendorPayload,
  ctx: AdapterContext = {},
): TelemetryPing {
  const adapter = ADAPTERS[vendor];
  if (!adapter) throw new Error(`Unsupported GPS vendor: ${vendor}`);
  return adapter.adapt(raw, ctx);
}

/** Ingests a vendor batch and drops samples with no usable fix. */
export function ingestBatch(
  vendor: GpsVendorId,
  raws: RawVendorPayload[],
  devices: GpsDevice[],
): TelemetryPing[] {
  const byDevice = new Map(devices.map((d) => [d.id, d]));
  const out: TelemetryPing[] = [];
  for (const raw of raws) {
    const ping = normalizePing(vendor, raw);
    const device = byDevice.get(ping.deviceId);
    if (!device) continue;
    if (
      !Number.isFinite(ping.position.lat) ||
      !Number.isFinite(ping.position.lng) ||
      Math.abs(ping.position.lat) > 90 ||
      Math.abs(ping.position.lng) > 180
    ) {
      continue;
    }
    out.push({ ...ping, deviceId: device.id, vehicleId: device.vehicleId, vendor: device.vendor });
  }
  return out;
}

export const SUPPORTED_VENDORS = Object.values(ADAPTERS).map((a) => ({
  vendor: a.vendor,
  label: a.label,
  integration: a.integration,
  docsUrl: a.docsUrl,
}));
