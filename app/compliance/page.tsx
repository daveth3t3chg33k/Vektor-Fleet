import Link from "next/link";
import { CalendarClock, Mail, MessageCircle, ShieldAlert } from "lucide-react";
import { EmptyState, MeterBar, PageHeader, Panel, Pill, STATUS_TONE, StatCard } from "@/components/ui";
import { buildAlertQueue, CATEGORY_LABELS, fleetCompliancePosture } from "@/lib/engines/compliance";
import { COMPLIANCE_LABEL, formatDate, formatKes, titleCase } from "@/lib/format";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

const TIER_ORDER = ["OVERDUE", "T-1", "T-7", "T-30"] as const;

export default function CompliancePage() {
  const posture = fleetCompliancePosture();
  const alerts = buildAlertQueue();
  const dataset = getDataset();
  const vehicleById = new Map(dataset.vehicles.map((v) => [v.id, v]));
  const itemById = new Map(dataset.complianceItems.map((i) => [i.id, i]));

  const byTier = new Map<string, typeof alerts>();
  for (const alert of alerts) {
    const list = byTier.get(alert.tier) ?? [];
    list.push(alert);
    byTier.set(alert.tier, list);
  }

  const matrix = dataset.vehicles
    .map((vehicle) => {
      const items = posture.evaluations.filter((e) => e.vehicleId === vehicle.id);
      const worst = items.reduce((w, i) => {
        const rank = ["ok", "due_soon", "critical", "expired"];
        return rank.indexOf(i.status) > rank.indexOf(w) ? i.status : w;
      }, "ok" as string);
      return {
        vehicle,
        items,
        worst,
        exposure: items.reduce((s, i) => s + i.penaltyExposureKes, 0),
      };
    })
    .sort((a, b) => b.exposure - a.exposure);

  const categories = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;

  return (
    <>
      <PageHeader
        eyebrow="Regulatory automation"
        title="Compliance runway"
        description="NTSA inspections, governor recalibrations, insurance, transit licences, county permits, KRA filings and emissions certificates on one timeline — with reminders dispatched 30, 7 and 1 day out so nothing lapses by accident."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Expired obligations"
          value={String(posture.expired)}
          sub="Already exposed to fines and impoundment"
          tone="danger"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <StatCard
          label="Inside 7 days"
          value={String(posture.critical)}
          sub="Escalation tier — WhatsApp plus email"
          tone="warn"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatCard
          label="Due in 30 days"
          value={String(posture.dueSoon)}
          sub={`${posture.healthyPercent}% of all tracked items are healthy`}
          tone="signal"
          icon={<Mail className="h-4 w-4" />}
        />
        <StatCard
          label="Penalty exposure"
          value={formatKes(posture.exposureKes, { compact: true })}
          sub="Statutory fines plus two days of avoided downtime"
          tone="violet"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel
          title={`Reminder queue — ${alerts.length} scheduled dispatches`}
          subtitle="The exact messages the platform would send today, grouped by escalation tier."
        >
          {alerts.length === 0 ? (
            <EmptyState title="Nothing to dispatch" detail="Every tracked obligation is more than 30 days from falling due." />
          ) : (
            <div className="space-y-5">
              {TIER_ORDER.filter((tier) => (byTier.get(tier) ?? []).length > 0).map((tier) => (
                <div key={tier}>
                  <div className="mb-2 flex items-center gap-2">
                    <Pill tone={tier === "OVERDUE" ? "danger" : tier === "T-1" ? "warn" : "signal"}>
                      {titleCase(tier)}
                    </Pill>
                    <span className="vf-num text-[11px] text-faint">
                      {(byTier.get(tier) ?? []).length} messages
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {(byTier.get(tier) ?? []).slice(0, 12).map((alert) => {
                      const item = itemById.get(alert.itemId);
                      const vehicle = vehicleById.get(alert.vehicleId);
                      return (
                        <li
                          key={alert.id}
                          className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 p-3"
                        >
                          <span
                            className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                              alert.channel === "whatsapp"
                                ? "border-mint/25 bg-mint/10 text-mint"
                                : "border-signal/25 bg-signal/10 text-signal"
                            }`}
                          >
                            {alert.channel === "whatsapp" ? (
                              <MessageCircle className="h-4 w-4" />
                            ) : (
                              <Mail className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <Link
                                href={`/vehicles/${alert.vehicleId}`}
                                className="vf-num text-[12px] font-semibold text-ink transition-colors hover:text-signal"
                              >
                                {vehicle?.plate}
                              </Link>
                              <span className="text-[11.5px] text-muted">
                                {item ? CATEGORY_LABELS[item.category] : "Compliance item"}
                              </span>
                              <span className="ml-auto vf-num text-[10.5px] text-faint">
                                {formatDate(alert.dueDate)}
                              </span>
                            </div>
                            <p className="mt-1 text-[11.5px] leading-snug text-muted">{alert.message}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Obligation coverage" subtitle="How many vehicles each obligation is tracked against.">
            <ul className="space-y-3">
              {categories.map((category) => {
                const items = posture.evaluations.filter((e) => e.category === category);
                const risky = items.filter((i) => i.status !== "ok").length;
                return (
                  <li key={category}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-ink">{CATEGORY_LABELS[category]}</span>
                      <span className="vf-num text-[11px] text-muted">
                        {risky}/{items.length} at risk
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <MeterBar
                        value={risky}
                        max={Math.max(1, items.length)}
                        tone={risky > items.length / 2 ? "danger" : risky > 0 ? "warn" : "mint"}
                        height={5}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="Risk score" subtitle="Weighted by expiries, escalations and remaining lead time.">
            <div className="flex items-center gap-4">
              <div className="vf-num text-4xl font-semibold text-ink">{posture.riskScore}</div>
              <div className="flex-1">
                <MeterBar
                  value={posture.riskScore}
                  max={100}
                  tone={posture.riskScore >= 80 ? "mint" : posture.riskScore >= 55 ? "warn" : "danger"}
                  height={8}
                />
                <p className="mt-2 text-[11px] leading-snug text-muted">
                  {posture.riskScore >= 80
                    ? "Strong posture — reminders are converting ahead of deadlines."
                    : posture.riskScore >= 55
                      ? "Workable, but expired items need clearing this week."
                      : "Material exposure — several obligations have already lapsed."}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        className="mt-4"
        title="Compliance matrix"
        subtitle="Every vehicle against every obligation. Red means the platform is already sending escalations."
        bodyClassName="px-4 py-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.12em] text-faint">
                <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                {categories.map((c) => (
                  <th key={c} className="px-3 py-2.5 font-semibold">
                    {CATEGORY_LABELS[c]}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right font-semibold">Exposure</th>
                <th className="px-3 py-2.5 font-semibold">Worst</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.vehicle.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/40">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/vehicles/${row.vehicle.id}`}
                      className="vf-num text-[12px] font-semibold text-ink transition-colors hover:text-signal"
                    >
                      {row.vehicle.plate}
                    </Link>
                    <span className="block text-[10px] text-faint">
                      {row.vehicle.make} {row.vehicle.model}
                    </span>
                  </td>
                  {categories.map((category) => {
                    const item = row.items.find((i) => i.category === category);
                    if (!item) {
                      return (
                        <td key={category} className="px-3 py-2.5 text-[11px] text-faint">
                          —
                        </td>
                      );
                    }
                    const tone =
                      item.status === "expired"
                        ? "bg-danger/15 text-danger border-danger/25"
                        : item.status === "critical"
                          ? "bg-warn/12 text-warn border-warn/25"
                          : item.status === "due_soon"
                            ? "bg-signal/10 text-signal border-signal/20"
                            : "bg-mint/8 text-mint border-mint/20";
                    return (
                      <td key={category} className="px-3 py-2.5">
                        <span
                          className={`vf-num inline-flex min-w-[62px] justify-center rounded-md border px-2 py-1 text-[10.5px] font-semibold ${tone}`}
                          title={`${item.title} · due ${formatDate(item.dueDate)}`}
                        >
                          {item.daysRemaining < 0 ? `${Math.abs(item.daysRemaining)}d over` : `${item.daysRemaining}d`}
                        </span>
                      </td>
                    );
                  })}
                  <td className="vf-num px-3 py-2.5 text-right text-[11.5px] text-muted">
                    {row.exposure > 0 ? formatKes(row.exposure, { compact: true }) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={STATUS_TONE[row.worst] ?? "muted"}>
                      {COMPLIANCE_LABEL[row.worst]}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
