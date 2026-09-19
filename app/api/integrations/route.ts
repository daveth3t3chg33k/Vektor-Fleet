import { NextResponse } from "next/server";
import { ADAPTERS, normalizePing, SUPPORTED_VENDORS } from "@/lib/engines/adapters";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

/** Realistic sample payloads shown in the integrations console. */
const SAMPLES: Record<string, Record<string, unknown>> = {
  cartrack: { DeviceID: "CT-882301", Lat: -1.3085, Lon: 36.8541, Speed: 62, Heading: 118, Ignition: 1, Timestamp: 1789800000, Odometer: 154320000, Fuel1: 4820 },
  saferide: { vehicle_id: "SR-20455", latitude: -3.3958, longitude: 38.5567, velocity_kmh: 71, direction: 291, acc_status: true, date_time: "2026-09-19T07:42:00Z", mileage_km: 421880.4, fuel_litres: 173.2 },
  teltonika: { imei: "864025060123456", ts: 1789800120000, gps: { lat: -1.4565, lon: 36.9784, spd: 54, ang: 205 }, io: { "239": 1, "16": 274118000, "48": 1184 } },
  ruptela: { tracker_id: "RP-99120", timestamp_utc: "2026-09-19T07:42:00Z", gps_lat: -0.3031, gps_lng: 36.08, gps_speed: 38, gps_angle: 77, ignition_status: 1, total_odometer_km: 231004.9, fuel_level_l: 96.5 },
  generic_tcp: { device: "GEN-55012", time: "2026-09-19T07:42:00Z", lat: -4.0237, lng: 39.6293, speed: 0, heading: 12, ignition: 0, odometer_km: 318442.0, fuel_l: 210.4 },
};

/** GET /api/integrations — vendor catalogue with live normalisation preview. */
export async function GET() {
  const dataset = getDataset();

  const catalogue = SUPPORTED_VENDORS.map((vendor) => {
    const sample = SAMPLES[vendor.vendor] ?? {};
    let normalised: unknown = null;
    let error: string | null = null;
    try {
      normalised = normalizePing(vendor.vendor, sample, {
        deviceId: "dev_preview",
        vehicleId: "veh_preview",
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const supportedBy = Object.keys(ADAPTERS).includes(vendor.vendor)
      ? dataset.devices.filter((d) => d.vendor === vendor.vendor)
      : [];

    return {
      ...vendor,
      connectedDevices: supportedBy.length,
      sampleRaw: sample,
      sampleNormalised: normalised,
      error,
    };
  });

  return NextResponse.json({
    data: {
      adapters: catalogue,
      connected: dataset.devices.map((d) => ({
        id: d.id,
        vendor: d.vendor,
        imei: d.imei,
        vehicleId: d.vehicleId,
        online: d.online,
        lastSeenAt: d.lastSeenAt,
        firmware: d.firmware,
      })),
    },
  });
}
