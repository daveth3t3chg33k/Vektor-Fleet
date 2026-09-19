import { NextResponse } from "next/server";
import { evaluateAll } from "@/lib/engines/compliance";
import { reconcileVehicle } from "@/lib/engines/fuelMatch";
import { snapshotById } from "@/lib/engines/fleet";
import { distanceInWindow } from "@/lib/engines/telemetry";
import { vehicleById, transactionsForVehicle, tripsForVehicle } from "@/lib/store/db";

export const dynamic = "force-dynamic";

/** GET /api/vehicles/:id — everything the detail page needs in one call. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const vehicle = vehicleById(id);
  if (!vehicle) {
    return NextResponse.json({ error: "Vehicle not found", id }, { status: 404 });
  }

  const now = Date.now();
  const snapshot = snapshotById(id, now);
  const trips = tripsForVehicle(id)
    .sort((a, b) => b.startTs.localeCompare(a.startTs))
    .slice(0, 40);

  return NextResponse.json({
    data: {
      snapshot,
      trips,
      transactions: transactionsForVehicle(id).sort((a, b) => b.ts.localeCompare(a.ts)),
      reconciliation: reconcileVehicle(id),
      compliance: evaluateAll(id, now),
      distance7dKm: Number(distanceInWindow(id, now - 7 * 24 * 3600 * 1000, now).toFixed(1)),
      distance30dKm: Number(distanceInWindow(id, now - 30 * 24 * 3600 * 1000, now).toFixed(1)),
    },
  });
}
