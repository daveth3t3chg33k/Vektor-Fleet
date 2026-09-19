import { NextResponse } from "next/server";
import { auditFleet } from "@/lib/engines/fuelMatch";

export const dynamic = "force-dynamic";

/**
 * GET /api/fuel/audit — full fleet fuel reconciliation.
 * Query params: severity, vehicleId, code
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const severity = url.searchParams.get("severity");
  const vehicleId = url.searchParams.get("vehicleId");
  const code = url.searchParams.get("code");

  const audit = auditFleet();
  let flags = audit.flags;
  if (severity) flags = flags.filter((f) => f.severity === severity);
  if (vehicleId) flags = flags.filter((f) => f.vehicleId === vehicleId);
  if (code) flags = flags.filter((f) => f.code === code);

  return NextResponse.json({
    data: {
      totals: audit.totals,
      flags,
      reconciliations: audit.reconciliations.sort((a, b) => b.exposureKes - a.exposureKes),
    },
  });
}
