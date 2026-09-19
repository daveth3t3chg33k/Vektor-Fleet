import { NextResponse } from "next/server";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

/** GET /api/health — liveness plus a quick census of the loaded dataset. */
export async function GET() {
  const dataset = getDataset();
  return NextResponse.json({
    status: "ok",
    product: "VektorFleet",
    generatedAt: dataset.generatedAt,
    counts: {
      fleets: dataset.fleets.length,
      vehicles: dataset.vehicles.length,
      drivers: dataset.drivers.length,
      devices: dataset.devices.length,
      trips: dataset.trips.length,
      telemetry: dataset.telemetry.length,
      fuelTransactions: dataset.fuelTransactions.length,
      complianceItems: dataset.complianceItems.length,
    },
    uptimeSeconds: Math.round(process.uptime()),
  });
}
