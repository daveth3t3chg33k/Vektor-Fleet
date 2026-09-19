import { haversineKm } from "@/lib/domain/geo";
import type {
  FuelFlag,
  FuelFlagCode,
  FuelTransaction,
  FlagSeverity,
  Vehicle,
} from "@/lib/domain/types";
import {
  distanceInWindow,
  expectedLitresInWindow,
  positionAt,
} from "@/lib/engines/telemetry";
import { getDataset, vehicleById, transactionsForVehicle } from "@/lib/store/db";

/**
 * The Fuel Match Engine.
 *
 * Card data alone cannot prove theft, and fuel-probe data alone cannot either.
 * This engine joins three independent sources — fuel-card transactions, the GPS
 * trip index, and the tank physics of the vehicle itself — and flags the exact
 * points where they disagree. Every flag carries its own evidence and a KES
 * exposure so an ops manager can act on it without reading raw telemetry.
 */

export interface EngineTuning {
  /** Allowed consumption overshoot vs the trip-derived baseline. */
  excessTolerance: number;
  /** Absolute litres of slack before an excess fill is flagged. */
  excessFloorL: number;
  /** Card volume above this multiple of tank capacity is physically impossible. */
  capacityTolerance: number;
  /** Headroom overshoot allowed before a fill is deemed impossible. */
  headroomTolerance: number;
  /**
   * Distance between station and vehicle before a mismatch is raised. Set well
   * above the ~20 km spacing of plausible fuelling points along the corridors,
   * so an honest fill in a sparsely serviced stretch is never flagged.
   */
  stationMismatchKm: number;
  /** Minimum litres for a fill to be worth investigating at all. */
  minLitresForReview: number;
  /** Transactions at one station by one driver inside the window that trip a pattern. */
  collusionCount: number;
  collusionWindowDays: number;
  /**
   * Volume drawn at one station as a multiple of what the vehicle could
   * physically have burnt over the same period. Regular, honest fuelling sits at
   * ~1.0, so this must clear 1 comfortably before a pattern is asserted.
   */
  collusionVolumeRatio: number;
  /** Share of the vehicle's total litres that must concentrate at one station. */
  collusionConcentration: number;
}

export const DEFAULT_TUNING: EngineTuning = {
  excessTolerance: 1.25,
  excessFloorL: 5,
  capacityTolerance: 1.02,
  headroomTolerance: 1.08,
  stationMismatchKm: 60,
  minLitresForReview: 12,
  collusionCount: 4,
  collusionWindowDays: 21,
  collusionVolumeRatio: 1.12,
  collusionConcentration: 0.55,
};

function describeTrackedState(source: "trip" | "parked" | "depot"): string {
  switch (source) {
    case "trip":
      return " on route";
    case "parked":
      return " stopped at its last known position";
    default:
      return " parked at its home depot";
  }
}

export interface VehicleFuelReconciliation {
  vehicleId: string;
  plate: string;
  transactions: number;
  totalLitres: number;
  totalSpendKes: number;
  /** Litres the trip plan says should have been consumed in the same window. */
  expectedLitres: number;
  /** Litres that cannot be explained by driving — the recoverable pool. */
  unverifiedLitres: number;
  /** unverifiedLitres as a percentage of litres bought. */
  leakagePercent: number;
  exposureKes: number;
  flags: FuelFlag[];
  /** Reconstructed tank level at the end of the walk, when known. */
  closingLevelL: number | null;
}

