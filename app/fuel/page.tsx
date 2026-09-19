import Link from "next/link";
import { Fuel, Percent, Radar, Wallet } from "lucide-react";
import { EmptyState, MeterBar, PageHeader, Panel, Pill, SEVERITY_TONE, StatCard } from "@/components/ui";
import { auditFleet, DEFAULT_TUNING } from "@/lib/engines/fuelMatch";
import {
  FLAG_CODE_LABEL,
  formatDateTime,
  formatKes,
  formatLitres,
  formatNumber,
  percent,
  titleCase,
} from "@/lib/format";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

export default function FuelPage() {
  const audit = auditFleet();
  const dataset = getDataset();
  const plateById = new Map(dataset.vehicles.map((v) => [v.id, v.plate]));
  const driverById = new Map(dataset.drivers.map((d) => [d.id, d.name]));
  const txById = new Map(dataset.fuelTransactions.map((t) => [t.id, t]));

  const rankings = [...audit.reconciliations].sort((a, b) => b.exposureKes - a.exposureKes);
  const maxExposure = Math.max(1, ...rankings.map((r) => r.exposureKes));

  return (
    <>
      <PageHeader
        eyebrow="Fuel match engine"
        title="Fuel forensics"
        description="Card volume joined against the trip plan and tank physics, per vehicle, on every fill. Each finding states what was expected, what was billed, and the money at stake — with the evidence an investigator actually needs."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Billed in window"
          value={formatLitres(audit.totals.litres)}
          sub={`${formatKes(audit.totals.spendKes, { compact: true })} across ${audit.reconciliations.reduce((s, r) => s + r.transactions, 0)} card transactions`}
          tone="signal"
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          label="Justified by distance"
          value={formatLitres(audit.totals.expectedLitres)}
          sub="Trip index divided by nominal efficiency"
          tone="mint"
          icon={<Fuel className="h-4 w-4" />}
        />
        <StatCard
          label="Unexplained"
          value={formatLitres(audit.totals.unverifiedLitres)}
          sub={`${percent(audit.totals.leakagePercent)} of litres billed`}
          tone="danger"
          icon={<Percent className="h-4 w-4" />}
          trend={`${audit.flags.length} flags`}
        />
        <StatCard
          label="Recoverable exposure"
          value={formatKes(audit.totals.exposureKes, { compact: true })}
          sub="If every flag is upheld and clawed back"
          tone="warn"
          icon={<Radar className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title="Flag mix" subtitle="Which controls are earning their keep.">
            <ul className="space-y-3">
              {Object.entries(audit.totals.byCode)
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => (
                  <li key={code}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-ink">{FLAG_CODE_LABEL[code] ?? titleCase(code)}</span>
                      <span className="vf-num text-[11.5px] font-semibold text-muted">{count}</span>
                    </div>
                    <div className="mt-1.5">
                      <MeterBar value={count} max={Math.max(...Object.values(audit.totals.byCode))} tone="signal" height={5} />
                    </div>
                  </li>
                ))}
              {Object.keys(audit.totals.byCode).length === 0 && (
                <EmptyState title="No findings" detail="Nothing in the ledger disagreed with telemetry." />
              )}
            </ul>
          </Panel>

          <Panel title="Severity" subtitle="Triage order for the recovery team.">
            <ul className="space-y-3">
              {SEVERITY_ORDER.map((sev) => (
                <li key={sev} className="flex items-center justify-between gap-3">
                  <Pill tone={SEVERITY_TONE[sev]} dot>
                    {sev}
                  </Pill>
                  <span className="vf-num text-[14px] font-semibold text-ink">
                    {audit.totals.bySeverity[sev]}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Engine tuning" subtitle="Thresholds currently in force. Exposed because every flag must be explainable.">
            <dl className="space-y-2 font-mono text-[10.5px]">
              <TuneRow label="excess_tolerance" value={`×${DEFAULT_TUNING.excessTolerance}`} />
              <TuneRow label="excess_floor_l" value={`${DEFAULT_TUNING.excessFloorL} L`} />
              <TuneRow label="capacity_tolerance" value={`×${DEFAULT_TUNING.capacityTolerance}`} />
              <TuneRow label="headroom_tolerance" value={`×${DEFAULT_TUNING.headroomTolerance}`} />
              <TuneRow label="station_mismatch_km" value={`${DEFAULT_TUNING.stationMismatchKm} km`} />
              <TuneRow label="min_litres_for_review" value={`${DEFAULT_TUNING.minLitresForReview} L`} />
              <TuneRow
                label="collusion"
                value={`${DEFAULT_TUNING.collusionCount} fills / ${DEFAULT_TUNING.collusionWindowDays}d`}
              />
            </dl>
          </Panel>

          <Panel title="Leakage by vehicle" subtitle="Ranked by recoverable value.">
            <ul className="space-y-3.5">
              {rankings.slice(0, 8).map((r) => (
                <li key={r.vehicleId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/vehicles/${r.vehicleId}`}
                      className="vf-num text-[12.5px] font-semibold text-ink transition-colors hover:text-signal"
                    >
                      {r.plate}
                    </Link>
                    <span className="vf-num text-[11.5px] text-muted">
                      {formatLitres(r.unverifiedLitres)} · {formatKes(r.exposureKes, { compact: true })}
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <MeterBar
                      value={r.exposureKes}
                      max={maxExposure}
                      tone={r.exposureKes > maxExposure * 0.5 ? "danger" : r.exposureKes > 0 ? "warn" : "muted"}
                      height={5}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel
          title={`Investigation queue — ${audit.flags.length} findings`}
          subtitle="Ordered by severity, then by money at stake. Every row carries its own reasoning."
          bodyClassName="px-4 py-4"
        >
          {audit.flags.length === 0 ? (
            <EmptyState
              title="No disagreements found"
              detail="Every litre billed in the window is explained by the distance actually driven."
            />
          ) : (
            <ul className="space-y-3">
              {audit.flags.map((flag) => {
                const tx = txById.get(flag.transactionId);
                return (
                  <li key={flag.id} className="rounded-xl border border-line bg-surface-2/40 p-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <Pill tone={SEVERITY_TONE[flag.severity]} dot>
                        {flag.severity}
                      </Pill>
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">
                        {FLAG_CODE_LABEL[flag.code] ?? flag.code}
                      </span>
                      <Link
                        href={`/vehicles/${flag.vehicleId}`}
                        className="vf-num text-[12px] font-semibold text-ink transition-colors hover:text-signal"
                      >
                        {plateById.get(flag.vehicleId)}
                      </Link>
                      <span className="text-[11px] text-muted">{driverById.get(flag.driverId) ?? "—"}</span>
                      <span className="vf-num ml-auto text-[11px] text-faint">
                        {formatDateTime(flag.detectedAt)}
                      </span>
                    </div>

                    <h3 className="mt-2.5 text-[13px] font-medium leading-snug text-ink">{flag.headline}</h3>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{flag.detail}</p>

                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <Metric label="Expected" value={flag.expectedLitres === null ? "n/a" : formatLitres(flag.expectedLitres)} />
                      <Metric label="Billed" value={formatLitres(flag.actualLitres)} />
                      <Metric label="Exposure" value={formatKes(flag.exposureKes)} tone="danger" />
                      <Metric label="Confidence" value={percent(flag.confidence * 100, 0)} />
                    </div>

                    {tx && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[10.5px] text-faint">
                        <span>{tx.stationName}</span>
                        <span className="vf-num">
                          {formatKes(tx.unitPriceKes, { decimals: 2 })}/L · {formatKes(tx.totalKes)}
                        </span>
                        {tx.odometerAtPumpKm !== undefined && (
                          <span className="vf-num">pump odometer {formatNumber(tx.odometerAtPumpKm)} km</span>
                        )}
                        <span className="ml-auto font-mono">{flag.id}</span>
                      </div>
                    )}
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

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div className="rounded-lg border border-line bg-void/40 px-3 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className={`vf-num mt-0.5 text-[12.5px] font-semibold ${tone === "danger" ? "text-danger" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function TuneRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
      <dt className="text-faint">{label}</dt>
      <dd className="text-muted">{value}</dd>
    </div>
  );
}
