import { NextResponse } from "next/server";
import type { GpsVendorId } from "@/lib/domain/types";
import { ADAPTERS, ingestBatch, normalizePing, type RawVendorPayload } from "@/lib/engines/adapters";
import { getDataset, vehicleById } from "@/lib/store/db";

export const dynamic = "force-dynamic";

interface IngestBody {
  vendor?: string;
  /** Device id (VektorFleet id or vendor IMEI) the batch belongs to. */
  deviceId?: string;
  vehicleId?: string;
  samples?: RawVendorPayload[];
  /** When true, return the normalised output without buffering it. */
  dryRun?: boolean;
}

/**
 * POST /api/telemetry/ingest
 *
 * The single hardware-agnostic ingress point. Any supported tracker vendor posts
 * here and receives a normalised echo of what the platform stored — which is
 * what makes the "no new hardware" promise real.
 */
export async function POST(request: Request) {
  let payload: IngestBody;
  try {
    payload = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const vendor = payload.vendor as GpsVendorId | undefined;
  if (!vendor || !(vendor in ADAPTERS)) {
    return NextResponse.json(
      { error: `Unsupported vendor. Supported: ${Object.keys(ADAPTERS).join(", ")}` },
      { status: 400 },
    );
  }

  const samples = payload.samples ?? [];
  if (!Array.isArray(samples) || samples.length === 0) {
    return NextResponse.json({ error: "samples[] is required" }, { status: 400 });
  }

  const dataset = getDataset();
  const vehicle = payload.vehicleId ? vehicleById(payload.vehicleId) : null;
  const device = payload.deviceId
    ? dataset.devices.find((d) => d.id === payload.deviceId || d.imei === payload.deviceId) ?? null
    : vehicle
      ? dataset.devices.find((d) => d.vehicleId === vehicle.id) ?? null
      : null;

  if (!device || !vehicle) {
    return NextResponse.json(
      { error: "Resolve a known device/vehicle before ingesting" },
      { status: 404 },
    );
  }

  const ctx = { deviceId: device.id, vehicleId: vehicle.id };
  const normalised = samples.map((sample) => normalizePing(vendor, sample, ctx));
  const accepted = ingestBatch(
    vendor,
    samples.map((s) => ({ ...s, __v: undefined })),
    dataset.devices,
  );

  if (!payload.dryRun) {
    // Buffered ingest keeps the newest 5,000 samples to bound memory in the demo.
    dataset.telemetry.push(...accepted);
    if (dataset.telemetry.length > 25_000) {
      dataset.telemetry.splice(0, dataset.telemetry.length - 25_000);
    }
  }

  return NextResponse.json({
    data: {
      vendor,
      device: { id: device.id, vendor: device.vendor, imei: device.imei },
      received: samples.length,
      accepted: accepted.length,
      rejected: samples.length - accepted.length,
      normalised,
      stored: !payload.dryRun,
    },
  });
}
