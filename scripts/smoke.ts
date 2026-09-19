/**
 * End-to-end smoke test.
 *
 * Exercises the running server the way a real client would — over HTTP — so it
 * verifies routing, serialisation and the engines together rather than trusting
 * the unit tests alone.
 *
 *   npm run dev          # in one shell
 *   npx tsx scripts/smoke.ts [baseUrl]
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:3010";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return json<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function main() {
  console.log(`VektorFleet smoke test against ${BASE}\n`);

  // ---- 1. Liveness ------------------------------------------------------
  const health = await json<{ status: string; counts: Record<string, number> }>("/api/health");
  check("GET /api/health", health.status === "ok");
  check(
    "seeded dataset is complete",
    health.counts.vehicles! > 0 && health.counts.complianceItems === health.counts.vehicles! * 7,
    `${health.counts.vehicles} vehicles, ${health.counts.trips} trips, ${health.counts.fuelTransactions} transactions`,
  );

  // ---- 2. Fleet KPIs ----------------------------------------------------
  const summary = await json<{ data: { vehicles: number; annualisedSavingKes: number; breakdown: unknown[] } }>(
    "/api/fleet/summary",
  );
  check("GET /api/fleet/summary", summary.data.vehicles > 0);
  check(
    "savings breakdown has every engine line",
    summary.data.breakdown.length === 4,
    `annualised KES ${summary.data.annualisedSavingKes.toLocaleString()}`,
  );

  // ---- 3. Fuel forensics ------------------------------------------------
  const audit = await json<{
    data: {
      totals: { byCode: Record<string, number> };
      flags: Array<{ vehicleId: string }>;
      reconciliations: Array<{ leakagePercent: number; flags: Array<{ code: string }> }>;
    };
  }>("/api/fuel/audit");
  const codes = Object.keys(audit.data.totals.byCode);
  check("GET /api/fuel/audit", audit.data.flags.length > 0, `${audit.data.flags.length} flags`);
  check(
    "all seven detectors are represented across the fleet",
    ["OVERFILL_IMPOSSIBLE", "EXCESS_LITRES", "STATION_MISMATCH", "GHOST_FILL", "COLLUSION_PATTERN", "OFF_HOURS_FILL"].every(
      (code) => codes.includes(code),
    ),
    codes.join(", "),
  );
  const cleanlyReconciling = audit.data.reconciliations.filter(
    (r) => r.flags.every((f) => f.code === "OFF_HOURS_FILL") && r.leakagePercent < 8,
  ).length;
  check(
    "the majority of vehicles reconcile cleanly",
    cleanlyReconciling > audit.data.reconciliations.length / 2,
    `${cleanlyReconciling}/${audit.data.reconciliations.length} clean`,
  );

  // ---- 4. Vehicle detail -------------------------------------------------
  const vehicles = await json<{ data: Array<{ vehicle: { id: string } }> }>("/api/vehicles");
  const firstId = vehicles.data[0]!.vehicle.id;
  const detail = await json<{ data: { reconciliation: unknown; compliance: unknown[]; trips: unknown[] } }>(
    `/api/vehicles/${firstId}`,
  );
  check(`GET /api/vehicles/${firstId}`, Boolean(detail.data.reconciliation));
  check("vehicle detail includes compliance items", detail.data.compliance.length > 0);

  // ---- 5. Compliance ----------------------------------------------------
  const compliance = await json<{
    data: { posture: { total: number; riskScore: number }; alerts: Array<{ channel: string }> };
  }>("/api/compliance");
  check("GET /api/compliance", compliance.data.posture.total > 0);
  check(
    "reminder queue dispatches on both channels",
    compliance.data.alerts.some((a) => a.channel === "whatsapp") &&
      compliance.data.alerts.some((a) => a.channel === "email"),
    `${compliance.data.alerts.length} alerts, risk score ${compliance.data.posture.riskScore}`,
  );

  // ---- 6. WhatsApp bot, driven end to end --------------------------------
  const thread = await json<{ data: { roster: Array<{ phone: string; plate: string }> } }>(
    "/api/whatsapp/thread",
  );
  const driver = thread.data.roster[0]!;

  const greet = await post<{ data: { replies: string[] } }>("/api/whatsapp/inbound", {
    phone: driver.phone,
    body: "START",
  });
  check("bot opens the pre-trip checklist", greet.data.replies.join(" ").includes("1/7"), driver.plate);

  type BotTurn = {
    data: { session: { step: string }; events: Array<{ type: string }> };
  };

  let last: BotTurn | null = null;
  for (let i = 0; i < 7; i++) {
    last = await post<BotTurn>("/api/whatsapp/inbound", { phone: driver.phone, body: "OK" });
  }
  const report = last?.data.events.find((e) => e.type === "trip_report");
  check("completing the checklist files a trip report", Boolean(report));
  check("bot advances to odometer capture", last?.data.session.step === "ODOMETER");

  const odo = await post<{ data: { events: Array<{ type: string; km?: number }> } }>(
    "/api/whatsapp/inbound",
    { phone: driver.phone, body: "ODO 154320" },
  );
  check("bot parses an odometer reading", odo.data.events.some((e) => e.type === "odometer" && e.km === 154320));

  const incident = await post<{ data: { replies: string[] } }>("/api/whatsapp/inbound", {
    phone: driver.phone,
    body: "INCIDENT blowout near Mariakani",
  });
  check("bot escalates an incident", incident.data.replies.join(" ").toLowerCase().includes("escalated"));

  const unregistered = await post<{ data: { replies: string[] } }>("/api/whatsapp/inbound", {
    phone: "+254700000000",
    body: "hello",
  });
  check(
    "bot refuses an unregistered number",
    unregistered.data.replies.join(" ").includes("not registered"),
  );

  // ---- 7. Hardware-agnostic ingest ---------------------------------------
  const teltonika = await post<{
    data: { accepted: number; normalised: Array<{ odometerKm?: number; ignition: boolean }> };
  }>("/api/telemetry/ingest", {
    vendor: "teltonika",
    vehicleId: firstId,
    samples: [
      {
        imei: "864025060123456",
        ts: Date.now(),
        gps: { lat: -1.4565, lon: 36.9784, spd: 54, ang: 205 },
        io: { "239": 1, "16": 274118000 },
      },
    ],
  });
  check("POST /api/telemetry/ingest accepts a Teltonika sample", teltonika.data.accepted === 1);
  check(
    "Teltonika IO elements decode to engineering units",
    teltonika.data.normalised[0]?.odometerKm === 274118 && teltonika.data.normalised[0]?.ignition === true,
  );

  const bad = await fetch(`${BASE}/api/telemetry/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor: "nokia", samples: [{}] }),
  });
  check("ingest rejects an unsupported vendor", bad.status === 400);

  // ---- 8. Integrations ---------------------------------------------------
  const integrations = await json<{ data: { adapters: Array<{ sampleNormalised: unknown }> } }>(
    "/api/integrations",
  );
  check(
    "every vendor adapter normalises its own sample",
    integrations.data.adapters.every((a) => a.sampleNormalised !== null),
    `${integrations.data.adapters.length} adapters`,
  );

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nSmoke test crashed:", error);
  process.exit(1);
});
