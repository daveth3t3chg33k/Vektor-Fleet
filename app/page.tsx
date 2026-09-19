import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Fuel, Route, ShieldCheck, TrendingDown } from "lucide-react";
import OpsMap from "@/components/OpsMap";
import { EmptyState, HealthRing, MeterBar, PageHeader, Panel, Pill, SEVERITY_TONE, StatCard } from "@/components/ui";
import { buildAlertQueue, CATEGORY_LABELS, fleetCompliancePosture } from "@/lib/engines/compliance";
import { allSnapshots, fleetKpis } from "@/lib/engines/fleet";
import { auditFleet } from "@/lib/engines/fuelMatch";
import {
  FLAG_CODE_LABEL,
  formatDate,
  formatKes,
  formatLitres,
  formatNumber,
  relativeTime,
  titleCase,
} from "@/lib/format";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const kpis = fleetKpis();
  const snapshots = allSnapshots();
  const audit = auditFleet();
  const posture = fleetCompliancePosture();
  const alerts = buildAlertQueue();
  const dataset = getDataset();

  const topLeaks = [...audit.reconciliations].sort((a, b) => b.exposureKes - a.exposureKes);
  const maxExposure = Math.max(1, ...topLeaks.map((r) => r.exposureKes));
  const upcoming = alerts.filter((a) => a.daysRemaining >= 0).slice(0, 6);
  const recentFlags = audit.flags.slice(0, 7);
  const fleetById = new Map(dataset.fleets.map((f) => [f.id, f]));

  return (
    <>
      <PageHeader
        eyebrow="Control tower"
        title="Fleet operations at a glance"
        description="One screen for every tracker brand in the yard. Telemetry is normalised into a single model, then joined against fuel-card transactions and the regulatory calendar to surface the money that is leaking."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Annualised saving identified"
          value={formatKes(kpis.annualisedSavingKes, { compact: true })}
          sub="Across fuel, behaviour, maintenance and compliance"
          tone="mint"
          icon={<TrendingDown className="h-4 w-4" />}
          trend={`${kpis.breakdown.length} engines`}
        />
        <StatCard
          label="Unexplained fuel"
          value={formatLitres(kpis.unverifiedLitres)}
          sub={`${audit.totals.leakagePercent}% of litres billed in the window`}
          tone="danger"
          icon={<Fuel className="h-4 w-4" />}
          trend={`${audit.flags.length} flags`}
        />
        <StatCard
          label="Compliance at risk"
          value={`${kpis.complianceExpiring30d + kpis.complianceExpired}`}
          sub={`${kpis.complianceExpired} expired · ${kpis.complianceExpiring30d} inside 30 days`}
          tone="warn"
          icon={<ShieldCheck className="h-4 w-4" />}
          trend={formatKes(posture.exposureKes, { compact: true })}
        />
        <StatCard
          label="Distance covered today"
          value={`${formatNumber(kpis.distanceTodayKm)} km`}
          sub={`${kpis.active} active of ${kpis.vehicles} vehicles · ${kpis.offline} offline`}
          tone="signal"
          icon={<Route className="h-4 w-4" />}
          trend={formatKes(kpis.fuelSpendTodayKes, { compact: true })}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <Panel
          title="Corridor operations map"
          subtitle="Live positions across the Mombasa Road, Northern Corridor, Nairobi metro and Thika superhighway networks."
          bodyClassName="px-4 py-4"
        >
          <OpsMap snapshots={snapshots} />
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Fleet health" subtitle="Composite of flags, compliance and connectivity.">
            <div className="flex items-center gap-5">
              <HealthRing score={kpis.healthScore} />
              <dl className="flex-1 space-y-2 text-[11.5px]">
                <Row label="Critical flags" value={String(kpis.openCriticalFlags)} tone="danger" />
                <Row label="Expired documents" value={String(kpis.complianceExpired)} tone="danger" />
                <Row label="Expiring in 30 days" value={String(kpis.complianceExpiring30d)} tone="warn" />
                <Row label="Devices offline" value={String(kpis.offline)} tone="muted" />
              </dl>
            </div>
          </Panel>

          <Panel title="Managed book" subtitle="Fleets onboarded to the platform." bodyClassName="px-5 pb-5 pt-4">
            <ul className="space-y-3">
              {dataset.fleets.map((fleet) => {
                const count = snapshots.filter((s) => s.vehicle.fleetId === fleet.id).length;
                return (
                  <li key={fleet.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-medium text-ink">{fleet.name}</div>
                      <div className="text-[10.5px] text-faint">
                        {fleet.hq} · {fleet.sector}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={fleet.contractPlan === "enterprise" ? "violet" : "signal"}>
                        {fleet.contractPlan}
                      </Pill>
                      <span className="vf-num text-[11px] text-muted">{count} vehicles</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Where the saving comes from"
          subtitle="Every line states its method so procurement can audit the number."
        >
          <div className="space-y-3">
            {kpis.breakdown.map((item) => (
              <div key={item.label} className="rounded-xl border border-line bg-surface-2/40 p-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-medium text-ink">{item.label}</span>
                  <span className="vf-num text-[13px] font-semibold text-mint">
                    {formatKes(item.annualKes, { compact: true })}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-snug text-muted">{item.description}</p>
                <p className="mt-1.5 font-mono text-[10.5px] leading-snug text-faint">{item.method}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Fuel leakage by vehicle"
          subtitle="Ranked by recoverable value from the match engine."
          action={
            <Link
              href="/fuel"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-signal hover:text-ink"
            >
              Full audit <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {topLeaks.length === 0 ? (
            <EmptyState title="No fuel history" detail="Connect a fuel card feed to begin reconciliation." />
          ) : (
            <ul className="space-y-3.5">
              {topLeaks.slice(0, 7).map((rec) => {
                const vehicle = dataset.vehicles.find((v) => v.id === rec.vehicleId)!;
                const fleet = fleetById.get(vehicle.fleetId);
                return (
                  <li key={rec.vehicleId}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
                        {rec.plate}
                        <span className="text-[10.5px] font-normal text-faint">{fleet?.name}</span>
                      </span>
                      <span className="vf-num text-[12px] text-muted">
                        {formatLitres(rec.unverifiedLitres)} ·{" "}
                        <span className={rec.exposureKes > 0 ? "text-danger" : "text-faint"}>
                          {formatKes(rec.exposureKes, { compact: true })}
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <MeterBar
                        value={rec.exposureKes}
                        max={maxExposure}
                        tone={rec.exposureKes > maxExposure * 0.5 ? "danger" : rec.exposureKes > 0 ? "warn" : "muted"}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10.5px] text-faint">
                      <span>{rec.leakagePercent}% of {formatLitres(rec.totalLitres)} billed</span>
                      <span>{rec.flags.length} flag{rec.flags.length === 1 ? "" : "s"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Latest fuel-match findings"
          subtitle="Card volume versus what the trip plan can justify."
          action={
            <Link href="/fuel" className="text-[11px] font-semibold text-signal hover:text-ink">
              Investigate
            </Link>
          }
        >
          {recentFlags.length === 0 ? (
            <EmptyState title="No findings" detail="Nothing in the window disagreed with the telemetry." />
          ) : (
            <ul className="space-y-2.5">
              {recentFlags.map((flag) => (
                <li key={flag.id} className="rounded-xl border border-line bg-surface-2/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={SEVERITY_TONE[flag.severity]} dot>
                      {flag.severity}
                    </Pill>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                      {FLAG_CODE_LABEL[flag.code] ?? flag.code}
                    </span>
                    <span className="ml-auto vf-num text-[11px] text-muted">
                      {relativeTime(flag.detectedAt)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium leading-snug text-ink">
                        {flag.headline}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">
                        {flag.detail}
                      </p>
                    </div>
                    {flag.exposureKes > 0 && (
                      <span className="vf-num shrink-0 text-[11.5px] font-semibold text-danger">
                        {formatKes(flag.exposureKes, { compact: true })}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Compliance runway"
          subtitle="Statutory deadlines sequenced by money at risk, not just date."
          action={
            <Link href="/compliance" className="text-[11px] font-semibold text-signal hover:text-ink">
              Calendar
            </Link>
          }
        >
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing due" detail="Every tracked obligation is more than 30 days out." />
          ) : (
            <ul className="space-y-2">
              {upcoming.map((alert) => {
                const vehicle = dataset.vehicles.find((v) => v.id === alert.vehicleId)!;
                const item = dataset.complianceItems.find((i) => i.id === alert.itemId);
                return (
                  <li
                    key={alert.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5"
                  >
                    <div
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg border text-center ${
                        alert.daysRemaining <= 7
                          ? "border-warn/30 bg-warn/10 text-warn"
                          : "border-signal/25 bg-signal/10 text-signal"
                      }`}
                    >
                      <span className="vf-num text-[13px] font-semibold leading-none">
                        {alert.daysRemaining}
                      </span>
                      <span className="text-[8.5px] uppercase tracking-[0.1em]">days</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-ink">
                        {vehicle.plate} · {item ? CATEGORY_LABELS[item.category] : "Compliance"}
                      </div>
                      <div className="text-[10.5px] text-faint">
                        {item?.authority} · due {formatDate(alert.dueDate)} · via {alert.channel}
                      </div>
                    </div>
                    <Pill tone={alert.daysRemaining <= 7 ? "warn" : "signal"}>
                      {titleCase(alert.tier)}
                    </Pill>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: "danger" | "warn" | "muted" }) {
  const colour = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-muted";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`vf-num font-semibold ${colour}`}>{value}</dd>
    </div>
  );
}
