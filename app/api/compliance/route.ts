import { NextResponse } from "next/server";
import { buildAlertQueue, fleetCompliancePosture } from "@/lib/engines/compliance";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/compliance — posture, alert queue and per-vehicle matrix.
 */
export async function GET() {
  const posture = fleetCompliancePosture();
  const alerts = buildAlertQueue();
  const dataset = getDataset();

  const matrix = dataset.vehicles.map((vehicle) => {
    const items = posture.evaluations.filter((e) => e.vehicleId === vehicle.id);
    return {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      fleetId: vehicle.fleetId,
      worst: items.reduce(
        (worst, item) => {
          const rank = ["ok", "due_soon", "critical", "expired"];
          return rank.indexOf(item.status) > rank.indexOf(worst) ? item.status : worst;
        },
        "ok" as string,
      ),
      exposureKes: items.reduce((s, i) => s + i.penaltyExposureKes, 0),
      items: items.sort((a, b) => a.daysRemaining - b.daysRemaining),
    };
  });

  return NextResponse.json({
    data: {
      posture: {
        total: posture.total,
        expired: posture.expired,
        critical: posture.critical,
        dueSoon: posture.dueSoon,
        ok: posture.ok,
        exposureKes: posture.exposureKes,
        healthyPercent: posture.healthyPercent,
        riskScore: posture.riskScore,
      },
      alerts,
      matrix,
    },
  });
}
