import { beforeAll, describe, expect, it } from "vitest";
import { auditFleet, reconcileVehicle, DEFAULT_TUNING } from "@/lib/engines/fuelMatch";
import { getDataset, vehicleByPlate } from "@/lib/store/db";
import type { FuelFlagCode } from "@/lib/domain/types";

/**
 * The seed generator deliberately injects one anomaly profile per vehicle, so
 * the engine can be verified end-to-end: the physics in, the correct flag out.
 */
describe("fuel match engine", () => {
  beforeAll(() => {
    getDataset(); // force a single seeded dataset for deterministic assertions
  });

  const codesFor = (plate: string): FuelFlagCode[] =>
    (reconcileVehicle(vehicleByPlate(plate)!.id)?.flags ?? []).map((f) => f.code);

  it("charges more than the tank can hold on the overfill profile", () => {
    expect(codesFor("KDD 771V")).toContain("OVERFILL_IMPOSSIBLE");
  });

  it("detects short-leg top-ups that the trip plan cannot justify", () => {
    expect(codesFor("KDC 233J")).toContain("EXCESS_LITRES");
  });

  it("detects a card used far away from the vehicle", () => {
    expect(codesFor("KDF 604R")).toContain("STATION_MISMATCH");
  });

  it("detects fuel billed while the vehicle sat still", () => {
    expect(codesFor("KCB 712K")).toContain("GHOST_FILL");
  });

  it("detects a repeat-offender station pattern", () => {
    expect(codesFor("KCD 826B")).toContain("COLLUSION_PATTERN");
  });

  it("leaves a clean vehicle free of critical or high findings", () => {
    const flags = reconcileVehicle(vehicleByPlate("KDA 412M")!.id)?.flags ?? [];
    const serious = flags.filter((f) => f.severity === "critical" || f.severity === "high");
    expect(serious).toHaveLength(0);
  });

  it("attaches evidence and a KES exposure to every revenue-risk flag", () => {
    const reconciliation = reconcileVehicle(vehicleByPlate("KCD 826B")!.id)!;
    const priced = reconciliation.flags.filter((f) =>
      ["OVERFILL_IMPOSSIBLE", "EXCESS_LITRES", "STATION_MISMATCH", "GHOST_FILL", "COLLUSION_PATTERN"].includes(f.code),
    );
    expect(priced.length).toBeGreaterThan(0);
    for (const flag of priced) {
      expect(flag.exposureKes).toBeGreaterThan(0);
      expect(flag.detail.length).toBeGreaterThan(30);
      expect(flag.confidence).toBeGreaterThan(0);
      expect(flag.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("never reports more unverified litres than were billed", () => {
    const audit = auditFleet();
    for (const rec of audit.reconciliations) {
      expect(rec.unverifiedLitres).toBeGreaterThanOrEqual(0);
      expect(rec.unverifiedLitres).toBeLessThanOrEqual(rec.totalLitres + 0.01);
    }
  });

  it("orders the fleet audit by severity then exposure", () => {
    const { flags } = auditFleet();
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    for (let i = 1; i < flags.length; i++) {
      const prev = flags[i - 1]!;
      const curr = flags[i]!;
      const bySeverity = order[prev.severity] - order[curr.severity];
      expect(bySeverity <= 0).toBe(true);
      if (bySeverity === 0) expect(prev.exposureKes).toBeGreaterThanOrEqual(curr.exposureKes);
    }
  });

  it("relaxes to zero findings when the tolerances are made infinite", () => {
    const loose = {
      ...DEFAULT_TUNING,
      excessTolerance: 1e9,
      capacityTolerance: 1e9,
      headroomTolerance: 1e9,
      stationMismatchKm: 1e9,
      minLitresForReview: 1e9,
      collusionCount: 1e9,
    };
    const audit = auditFleet(loose);
    const revenueFlags = audit.flags.filter((f) => f.code !== "OFF_HOURS_FILL");
    expect(revenueFlags).toHaveLength(0);
  });
});
