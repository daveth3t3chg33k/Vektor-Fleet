import { describe, expect, it } from "vitest";
import { buildAlertQueue, evaluateItem, PENALTY_EXPOSURE_KES, worstStatus } from "@/lib/engines/compliance";
import type { ComplianceItem } from "@/lib/domain/types";
import { getDataset } from "@/lib/store/db";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-19T09:00:00Z");

function item(dueInDays: number, leadDays = 30): ComplianceItem {
  return {
    id: "cmp_test",
    vehicleId: "veh_001",
    category: "NTSA_INSPECTION",
    title: "NTSA annual roadworthiness inspection",
    authority: "NTSA",
    dueDate: new Date(NOW + dueInDays * DAY).toISOString(),
    leadDays,
  };
}

describe("compliance engine", () => {
  it("classifies status at each boundary", () => {
    expect(evaluateItem(item(-1), NOW).status).toBe("expired");
    expect(evaluateItem(item(0), NOW).status).toBe("critical");
    expect(evaluateItem(item(7), NOW).status).toBe("critical");
    expect(evaluateItem(item(8), NOW).status).toBe("due_soon");
    expect(evaluateItem(item(30), NOW).status).toBe("due_soon");
    expect(evaluateItem(item(31), NOW).status).toBe("ok");
  });

  it("computes days remaining in whole days", () => {
    expect(evaluateItem(item(10), NOW).daysRemaining).toBe(10);
    expect(evaluateItem(item(-3), NOW).daysRemaining).toBe(-3);
  });

  it("carries no penalty exposure while compliant", () => {
    expect(evaluateItem(item(200), NOW).penaltyExposureKes).toBe(0);
  });

  it("prices exposure with statutory fine plus downtime once breached", () => {
    const expired = evaluateItem(item(-2), NOW);
    expect(expired.penaltyExposureKes).toBeGreaterThan(PENALTY_EXPOSURE_KES.NTSA_INSPECTION);
    const dueSoon = evaluateItem(item(20), NOW);
    expect(dueSoon.penaltyExposureKes).toBe(PENALTY_EXPOSURE_KES.NTSA_INSPECTION);
  });

  it("ranks the worst status across a set", () => {
    const items = [evaluateItem(item(200), NOW), evaluateItem(item(20), NOW), evaluateItem(item(-1), NOW)];
    expect(worstStatus(items)).toBe("expired");
    expect(worstStatus([evaluateItem(item(200), NOW)])).toBe("ok");
  });

  it("splits the alert queue into the documented escalation tiers", () => {
    const alerts = buildAlertQueue();
    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) {
      if (alert.tier === "OVERDUE") expect(alert.daysRemaining).toBeLessThan(0);
      if (alert.tier === "T-1") expect(alert.daysRemaining).toBeLessThanOrEqual(1);
      if (alert.tier === "T-7") expect(alert.daysRemaining).toBeLessThanOrEqual(7);
      if (alert.tier === "T-30") expect(alert.daysRemaining).toBeLessThanOrEqual(30);
      // Nothing should be dispatched before the 30-day lead time.
      expect(alert.daysRemaining).toBeLessThanOrEqual(30);
    }
  });

  it("sorts the queue by urgency", () => {
    const alerts = buildAlertQueue();
    for (let i = 1; i < alerts.length; i++) {
      expect(alerts[i - 1]!.daysRemaining).toBeLessThanOrEqual(alerts[i]!.daysRemaining);
    }
  });

  it("routes statutory safety items to WhatsApp and paperwork to email", () => {
    const dataset = getDataset();
    const alerts = buildAlertQueue();
    const whatsapp = alerts.filter((a) => a.channel === "whatsapp");
    const email = alerts.filter((a) => a.channel === "email");

    expect(whatsapp.length).toBeGreaterThan(0);
    expect(email.length).toBeGreaterThan(0);

    // Only roadworthiness and governor items warrant a driver-facing channel.
    for (const alert of whatsapp) {
      const item = dataset.complianceItems.find((i) => i.id === alert.itemId);
      expect(item).toBeDefined();
      expect(["NTSA_INSPECTION", "SPEED_GOVERNOR"]).toContain(item!.category);
    }
  });

  it("tracks every obligation category across the seeded fleet", () => {
    const dataset = getDataset();
    const categories = new Set(dataset.complianceItems.map((i) => i.category));
    expect(categories.size).toBe(7);
    expect(dataset.complianceItems.length).toBe(dataset.vehicles.length * 7);
  });
});
