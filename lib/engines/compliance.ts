import type {
  ComplianceAlert,
  ComplianceCategory,
  ComplianceEvaluation,
  ComplianceItem,
  ComplianceStatus,
} from "@/lib/domain/types";
import { getDataset, vehicleById } from "@/lib/store/db";

/**
 * Compliance engine.
 *
 * Kenyan commercial fleet compliance is a calendar problem disguised as a
 * paperwork problem: NTSA inspections, governor recalibration, insurance,
 * transit licences, county permits, KRA filings and emissions certificates all
 * fall due on independent clocks. This engine puts them on one timeline, scores
 * the risk, and emits tiered WhatsApp/SMS/email reminders 30, 7 and 1 day out.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Statutory fine exposure per category, in KES, used to rank urgency by money
 * at risk rather than by date alone.
 */
export const PENALTY_EXPOSURE_KES: Record<ComplianceCategory, number> = {
  NTSA_INSPECTION: 50_000,
  SPEED_GOVERNOR: 30_000,
  INSURANCE: 80_000,
  TRANSIT_LICENCE: 40_000,
  COUNTY_PERMIT: 25_000,
  KRA_TAX: 60_000,
  EMISSION: 20_000,
};

/** Downtime cost per day of an impounded vehicle, in KES. */
export const DOWNTIME_PER_DAY_KES = 12_000;

export const CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  NTSA_INSPECTION: "NTSA inspection",
  SPEED_GOVERNOR: "Speed governor",
  INSURANCE: "Insurance",
  TRANSIT_LICENCE: "Transit licence",
  COUNTY_PERMIT: "County permit",
  KRA_TAX: "KRA filing",
  EMISSION: "Emissions",
};

export function evaluateItem(item: ComplianceItem, nowMs = Date.now()): ComplianceEvaluation {
  const due = Date.parse(item.dueDate);
  const daysRemaining = Math.floor((due - nowMs) / DAY_MS);

  let status: ComplianceStatus;
  if (daysRemaining < 0) status = "expired";
  else if (daysRemaining <= 7) status = "critical";
  else if (daysRemaining <= item.leadDays) status = "due_soon";
  else status = "ok";

  // Money at risk grows as the deadline closes: a fine plus two days of
  // downtime while the vehicle sits idle waiting on paperwork.
  const base = PENALTY_EXPOSURE_KES[item.category];
  const downtime = daysRemaining < 0 ? DOWNTIME_PER_DAY_KES * 2 : 0;
  const penaltyExposureKes = status === "ok" ? 0 : base + downtime;

  return { ...item, status, daysRemaining, penaltyExposureKes };
}

export function evaluateAll(vehicleId: string, nowMs = Date.now()): ComplianceEvaluation[] {
  return getDataset()
    .complianceItems.filter((i) => i.vehicleId === vehicleId)
    .map((i) => evaluateItem(i, nowMs))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export function worstStatus(items: ComplianceEvaluation[]): ComplianceStatus {
  const rank: ComplianceStatus[] = ["ok", "due_soon", "critical", "expired"];
  return items.reduce<ComplianceStatus>(
    (worst, item) => (rank.indexOf(item.status) > rank.indexOf(worst) ? item.status : worst),
    "ok",
  );
}

export function summary(items: ComplianceEvaluation[]) {
  return {
    expired: items.filter((i) => i.status === "expired").length,
    critical: items.filter((i) => i.status === "critical").length,
    dueSoon: items.filter((i) => i.status === "due_soon").length,
    ok: items.filter((i) => i.status === "ok").length,
    exposureKes: items.reduce((s, i) => s + i.penaltyExposureKes, 0),
  };
}

/**
 * Builds the outbound reminder queue. Tiers fire at T-30, T-7, T-1 and a daily
 * escalation once the item is overdue.
 */
export function buildAlertQueue(nowMs = Date.now()): ComplianceAlert[] {
  const alerts: ComplianceAlert[] = [];
  const dataset = getDataset();

  for (const item of dataset.complianceItems) {
    const evaluation = evaluateItem(item, nowMs);
    const { daysRemaining } = evaluation;

    let tier: ComplianceAlert["tier"] | null = null;
    if (daysRemaining < 0) tier = "OVERDUE";
    else if (daysRemaining <= 1) tier = "T-1";
    else if (daysRemaining <= 7) tier = "T-7";
    else if (daysRemaining <= item.leadDays) tier = "T-30";
    if (!tier) continue;

    const vehicle = vehicleById(item.vehicleId);
    const plate = vehicle?.plate ?? item.vehicleId;
    const channel: ComplianceAlert["channel"] =
      item.category === "NTSA_INSPECTION" || item.category === "SPEED_GOVERNOR"
        ? "whatsapp"
        : "email";

    const when =
      daysRemaining < 0
        ? `expired ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`
        : daysRemaining === 0
          ? "is due today"
          : `is due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;

    alerts.push({
      id: `alr_${item.id}_${tier}`,
      itemId: item.id,
      vehicleId: item.vehicleId,
      dueDate: item.dueDate,
      daysRemaining,
      channel,
      tier,
      message: `${tier === "OVERDUE" ? "OVERDUE" : "Reminder"}: ${plate} — ${item.title} ${when} (${item.authority}). Estimated exposure KES ${evaluation.penaltyExposureKes.toLocaleString()}.`,
    });
  }

  return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/** Fleet-wide compliance posture, including a 0-100 risk score. */
export function fleetCompliancePosture(nowMs = Date.now()) {
  const evaluations = getDataset().complianceItems.map((i) => evaluateItem(i, nowMs));
  const stats = summary(evaluations);
  const total = evaluations.length || 1;
  const healthy = stats.ok / total;
  const score = Math.round(
    Math.max(
      0,
      100 - (stats.expired * 18 + stats.critical * 9 + stats.dueSoon * 3) / Math.max(1, total / 14),
    ),
  );
  return {
    ...stats,
    total: evaluations.length,
    healthyPercent: Math.round(healthy * 100),
    riskScore: Math.min(100, score),
    evaluations,
  };
}

/** Items for one vehicle, evaluated. */
export function vehicleCompliance(vehicleId: string, nowMs = Date.now()) {
  const items = evaluateAll(vehicleId, nowMs);
  return { items, worst: worstStatus(items), stats: summary(items) };
}
