import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Cpu, MapPin, User } from "lucide-react";
import type { FuelFlag } from "@/lib/domain/types";
import { EmptyState, HealthRing, MeterBar, PageHeader, Panel, Pill, SEVERITY_TONE, STATUS_TONE } from "@/components/ui";
import { CATEGORY_LABELS, evaluateAll } from "@/lib/engines/compliance";
import { reconcileVehicle } from "@/lib/engines/fuelMatch";
import { snapshotById } from "@/lib/engines/fleet";
import { distanceInWindow } from "@/lib/engines/telemetry";
import {
  COMPLIANCE_LABEL,
  FLAG_CODE_LABEL,
  formatDate,
  formatDateTime,
  formatKes,
  formatKm,
  formatLitres,
  formatNumber,
  relativeTime,
  titleCase,
} from "@/lib/format";
import { getDataset, vehicleById } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicle = vehicleById(id);
  if (!vehicle) notFound();

  const now = Date.now();
  const snap = snapshotById(id, now);
  if (!snap) notFound();

  const reconciliation = reconcileVehicle(id);
  const compliance = evaluateAll(id, now);
  const dataset = getDataset();
  const trips = dataset.trips
    .filter((t) => t.vehicleId === id)
    .sort((a, b) => b.startTs.localeCompare(a.startTs))
    .slice(0, 8);
  const transactions = dataset.fuelTransactions
    .filter((t) => t.vehicleId === id)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 10);
  const fleet = dataset.fleets.find((f) => f.id === vehicle.fleetId);
  const flagsByTx = new Map<string, FuelFlag[]>();
  for (const flag of reconciliation?.flags ?? []) {
    const list = flagsByTx.get(flag.transactionId) ?? [];
    list.push(flag);
    flagsByTx.set(flag.transactionId, list);
  }

  const distance7d = distanceInWindow(id, now - 7 * 24 * 3600 * 1000, now);
  const distance30d = distanceInWindow(id, now - 30 * 24 * 3600 * 1000, now);

  return (
    <>
      <Link
        href="/vehicles"
        className="mb-4 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted transition-colors hover:text-signal"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to fleet register
      </Link>

      <PageHeader
        eyebrow={fleet ? `${fleet.name} · ${fleet.hq}` : "Vehicle"}
        title={`${vehicle.plate} — ${vehicle.make} ${vehicle.model}`}
        description={`${titleCase(vehicle.class)} · ${vehicle.year} · ${formatLitres(vehicle.tankCapacityL)} tank · nominal ${vehicle.kmPerLitre} km/L · home depot ${vehicle.homeDepot}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS_TONE[vehicle.status] ?? "muted"} dot>
              {vehicle.status}
            </Pill>
            <Pill tone={STATUS_TONE[snap.complianceStatus] ?? "muted"}>
              {COMPLIANCE_LABEL[snap.complianceStatus]}
            </Pill>
            {snap.openFlags > 0 && <Pill tone="warn">{snap.openFlags} fuel flags</Pill>}
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <div className="xl:col-span-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MiniStat label="Odometer" value={`${formatNumber(vehicle.odometerKm)} km`} sub="Device reported" />
          <MiniStat label="Distance 24h" value={formatKm(snap.distance24hKm)} sub={`${formatKm(distance7d)} in 7 days`} />
          <MiniStat
            label="Idling today"
            value={`${formatNumber(snap.idlingMinutes)} min`}
            sub={`${snap.overspeedEvents} overspeed events`}
            tone={snap.idlingMinutes > 20 ? "warn" : "default"}
          />
          <MiniStat
            label="Unverified fuel"
            value={formatLitres(reconciliation?.unverifiedLitres ?? 0)}
            sub={`${reconciliation?.leakagePercent ?? 0}% of billed litres`}
            tone={(reconciliation?.unverifiedLitres ?? 0) > 50 ? "danger" : "default"}
          />

          <Panel title="Trip log" subtitle="Most recent movements, reconstructed from the trip index." className="sm:col-span-2 lg:col-span-4">
            {trips.length === 0 ? (
              <EmptyState title="No recorded movement" detail="This vehicle has no trips in the modelling window." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-faint">
                      <th className="py-2 pr-4 font-semibold">Departed</th>
                      <th className="py-2 pr-4 font-semibold">Corridor</th>
                      <th className="py-2 pr-4 text-right font-semibold">Distance</th>
                      <th className="py-2 pr-4 text-right font-semibold">Avg / max</th>
                      <th className="py-2 pr-4 text-right font-semibold">Idle</th>
                      <th className="py-2 text-right font-semibold">Overspeed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((trip) => (
                      <tr key={trip.id} className="border-b border-line/60 last:border-0">
                        <td className="py-2 pr-4 text-ink">
                          {formatDateTime(trip.startTs)}
                          <span className="block text-[10.5px] text-faint">{relativeTime(trip.endTs)} ended</span>
                        </td>
                        <td className="py-2 pr-4 text-muted">{titleCase(trip.corridor)}</td>
                        <td className="vf-num py-2 pr-4 text-right text-ink">{formatKm(trip.distanceKm)}</td>
                        <td className="vf-num py-2 pr-4 text-right text-muted">
                          {trip.avgSpeedKph} / {trip.maxSpeedKph} km/h
                        </td>
                        <td className="vf-num py-2 pr-4 text-right text-muted">{trip.idlingMinutes} min</td>
                        <td className="py-2 text-right">
                          {trip.overspeedSeconds > 600 ? (
                            <Pill tone="danger">{Math.round(trip.overspeedSeconds / 60)} min</Pill>
                          ) : (
                            <span className="vf-num text-[11px] text-faint">
                              {Math.round(trip.overspeedSeconds / 60)} min
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Fuel ledger"
            subtitle="Card captures matched against the trip plan. Flags are the disagreements."
            className="sm:col-span-2 lg:col-span-4"
          >
            {transactions.length === 0 ? (
              <EmptyState title="No card transactions" detail="Link a fuel card feed to reconcile this vehicle." />
            ) : (
              <ul className="space-y-2.5">
                {transactions.map((tx) => {
                  const flags = flagsByTx.get(tx.id) ?? [];
                  return (
                    <li key={tx.id} className="rounded-xl border border-line bg-surface-2/40 p-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="vf-num text-[12.5px] font-semibold text-ink">
                          {formatLitres(tx.litres)}
                        </span>
                        <span className="vf-num text-[12px] text-muted">
                          {formatKes(tx.totalKes)} · @ {formatKes(tx.unitPriceKes, { decimals: 2 })}/L
                        </span>
                        <span className="text-[11.5px] text-muted">{tx.stationName}</span>
                        <span className="vf-num ml-auto text-[11px] text-faint">{formatDateTime(tx.ts)}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
                        {tx.odometerAtPumpKm !== undefined && (
                          <span className="vf-num">pump odometer {formatNumber(tx.odometerAtPumpKm)} km</span>
                        )}
                        {tx.receiptUrl && <span>receipt on file</span>}
                        <span>card {dataset.fuelCards.find((c) => c.id === tx.cardId)?.provider}</span>
                      </div>
                      {flags.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {flags.map((flag) => (
                            <div
                              key={flag.id}
                              className="flex flex-wrap items-start gap-2 rounded-lg border border-line-2 bg-void/50 px-2.5 py-2"
                            >
                              <Pill tone={SEVERITY_TONE[flag.severity]} dot>
                                {FLAG_CODE_LABEL[flag.code] ?? flag.code}
                              </Pill>
                              <div className="min-w-0 flex-1">
                                <div className="text-[11.5px] font-medium leading-snug text-ink">{flag.headline}</div>
                                <p className="text-[11px] leading-snug text-muted">{flag.detail}</p>
                              </div>
                              <span className="vf-num text-[11px] font-semibold text-danger">
                                {flag.exposureKes > 0 ? formatKes(flag.exposureKes, { compact: true }) : `${Math.round(flag.confidence * 100)}% conf`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Tank & efficiency">
            <div className="flex items-center gap-4">
              <HealthRing score={Math.round(Math.min(100, ((snap.liveKmPerLitre ?? 0) / vehicle.kmPerLitre) * 100))} size={112} />
              <div className="flex-1 space-y-2 text-[11.5px]">
                <div>
                  <div className="text-faint">Live efficiency</div>
                  <div className="vf-num text-[13px] font-semibold text-ink">
                    {snap.liveKmPerLitre ?? "—"} km/L
                  </div>
                </div>
                <div>
                  <div className="text-faint">Reconstructed level</div>
                  <div className="vf-num text-[13px] font-semibold text-ink">
                    {reconciliation?.closingLevelL ?? "—"} L
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Transponder & driver">
            <ul className="space-y-3 text-[11.5px]">
              <li className="flex items-start gap-2.5">
                <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="text-ink">
                    {snap.device ? titleCase(snap.device.vendor) : "No device"}
                    {snap.device && (
                      <span className={snap.device.online ? "text-mint" : "text-faint"}>
                        {" "}· {snap.device.online ? "online" : "offline"}
                      </span>
                    )}
                  </div>
                  <div className="vf-num text-[10.5px] text-faint">
                    IMEI {snap.device?.imei ?? "—"} · fw {snap.device?.firmware ?? "—"}
                  </div>
                  <div className="text-[10.5px] text-faint">
                    last fix {snap.device ? relativeTime(snap.device.lastSeenAt) : "—"}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <User className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="text-ink">{snap.driver?.name ?? "Unassigned"}</div>
                  <div className="vf-num text-[10.5px] text-faint">{snap.driver?.phone ?? "—"}</div>
                  <div className="text-[10.5px] text-faint">
                    licence {snap.driver?.licenceNo ?? "—"} · expires {snap.driver ? formatDate(snap.driver.licenceExpiry) : "—"}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
                <div className="min-w-0">
                  <div className="text-ink">
                    {snap.lastPing
                      ? `${snap.lastPing.position.lat.toFixed(4)}, ${snap.lastPing.position.lng.toFixed(4)}`
                      : "No fix"}
                  </div>
                  <div className="vf-num text-[10.5px] text-faint">
                    {snap.lastPing ? `${snap.lastPing.speedKph.toFixed(0)} km/h · ${titleCase(snap.vehicle.corridor)}` : "—"}
                  </div>
                </div>
              </li>
            </ul>
          </Panel>

          <Panel title="Compliance calendar">
            <ul className="space-y-2.5">
              {compliance.slice(0, 7).map((item) => (
                <li key={item.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] text-ink">{CATEGORY_LABELS[item.category]}</span>
                    <Pill tone={STATUS_TONE[item.status] ?? "muted"}>{COMPLIANCE_LABEL[item.status]}</Pill>
                  </div>
                  <div className="mt-1">
                    <MeterBar
                      value={Math.max(0, 100 - Math.max(0, item.daysRemaining))}
                      max={100}
                      tone={item.status === "expired" ? "danger" : item.status === "critical" ? "warn" : "mint"}
                      height={4}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10.5px] text-faint">
                    <span>{formatDate(item.dueDate)}</span>
                    <span className="vf-num">
                      {item.daysRemaining < 0
                        ? `${Math.abs(item.daysRemaining)}d overdue`
                        : `${item.daysRemaining}d left`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Distance profile">
            <dl className="space-y-2 text-[11.5px]">
              <Line label="30-day distance" value={`${formatNumber(distance30d)} km`} />
              <Line label="Average per day" value={`${formatNumber(distance30d / 30)} km`} />
              <Line
                label="Litres per 100 km"
                value={`${((100 / vehicle.kmPerLitre) * 1).toFixed(1)} L`}
              />
              <Line
                label="Fuel cost per km"
                value={formatKes(190 / vehicle.kmPerLitre, { decimals: 2 })}
              />
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const colour = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="vf-panel vf-panel-hover p-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={`vf-num mt-2 text-[20px] font-semibold leading-none ${colour}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="vf-num font-semibold text-ink">{value}</dd>
    </div>
  );
}
