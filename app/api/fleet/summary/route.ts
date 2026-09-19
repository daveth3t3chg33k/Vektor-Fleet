import { NextResponse } from "next/server";
import { fleetKpis } from "@/lib/engines/fleet";

export const dynamic = "force-dynamic";

/** GET /api/fleet/summary — headline KPIs plus the savings breakdown. */
export async function GET() {
  const kpis = fleetKpis();
  return NextResponse.json({ data: kpis, generatedAt: new Date().toISOString() });
}
