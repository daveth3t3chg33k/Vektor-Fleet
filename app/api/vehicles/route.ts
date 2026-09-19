import { NextResponse } from "next/server";
import { allSnapshots } from "@/lib/engines/fleet";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/vehicles
 * Query params: fleetId, status, q (plate search), flaggedOnly=true
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fleetId = url.searchParams.get("fleetId");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.toUpperCase().replace(/\s+/g, "");
  const flaggedOnly = url.searchParams.get("flaggedOnly") === "true";

  let snapshots = allSnapshots();
  if (fleetId) snapshots = snapshots.filter((s) => s.vehicle.fleetId === fleetId);
  if (status) snapshots = snapshots.filter((s) => s.vehicle.status === status);
  if (q) snapshots = snapshots.filter((s) => s.vehicle.plate.replace(/\s+/g, "").includes(q));
  if (flaggedOnly) snapshots = snapshots.filter((s) => s.openFlags > 0);

  return NextResponse.json({
    data: snapshots,
    fleets: getDataset().fleets,
    count: snapshots.length,
  });
}
