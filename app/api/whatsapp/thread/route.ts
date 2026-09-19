import { NextResponse } from "next/server";
import { PRE_TRIP_CHECKLIST, queueDepth } from "@/lib/engines/whatsapp";
import { getDataset } from "@/lib/store/db";
import { messagesFor, runtime } from "@/lib/store/runtime";

export const dynamic = "force-dynamic";

/** GET /api/whatsapp/thread?phone=+2547... — conversation plus fleet roster. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone");

  const roster = getDataset().vehicles.map((vehicle) => {
    const driver = getDataset().drivers.find((d) => d.id === vehicle.driverId);
    return {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      driverId: driver?.id ?? "",
      driverName: driver?.name ?? "Unassigned",
      phone: driver?.phone ?? "",
    };
  });

  return NextResponse.json({
    data: {
      thread: phone ? messagesFor(phone) : [],
      session: phone ? (runtime().sessions.get(phone) ?? null) : null,
      roster,
      checklist: PRE_TRIP_CHECKLIST,
      reports: runtime().tripReports,
      queue: queueDepth(),
    },
  });
}