interface Event {
  ts: number;
  kind: "trip" | "fill";
  distanceKm: number;
  tx?: FuelTransaction;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** East Africa Time is UTC+3 year round. */
function hourEAT(tsMs: number): number {
  return (new Date(tsMs).getUTCHours() + 3) % 24;
}

function isOffHours(tsMs: number): boolean {
  const hour = hourEAT(tsMs);
  // Long-haul crews legitimately fuel before a 05:00 departure, so the window
  // starts at 22:00 and closes at 05:00 rather than sweeping up every early start.
  return hour >= 22 || hour < 5;
}

function severityFor(code: FuelFlagCode, ratio: number): FlagSeverity {
  switch (code) {
    case "OVERFILL_IMPOSSIBLE":
    case "GHOST_FILL":
      return "critical";
    case "STATION_MISMATCH":
    case "COLLUSION_PATTERN":
      return "high";
    case "EXCESS_LITRES":
      return ratio >= 1.6 ? "high" : "medium";
    case "ODOMETER_REGRESSION":
      return "medium";
    case "OFF_HOURS_FILL":
      return "low";
    default:
      return "low";
  }
}

function makeFlag(
  partial: Omit<FuelFlag, "id" | "detectedAt"> & { detectedAt?: string },
  fallbackDetectedAt = new Date().toISOString(),
): FuelFlag {
  const detectedAt = partial.detectedAt ?? fallbackDetectedAt;
  return {
    ...partial,
    detectedAt,
    id: `flg_${partial.code.toLowerCase()}_${partial.transactionId}`,
  };
}

/**
 * Single-pass reconciliation of one vehicle's fuel ledger.
 *
 * The walk is chronological: trips burn fuel, card transactions add it. Because
 * the generator (and in production, the GPS feed) is the only source of
 * distance, any litre the vehicle could not physically have burnt shows up as
 * unexplained.
 */
export function reconcileVehicle(
  vehicleId: string,
  tuning: EngineTuning = DEFAULT_TUNING,
): VehicleFuelReconciliation | null {
  const vehicle = vehicleById(vehicleId);
  if (!vehicle) return null;
  return reconcile(vehicle, transactionsForVehicle(vehicleId), getDataset().trips, tuning);
}

export function reconcile(
  vehicle: Vehicle,
  transactions: FuelTransaction[],
  allTrips: { vehicleId: string; startTs: string; endTs: string; distanceKm: number }[],
  tuning: EngineTuning = DEFAULT_TUNING,
): VehicleFuelReconciliation {
  const trips = allTrips
    .filter((t) => t.vehicleId === vehicle.id)
    .sort((a, b) => a.startTs.localeCompare(b.startTs));
  const txs = [...transactions].sort((a, b) => a.ts.localeCompare(b.ts));

  const events: Event[] = [
    ...trips.map<Event>((t) => ({
      ts: Date.parse(t.startTs),
      kind: "trip",
      distanceKm: t.distanceKm,
    })),
    ...txs.map<Event>((tx) => ({ ts: Date.parse(tx.ts), kind: "fill", distanceKm: 0, tx })),
  ].sort((a, b) => a.ts - b.ts);

  const flags: FuelFlag[] = [];
  let levelL: number | null = null;
  let openingLevelL: number | null = null;
  let lastFillTs: number | null = null;
  let lastKnownOdometerKm: number | null = null;
  let totalLitres = 0;
  let totalSpendKes = 0;
  let fillIndex = 0;

  for (const event of events) {
    if (event.kind === "trip") {
      if (levelL !== null) levelL = Math.max(0, levelL - event.distanceKm / vehicle.kmPerLitre);
      continue;
    }

    const tx = event.tx!;
    totalLitres += tx.litres;
    totalSpendKes += tx.totalKes;
    const txMs = event.ts;

    // ---- 1. Odometer regression ----------------------------------------
    if (tx.odometerAtPumpKm !== undefined) {
      if (lastKnownOdometerKm !== null && tx.odometerAtPumpKm < lastKnownOdometerKm - 5) {
        flags.push(
          makeFlag({
            code: "ODOMETER_REGRESSION",
            severity: severityFor("ODOMETER_REGRESSION", 0),
            vehicleId: vehicle.id,
            driverId: tx.driverId,
            transactionId: tx.id,
            headline: "Odometer reading went backwards at the pump",
            detail: `Pump reading of ${tx.odometerAtPumpKm.toLocaleString()} km is lower than the previous logged reading of ${lastKnownOdometerKm.toLocaleString()} km.`,
            expectedLitres: null,
            actualLitres: tx.litres,
            exposureKes: 0,
            confidence: 0.75,
          }),
        );
      }
      lastKnownOdometerKm = Math.max(lastKnownOdometerKm ?? 0, tx.odometerAtPumpKm);
    }

    // ---- 2. Physically impossible fill ---------------------------------
    const headroom = levelL === null ? null : Math.max(0, vehicle.tankCapacityL - levelL);
    const exceedsCapacity = tx.litres > vehicle.tankCapacityL * tuning.capacityTolerance;
    const exceedsHeadroom =
      headroom !== null &&
      tx.litres > headroom * tuning.headroomTolerance + 5 &&
      tx.litres > tuning.minLitresForReview;

    if (exceedsCapacity || exceedsHeadroom) {
      const impossible = exceedsCapacity ? tx.litres - vehicle.tankCapacityL : tx.litres - (headroom ?? 0);
      const pctOver = Math.round((impossible / Math.max(1, tx.litres)) * 100);
      flags.push(
        makeFlag({
          code: "OVERFILL_IMPOSSIBLE",
          severity: severityFor("OVERFILL_IMPOSSIBLE", 0),
          vehicleId: vehicle.id,
          driverId: tx.driverId,
          transactionId: tx.id,
          headline: exceedsCapacity
            ? `${tx.litres.toFixed(0)} L charged into a ${vehicle.tankCapacityL} L tank`
            : `${tx.litres.toFixed(0)} L charged with only ${headroom!.toFixed(0)} L of headroom`,
          detail: exceedsCapacity
            ? `The card captured ${tx.litres.toFixed(1)} L, ${impossible.toFixed(1)} L more than the tank can hold. Either the volume was keyed in manually or fuel was dispensed into another container.`
            : `Tank level before the fill was reconstructed at ${(levelL ?? 0).toFixed(1)} L, leaving ${headroom!.toFixed(0)} L of usable space. ${impossible.toFixed(1)} L (${pctOver}%) cannot have entered this tank.`,
          expectedLitres: headroom,
          actualLitres: tx.litres,
          exposureKes: Math.round(impossible * tx.unitPriceKes),
          confidence: exceedsCapacity ? 0.96 : 0.82,
          detectedAt: tx.ts,
        }),
      );
    }

    // ---- 3. Excess litres vs distance actually driven -------------------
    const sinceMs = lastFillTs ?? (trips.length > 0 ? Date.parse(trips[0]!.startTs) : txMs - DAY_MS);
    const distanceSince = distanceInWindow(vehicle.id, sinceMs, txMs);
    const expected = (distanceSince / Math.max(0.1, vehicle.kmPerLitre)) + tuning.excessFloorL;
    const ratio = tx.litres / Math.max(1, expected);

    // The very first fill has no prior reference point: the tank's opening level
    // is unknowable, so no consumption claim can honestly be made against it.
    if (
      fillIndex > 0 &&
      tx.litres > expected * tuning.excessTolerance &&
      tx.litres >= tuning.minLitresForReview &&
      !exceedsCapacity
    ) {
      const excess = tx.litres - expected;
      const confidence = Math.min(0.94, 0.45 + (ratio - tuning.excessTolerance) * 0.5);
      flags.push(
        makeFlag({
          code: "EXCESS_LITRES",
          severity: severityFor("EXCESS_LITRES", ratio),
          vehicleId: vehicle.id,
          driverId: tx.driverId,
          transactionId: tx.id,
          headline: `${excess.toFixed(0)} L more than the trip plan can justify`,
          detail: `Since the previous fill the vehicle covered ${distanceSince.toFixed(0)} km, which at ${vehicle.kmPerLitre} km/L burns about ${expected.toFixed(1)} L. The card captured ${tx.litres.toFixed(1)} L — a surplus of ${excess.toFixed(1)} L.`,
          expectedLitres: Number(expected.toFixed(1)),
          actualLitres: tx.litres,
          exposureKes: Math.round(excess * tx.unitPriceKes),
          confidence: Number(confidence.toFixed(2)),
          detectedAt: tx.ts,
        }),
      );
    }

    // ---- 4. Station nowhere near the vehicle -----------------------------
    const estimate = positionAt(vehicle.id, txMs);
    if (estimate) {
      const gap = haversineKm(estimate.point, tx.position);
      if (gap > tuning.stationMismatchKm) {
        flags.push(
          makeFlag({
            code: "STATION_MISMATCH",
            severity: severityFor("STATION_MISMATCH", ratio),
            vehicleId: vehicle.id,
            driverId: tx.driverId,
            transactionId: tx.id,
            headline: `Card used ${gap.toFixed(0)} km away from the vehicle`,
            detail: `The transaction is logged at ${tx.stationName}, but at ${new Date(txMs).toISOString()} the tracker places the vehicle ${gap.toFixed(0)} km away${describeTrackedState(estimate.source)}.`,
            expectedLitres: null,
            actualLitres: tx.litres,
            exposureKes: Math.round(tx.totalKes * 0.8),
            confidence: Math.min(0.95, 0.6 + gap / 300),
            detectedAt: tx.ts,
          }),
        );
      }
    }

    // ---- 5. Fill while parked (ghost fill) ------------------------------
    const movementWindow = distanceInWindow(vehicle.id, txMs - 12 * 60 * 60 * 1000, txMs + 12 * 60 * 60 * 1000);
    if (movementWindow < 1 && tx.litres >= tuning.minLitresForReview) {
      flags.push(
        makeFlag({
          code: "GHOST_FILL",
          severity: severityFor("GHOST_FILL", 0),
          vehicleId: vehicle.id,
          driverId: tx.driverId,
          transactionId: tx.id,
          headline: `Fuel charged while the vehicle did not move`,
          detail: `No movement is recorded within 12 hours either side of this fill, yet ${tx.litres.toFixed(1)} L were billed at ${tx.stationName}. Fuel cannot have entered a vehicle that never moved.`,
          expectedLitres: 0,
          actualLitres: tx.litres,
          exposureKes: Math.round(tx.totalKes),
          confidence: 0.88,
          detectedAt: tx.ts,
        }),
      );
    }

    // ---- 6. Off-hours pumping -------------------------------------------
    if (isOffHours(txMs) && tx.litres >= tuning.minLitresForReview) {
      flags.push(
        makeFlag({
          code: "OFF_HOURS_FILL",
          severity: severityFor("OFF_HOURS_FILL", 0),
          vehicleId: vehicle.id,
          driverId: tx.driverId,
          transactionId: tx.id,
          headline: `Fuel drawn at ${String(hourEAT(txMs)).padStart(2, "0")}:00 EAT`,
          detail: `${tx.litres.toFixed(1)} L at ${tx.stationName} outside the authorised fuelling window (06:00–22:00 EAT). Correlate with the driver rota and yard gate log.`,
          expectedLitres: null,
          actualLitres: tx.litres,
          exposureKes: 0,
          confidence: 0.6,
          detectedAt: tx.ts,
        }),
      );
    }

    // ---- 7. Advance the ledger ------------------------------------------
    if (levelL === null) {
      // Anchor the reconstruction: assume the tank held exactly the headroom
      // implied by the first fill, which is the least-surprising valid state.
      levelL = Math.max(0, vehicle.tankCapacityL - tx.litres);
      openingLevelL = levelL;
    } else {
      levelL = Math.min(vehicle.tankCapacityL, levelL + tx.litres);
    }
    lastFillTs = txMs;
    fillIndex += 1;
  }

  // ---- Repeat-offender pattern across the window -------------------------
  const patternFlags = detectCollusion(vehicle, txs, tuning);
  flags.push(...patternFlags);

  // ---- Aggregate the unexplained pool ------------------------------------
  //
  // Mass balance over the window:
  //   litres_billed - litres_burnt - net_change_in_tank = unexplained litres
  //
  // The burn is known independently (distance / nominal efficiency), and the
  // net tank change is read off the reconstructed level, so whatever is left
  // over is fuel that was paid for and never consumed.
  const windowStart = txs.length > 0 ? Date.parse(txs[0]!.ts) : Date.now() - 30 * DAY_MS;
  const expectedLitres = expectedLitresInWindow(vehicle, windowStart, Date.now());
  const netTankGain = levelL === null ? 0 : Math.max(0, levelL - (openingLevelL ?? 0));
  const unexplained = Math.max(0, totalLitres - expectedLitres - netTankGain);
  const exposureKes = flags.reduce((sum, f) => sum + f.exposureKes, 0);

  return {
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    transactions: txs.length,
    totalLitres: Number(totalLitres.toFixed(1)),
    totalSpendKes: Math.round(totalSpendKes),
    expectedLitres: Number(expectedLitres.toFixed(1)),
    unverifiedLitres: Number(unexplained.toFixed(1)),
    leakagePercent: totalLitres > 0 ? Number(((unexplained / totalLitres) * 100).toFixed(1)) : 0,
    exposureKes,
    flags,
    closingLevelL: levelL === null ? null : Number(levelL.toFixed(1)),
  };
}

/**
 * Collusion heuristic.
 *
 * The same driver repeatedly filling the same vehicle at the same station, at
 * volumes that exceed what the vehicle could physically have burnt over the same
 * period. Individually each fill passes every per-transaction check; the cadence
 * and the concentration are what give the pattern away.
 */
export function detectCollusion(
  vehicle: Vehicle,
  transactions: FuelTransaction[],
  tuning: EngineTuning = DEFAULT_TUNING,
): FuelFlag[] {
  const flags: FuelFlag[] = [];
  const windowMs = tuning.collusionWindowDays * DAY_MS;

  const groups = new Map<string, FuelTransaction[]>();
  for (const tx of transactions) {
    const key = `${tx.driverId}::${tx.stationName}`;
    const list = groups.get(key) ?? [];
    list.push(tx);
    groups.set(key, list);
  }

  for (const [, list] of groups) {
    const sorted = [...list].sort((a, b) => a.ts.localeCompare(b.ts));
    if (sorted.length < tuning.collusionCount) continue;

    // Evaluate only the most recent window, so one group yields one finding.
    const latest = sorted[sorted.length - 1]!;
    const endMs = Date.parse(latest.ts);
    const spanFrom = Math.max(Date.parse(sorted[0]!.ts), endMs - windowMs);
    const cluster = sorted.filter((t) => Date.parse(t.ts) >= spanFrom);
    if (cluster.length < tuning.collusionCount) continue;

    const litres = cluster.reduce((s, t) => s + t.litres, 0);
    const spend = cluster.reduce((s, t) => s + t.totalKes, 0);
    const avg = litres / cluster.length;
    if (avg < vehicle.tankCapacityL * 0.35) continue;

    // Individually these fills look ordinary. The pattern only becomes visible
    // when the volume drawn at one station is measured against what the vehicle
    // can physically have burnt over the same period.
    const justified = expectedLitresInWindow(vehicle, spanFrom, endMs);
    const ratio = justified <= 0 ? Number.POSITIVE_INFINITY : litres / justified;
    if (ratio < tuning.collusionVolumeRatio) continue;

    const spanLitres = transactions
      .filter((t) => {
        const ts = Date.parse(t.ts);
        return ts >= spanFrom && ts <= endMs;
      })
      .reduce((s, t) => s + t.litres, 0);
    const concentration = spanLitres > 0 ? litres / spanLitres : 0;
    if (concentration < tuning.collusionConcentration) continue;

    const padding = Math.max(0, litres - justified);
    const unitPrice = spend / Math.max(1, litres);
    flags.push(
      makeFlag({
        code: "COLLUSION_PATTERN",
        severity: severityFor("COLLUSION_PATTERN", ratio),
        vehicleId: vehicle.id,
        driverId: vehicle.driverId,
        transactionId: latest.id,
        headline: `${cluster.length} fills at ${latest.stationName} in ${tuning.collusionWindowDays} days`,
        detail: `Same driver, same station, averaging ${avg.toFixed(0)} L per visit and taking ${(
          concentration * 100
        ).toFixed(0)}% of everything this vehicle bought. That volume is ${(
          ratio * 100 - 100
        ).toFixed(0)}% more than the ${justified.toFixed(
          0,
        )} L the trip plan can justify over the same period. No single fill at this station is extraordinary on its own — it is the concentration and the cadence that do not match the vehicle's duty cycle, which is exactly how collusive fuelling hides inside a card report. Suggested action: pull station camera footage for ${latest.ts.slice(
          0,
          10,
        )} and reconcile it against the yard gate log.`,
        expectedLitres: Number(justified.toFixed(1)),
        actualLitres: Number(litres.toFixed(1)),
        exposureKes: Math.round(padding * unitPrice),
        confidence: 0.74,
        detectedAt: latest.ts,
      }),
    );
  }

  return flags;
}

export interface FleetAudit {
  reconciliations: VehicleFuelReconciliation[];
  flags: FuelFlag[];
  totals: {
    litres: number;
    spendKes: number;
    expectedLitres: number;
    unverifiedLitres: number;
    leakagePercent: number;
    exposureKes: number;
    bySeverity: Record<FlagSeverity, number>;
    byCode: Record<string, number>;
  };
}

/** Runs the engine across the whole book of business. */
export function auditFleet(tuning: EngineTuning = DEFAULT_TUNING): FleetAudit {
  const dataset = getDataset();
  const reconciliations = dataset.vehicles
    .map((v) => reconcile(v, transactionsForVehicle(v.id), dataset.trips, tuning))
    .filter((r): r is VehicleFuelReconciliation => r !== null);

  const flags = reconciliations.flatMap((r) => r.flags);

  const bySeverity: Record<FlagSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCode: Record<string, number> = {};
  for (const flag of flags) {
    bySeverity[flag.severity] += 1;
    byCode[flag.code] = (byCode[flag.code] ?? 0) + 1;
  }

  const litres = reconciliations.reduce((s, r) => s + r.totalLitres, 0);
  const spendKes = reconciliations.reduce((s, r) => s + r.totalSpendKes, 0);
  const expectedLitres = reconciliations.reduce((s, r) => s + r.expectedLitres, 0);
  const unverifiedLitres = reconciliations.reduce((s, r) => s + r.unverifiedLitres, 0);
  const exposureKes = flags.reduce((s, f) => s + f.exposureKes, 0);

  return {
    reconciliations,
    flags: flags.sort((a, b) => {
      const order: FlagSeverity[] = ["critical", "high", "medium", "low"];
      const bySev = order.indexOf(a.severity) - order.indexOf(b.severity);
      return bySev !== 0 ? bySev : b.exposureKes - a.exposureKes;
    }),
    totals: {
      litres: Number(litres.toFixed(1)),
      spendKes: Math.round(spendKes),
      expectedLitres: Number(expectedLitres.toFixed(1)),
      unverifiedLitres: Number(unverifiedLitres.toFixed(1)),
      leakagePercent: litres > 0 ? Number(((unverifiedLitres / litres) * 100).toFixed(1)) : 0,
      exposureKes: Math.round(exposureKes),
      bySeverity,
      byCode,
    },
  };
}
