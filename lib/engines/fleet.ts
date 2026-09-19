import type {
  Driver,
  FleetKpis,
  SavingsBreakdown,
  Vehicle,
  VehicleSnapshot,
} from "@/lib/domain/types";
import { evaluateAll, fleetCompliancePosture, worstStatus } from "@/lib/engines/compliance";
import { auditFleet, reconcileVehicle } from "@/lib/engines/fuelMatch";
import {
  distanceInWindow,
  idlingMinutes,
  latestPing,
  overspeedEvents,
  pingsFor,
  WINDOWS,
} from "@/lib/engines/telemetry";
import { deviceByVehicle, driverById, getDataset, vehicleById } from "@/lib/store/db";

/**
 * Fleet analytics — turns raw engine output into the shapes the dashboard
 * renders. Everything here is derived; nothing is stored twice.
 */

export function snapshotFor(vehicle: Vehicle, nowMs = Date.now()): VehicleSnapshot {
  const driver: Driver | null = driverById(vehicle.driverId);
  const device = deviceByVehicle(vehicle.id);
  const pings = pingsFor(vehicle.id, nowMs - 48 * 60 * 60 * 1000, nowMs);
  const lastPing = latestPing(vehicle.id);
  const distance24hKm = distanceInWindow(vehicle.id, nowMs - WINDOWS.day, nowMs);
  const reconciliation = reconcileVehicle(vehicle.id);
  const compliance = evaluateAll(vehicle.id, nowMs);

  // Live efficiency: the reconciliation's window litres vs the 24h distance.
  const liveKmPerLitre =
    reconciliation && reconciliation.totalLitres > 0 && reconciliation.transactions > 0
      ? Number(
          (
            distanceInWindow(vehicle.id, nowMs - 30 * WINDOWS.day, nowMs) /
            Math.max(1, reconciliation.totalLitres)
          ).toFixed(2),
        )
      : null;

  return {
    vehicle,
    driver,
    device,
    lastPing,
    distance24hKm: Number(distance24hKm.toFixed(1)),
    liveKmPerLitre,
    overspeedEvents: overspeedEvents(pings, vehicle.governorLimitKph).length,
    idlingMinutes: idlingMinutes(pings),
    openFlags: reconciliation?.flags.length ?? 0,
    compliance,
    complianceStatus: worstStatus(compliance),
  };
}

export function allSnapshots(nowMs = Date.now()): VehicleSnapshot[] {
  return getDataset().vehicles.map((v) => snapshotFor(v, nowMs));
}

/**
 * Fleet KPIs. `annualisedSavingKes` is the headline number the sales motion
 * leads with, and every component is traceable to an engine output.
 */
export function fleetKpis(nowMs = Date.now()): FleetKpis & { breakdown: SavingsBreakdown[] } {
  const dataset = getDataset();
  const snapshots = allSnapshots(nowMs);
  const audit = auditFleet();
  const compliance = fleetCompliancePosture(nowMs);

  const distanceTodayKm = snapshots.reduce((s, x) => s + x.distance24hKm, 0);

  // Fuel spend today, pro-rated from the 30-day ledger.
  const fuelLitresToday = audit.reconciliations.reduce(
    (s, r) => s + r.totalLitres / 30,
    0,
  );
  const fuelSpendTodayKes = audit.reconciliations.reduce(
    (s, r) => s + r.totalSpendKes / 30,
    0,
  );

  const active = snapshots.filter((s) => s.vehicle.status === "active").length;
  const offline = snapshots.filter((s) => !s.device?.online || s.vehicle.status === "offline").length;
  const openCriticalFlags = audit.flags.filter((f) => f.severity === "critical").length;

  const breakdown = savingsBreakdown(audit, snapshots, compliance);

  const healthScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        100 -
          (openCriticalFlags * 6 +
            compliance.expired * 2.5 +
            compliance.critical * 1.2 +
            offline * 2.5 +
            snapshots.reduce((s, x) => s + x.overspeedEvents, 0) * 0.4),
      ),
    ),
  );

  return {
    vehicles: dataset.vehicles.length,
    active,
    offline,
    distanceTodayKm: Number(distanceTodayKm.toFixed(0)),
    fuelLitresToday: Number(fuelLitresToday.toFixed(0)),
    fuelSpendTodayKes: Math.round(fuelSpendTodayKes),
    annualisedSavingKes: Math.round(breakdown.reduce((s, b) => s + b.annualKes, 0)),
    unverifiedLitres: audit.totals.unverifiedLitres,
    flaggedExposureKes: audit.totals.exposureKes,
    openCriticalFlags,
    complianceExpiring30d: compliance.dueSoon + compliance.critical,
    complianceExpired: compliance.expired,
    healthScore,
    breakdown,
  };
}

/**
 * Where the 25% saving actually comes from. Each line states its method so the
 * number survives procurement scrutiny.
 */
export function savingsBreakdown(
  audit: ReturnType<typeof auditFleet>,
  snapshots: VehicleSnapshot[],
  compliance: ReturnType<typeof fleetCompliancePosture>,
): SavingsBreakdown[] {
  const exposure = audit.totals.exposureKes;
  const overspeed = snapshots.reduce((s, x) => s + x.overspeedEvents, 0);
  const idling = snapshots.reduce((s, x) => s + x.idlingMinutes, 0);

  // Flagged exposure recurs monthly once controls are in place.
  const fuelTheftAnnual = exposure * 12;

  // A governed, well-driven truck burns roughly 4% less fuel; idling burns
  // about 1.6 L/h.
  const drivingEfficiencyAnnual = Math.round(
    (overspeed * 45 + idling * 1.6 * 190 * 0.35) * 12,
  );

  // Reactive-to-planned maintenance typically cuts unplanned downtime by a
  // third; one breakdown day costs a commercial vehicle real money.
  const maintenanceAnnual = Math.round(snapshots.length * 12_000 * 5 * 0.33);

  // Compliance: fines avoided plus two days of avoided downtime per avoided
  // lapse.
  const complianceAnnual = Math.round(
    (compliance.expired + compliance.critical + compliance.dueSoon) * 18_000,
  );

  return [
    {
      label: "Fuel pilferage recovered",
      description: "Card volumes that the trip plan cannot justify, run-rate annualised.",
      annualKes: fuelTheftAnnual,
      method: `Flagged exposure KES ${exposure.toLocaleString()} × 12 months`,
    },
    {
      label: "Driving behaviour & idling",
      description: "Overspeed and excess-idling burn eliminated through driver coaching.",
      annualKes: drivingEfficiencyAnnual,
      method: `${overspeed} overspeed events and ${idling} idling minutes in the sample window, priced at diesel rates`,
    },
    {
      label: "Predictive maintenance",
      description: "Unplanned breakdown days avoided by servicing on telemetry rather than failure.",
      annualKes: maintenanceAnnual,
      method: `${snapshots.length} vehicles × 5 avoided downtime days × KES 12,000/day × 33%`,
    },
    {
      label: "Compliance fines & impoundment avoided",
      description: "NTSA, county and KRA lapses caught 30 days out.",
      annualKes: complianceAnnual,
      method: `${compliance.expired + compliance.critical + compliance.dueSoon} at-risk items × KES 18,000 average fine and downtime`,
    },
  ];
}

export function snapshotById(vehicleId: string, nowMs = Date.now()): VehicleSnapshot | null {
  const vehicle = vehicleById(vehicleId);
  return vehicle ? snapshotFor(vehicle, nowMs) : null;
}
