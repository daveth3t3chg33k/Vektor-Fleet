import { CORRIDORS_BY_ID, DEPOTS, FUEL_STATIONS, INDEPENDENT_STATION } from "@/lib/domain/corridors";
import { haversineKm, offsetPoint, pointAlongCorridor } from "@/lib/domain/geo";
import { Rng } from "@/lib/domain/random";
import type {
  ComplianceCategory,
  ComplianceItem,
  CorridorId,
  Driver,
  Fleet,
  FuelCard,
  FuelTransaction,
  GeoPoint,
  GpsDevice,
  GpsVendorId,
  TelemetryPing,
  Trip,
  Vehicle,
  VehicleClass,
  VehicleStatus,
} from "@/lib/domain/types";

/**
 * Anomaly profiles are baked into the generator so the fuel-match engine has
 * something real to find. Every other fill is physically coherent.
 */
export type FraudProfile =
  | "clean"
  | "siphon"
  | "overfill"
  | "phantom_station"
  | "ghost"
  | "collusion";

interface VehicleSpec {
  plate: string;
  fleetIndex: 0 | 1 | 2;
  klass: VehicleClass;
  make: string;
  model: string;
  year: number;
  tankCapacityL: number;
  kmPerLitre: number;
  corridor: CorridorId;
  depotIndex: number;
  profile: FraudProfile;
  /** Nominal daily distance in km. */
  dailyKm: number;
  tripsPerDay: number;
}

const VENDORS: GpsVendorId[] = ["cartrack", "saferide", "teltonika", "ruptela", "generic_tcp"];

const DRIVER_NAMES = [
  "Peter Mwangi", "Joseph Otieno", "Hassan Abdi", "Samuel Kipchoge", "Grace Wanjiru",
  "Daniel Mutiso", "Brian Ochieng", "Ali Mohamed", "Faith Njeri", "Kevin Barasa",
  "Mary Achieng", "Stephen Kamau", "Ibrahim Yusuf", "Dennis Wekesa", "Lucy Chebet",
];

const VEHICLE_SPECS: VehicleSpec[] = [
  // Fleet 1 — Safari Logistics Ltd (Tier 1, Mombasa Road)
  { plate: "KDA 412M", fleetIndex: 0, klass: "truck", make: "Isuzu", model: "FRR 90", year: 2021, tankCapacityL: 200, kmPerLitre: 4.2, corridor: "mombasa_road", depotIndex: 0, profile: "clean", dailyKm: 380, tripsPerDay: 1 },
  { plate: "KDB 908T", fleetIndex: 0, klass: "prime_mover", make: "Mitsubishi", model: "Fuso FV26", year: 2019, tankCapacityL: 400, kmPerLitre: 2.6, corridor: "mombasa_road", depotIndex: 1, profile: "clean", dailyKm: 640, tripsPerDay: 1 },
  { plate: "KDC 233J", fleetIndex: 0, klass: "prime_mover", make: "Scania", model: "G410", year: 2020, tankCapacityL: 500, kmPerLitre: 2.4, corridor: "northern_corridor", depotIndex: 1, profile: "siphon", dailyKm: 520, tripsPerDay: 1 },
  { plate: "KDD 771V", fleetIndex: 0, klass: "truck", make: "Isuzu", model: "NQR", year: 2022, tankCapacityL: 140, kmPerLitre: 5.0, corridor: "mombasa_road", depotIndex: 0, profile: "overfill", dailyKm: 300, tripsPerDay: 2 },
  { plate: "KDE 155L", fleetIndex: 0, klass: "van", make: "Nissan", model: "NV350", year: 2023, tankCapacityL: 80, kmPerLitre: 9.5, corridor: "nairobi_metro", depotIndex: 0, profile: "clean", dailyKm: 180, tripsPerDay: 4 },
  { plate: "KDF 604R", fleetIndex: 0, klass: "truck", make: "Hino", model: "300 Series", year: 2020, tankCapacityL: 120, kmPerLitre: 6.2, corridor: "mombasa_road", depotIndex: 4, profile: "phantom_station", dailyKm: 260, tripsPerDay: 2 },

  // Fleet 2 — Rift Valley FMCG Distributors (Tier 2, Nakuru)
  { plate: "KCA 318P", fleetIndex: 1, klass: "truck", make: "Isuzu", model: "FSR", year: 2021, tankCapacityL: 150, kmPerLitre: 5.2, corridor: "northern_corridor", depotIndex: 2, profile: "clean", dailyKm: 240, tripsPerDay: 2 },
  { plate: "KCB 712K", fleetIndex: 1, klass: "truck", make: "Mitsubishi", model: "Canter", year: 2018, tankCapacityL: 100, kmPerLitre: 7.0, corridor: "kisumu_branch", depotIndex: 2, profile: "ghost", dailyKm: 210, tripsPerDay: 1 },
  { plate: "KCC 449G", fleetIndex: 1, klass: "pickup", make: "Toyota", model: "Hilux", year: 2023, tankCapacityL: 80, kmPerLitre: 11.0, corridor: "northern_corridor", depotIndex: 2, profile: "clean", dailyKm: 190, tripsPerDay: 3 },
  { plate: "KCD 826B", fleetIndex: 1, klass: "truck", make: "Isuzu", model: "FRR 90", year: 2019, tankCapacityL: 200, kmPerLitre: 4.4, corridor: "northern_corridor", depotIndex: 3, profile: "collusion", dailyKm: 340, tripsPerDay: 1 },

  // Fleet 3 — Nairobi Last-Mile Couriers (Tier 2, standard plan)
  { plate: "KCX 100A", fleetIndex: 2, klass: "van", make: "Nissan", model: "NV350", year: 2023, tankCapacityL: 70, kmPerLitre: 10.5, corridor: "nairobi_metro", depotIndex: 0, profile: "clean", dailyKm: 160, tripsPerDay: 5 },
  { plate: "KCY 205C", fleetIndex: 2, klass: "van", make: "Toyota", model: "Hiace", year: 2022, tankCapacityL: 65, kmPerLitre: 9.0, corridor: "nairobi_metro", depotIndex: 0, profile: "clean", dailyKm: 140, tripsPerDay: 5 },
  { plate: "KCZ 330D", fleetIndex: 2, klass: "van", make: "Isuzu", model: "NLR", year: 2024, tankCapacityL: 75, kmPerLitre: 9.8, corridor: "thika_superhighway", depotIndex: 0, profile: "clean", dailyKm: 130, tripsPerDay: 3 },
  { plate: "KDZ 901E", fleetIndex: 2, klass: "truck", make: "Tata", model: "Ultra 1518", year: 2021, tankCapacityL: 110, kmPerLitre: 6.8, corridor: "thika_superhighway", depotIndex: 0, profile: "clean", dailyKm: 150, tripsPerDay: 2 },
];

const FLEET_SPECS: Array<Omit<Fleet, "seatsBilled">> = [
  { id: "flt_safari", name: "Safari Logistics Ltd", sector: "Container haulage & long-haul freight", tier: 1, hq: "Mombasa Road, Nairobi", contractPlan: "enterprise" },
  { id: "flt_riftvalley", name: "Rift Valley FMCG Distributors", sector: "FMCG distribution & agricultural transit", tier: 2, hq: "Nakuru ICD", contractPlan: "premium" },
  { id: "flt_lastmile", name: "Nairobi Last-Mile Couriers", sector: "E-commerce courier & urban distribution", tier: 2, hq: "Industrial Area, Nairobi", contractPlan: "standard" },
];

const COMPLIANCE_TEMPLATES: Array<{
  category: ComplianceCategory;
  title: string;
  authority: string;
  /**
   * Days between the last renewal and the next statutory deadline, before the
   * per-vehicle variation below is applied. This is what makes obligations fall
   * at different points on the calendar instead of all on the same day.
   */
  nominalDaysUntilDue: number;
  intervalDays: number;
}> = [
  { category: "NTSA_INSPECTION", title: "NTSA annual roadworthiness inspection", authority: "NTSA", nominalDaysUntilDue: 65, intervalDays: 365 },
  { category: "SPEED_GOVERNOR", title: "Speed governor recalibration", authority: "NTSA-approved centre", nominalDaysUntilDue: 45, intervalDays: 365 },
  { category: "INSURANCE", title: "Commercial vehicle insurance renewal", authority: "IRA-licensed insurer", nominalDaysUntilDue: 25, intervalDays: 365 },
  { category: "TRANSIT_LICENCE", title: "Transit goods vehicle licence", authority: "NTSA", nominalDaysUntilDue: 35, intervalDays: 365 },
  { category: "COUNTY_PERMIT", title: "County single business permit", authority: "County Government", nominalDaysUntilDue: 15, intervalDays: 365 },
  { category: "KRA_TAX", title: "KRA commercial vehicle tax filing", authority: "KRA", nominalDaysUntilDue: 65, intervalDays: 365 },
  { category: "EMISSION", title: "Emissions compliance certificate", authority: "NEMA licensed centre", nominalDaysUntilDue: 55, intervalDays: 365 },
];

export interface Dataset {
  generatedAt: string;
  fleets: Fleet[];
  vehicles: Vehicle[];
  drivers: Driver[];
  devices: GpsDevice[];
  trips: Trip[];
  telemetry: TelemetryPing[];
  fuelCards: FuelCard[];
  fuelTransactions: FuelTransaction[];
  complianceItems: ComplianceItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** East Africa Time is UTC+3 year round, with no daylight saving. */
const EAT_OFFSET_MS = 3 * HOUR_MS;

const iso = (ms: number) => new Date(ms).toISOString();
/** Serialises an EAT wall-clock epoch as a true UTC ISO string. */
const isoEat = (msEat: number) => new Date(msEat - EAT_OFFSET_MS).toISOString();
const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/** Fills the tank only when it drops below this fraction of capacity. */
const REFILL_THRESHOLD = 0.28;
/** Target level after a normal fill. */
const FILL_TARGET = 0.94;

interface FuelState {
  level: number;
  odometer: number;
  lastFillTs: number | null;
  lastFillOdometer: number | null;
  lastFillLevel: number | null;
}

/**
 * Builds a complete, internally-consistent dataset.
 *
 * The generator is the single source of truth for physics: trips drive both the
 * telemetry timeline and the fuel burn, so the fuel-match engine reconciles
 * against data that actually adds up — except where an anomaly profile
 * deliberately breaks it.
 */
export function buildDataset(now: Date = new Date()): Dataset {
  // The generator reasons in East Africa Time — the actual working day of a
  // Kenyan fleet — and serialises to true UTC. Keeping those clocks distinct is
  // what makes the engine's local-time rules (off-hours fuelling especially)
  // agree with the data instead of drifting three hours out.
  const nowTrue = now.getTime();
  const nowMs = nowTrue + EAT_OFFSET_MS;
  const rng = new Rng(20260919);
  const historyDays = 30;

  const fleets: Fleet[] = FLEET_SPECS.map((f, i) => ({
    ...f,
    seatsBilled: VEHICLE_SPECS.filter((v) => v.fleetIndex === i).length,
  }));

  const vehicles: Vehicle[] = [];
  const drivers: Driver[] = [];
  const devices: GpsDevice[] = [];
  const trips: Trip[] = [];
  const fuelCards: FuelCard[] = [];
  const fuelTransactions: FuelTransaction[] = [];
  const complianceItems: ComplianceItem[] = [];

  VEHICLE_SPECS.forEach((spec, idx) => {
    const vehicleId = `veh_${String(idx + 1).padStart(3, "0")}`;
    const driverId = `drv_${String(idx + 1).padStart(3, "0")}`;
    const deviceId = `dev_${String(idx + 1).padStart(3, "0")}`;
    const fleet = fleets[spec.fleetIndex]!;
    const corridor = CORRIDORS_BY_ID[spec.corridor]!;

    // ---- Plan the 30-day movement history -------------------------------
    const plannedTrips = planTrips({ rng, spec, vehicleId, driverId, nowMs, historyDays });
    trips.push(...plannedTrips);

    // ---- Reconcile fuel burn with the trip plan -------------------------
    const state: FuelState = {
      level: spec.tankCapacityL * rng.float(0.15, 0.3),
      odometer: spec.dailyKm * historyDays * rng.float(1.9, 2.6) * 30 / 30 + spec.dailyKm * 120,
      lastFillTs: null,
      lastFillOdometer: null,
      lastFillLevel: null,
    };
    state.odometer = round(state.odometer, 0);

    const card: FuelCard = {
      id: `card_${String(idx + 1).padStart(3, "0")}`,
      provider: rng.pick(["rubis", "total", "shell"] as const),
      maskedPan: `**** **** **** ${rng.int(1000, 9999)}`,
      vehicleId,
      driverId,
    };
    fuelCards.push(card);

    generateFuelHistory({
      rng,
      spec,
      vehicleId,
      driverId,
      cardId: card.id,
      corridor,
      trips: plannedTrips,
      state,
      nowMs,
      historyDays,
      out: fuelTransactions,
    });

    const driver: Driver = {
      id: driverId,
      name: DRIVER_NAMES[idx % DRIVER_NAMES.length]!,
      phone: `+2547${rng.int(10, 99)}${rng.int(100000, 999999)}`,
      licenceNo: `DL-${rng.int(100000, 999999)}`,
      licenceExpiry: iso(nowTrue + rng.int(-20, 400) * DAY_MS),
      assignedVehicleId: vehicleId,
      score: spec.profile === "clean" ? rng.int(78, 98) : rng.int(41, 68),
    };
    drivers.push(driver);

    const vendor = VENDORS[idx % VENDORS.length]!;
    devices.push({
      id: deviceId,
      imei: `86${rng.int(1000000000000, 9999999999999)}`,
      vendor,
      vendorDeviceId: `${vendor.toUpperCase()}-${rng.int(100000, 999999)}`,
      vehicleId,
      firmware: `${rng.int(2, 7)}.${rng.int(0, 9)}.${rng.int(0, 9)}`,
      lastSeenAt: iso(nowTrue - rng.int(0, 4) * 60 * 1000),
      online: rng.bool(0.88),
    });

    const status: VehicleStatus =
      spec.profile === "ghost" ? "maintenance" : rng.bool(0.8) ? "active" : "idle";

    vehicles.push({
      id: vehicleId,
      plate: spec.plate,
      fleetId: fleet.id,
      class: spec.klass,
      make: spec.make,
      model: spec.model,
      year: spec.year,
      fuelType: "diesel",
      tankCapacityL: spec.tankCapacityL,
      kmPerLitre: spec.kmPerLitre,
      odometerKm: round(state.odometer, 0),
      status,
      corridor: spec.corridor,
      homeDepot: DEPOTS[spec.depotIndex]!,
      deviceId,
      driverId,
      governorLimitKph: 80,
    });

    // ---- Compliance calendar -------------------------------------------
    COMPLIANCE_TEMPLATES.forEach((tpl, tIdx) => {
      // Per-vehicle variation around the nominal renewal age, so the fleet shows
      // a realistic mix of expired, critical, due-soon and healthy obligations
      // across every category — including the driver-facing NTSA items.
      const variation = rng.weighted<number>([
        [rng.int(-70, -35), 0.12],
        [rng.int(-30, 0), 0.32],
        [rng.int(1, 90), 0.34],
        [rng.int(91, 300), 0.22],
      ]);
      const daysUntilDue = tpl.nominalDaysUntilDue + variation;
      const dueMs = nowTrue + daysUntilDue * DAY_MS;
      complianceItems.push({
        id: `cmp_${vehicleId.slice(4)}_${tIdx}`,
        vehicleId,
        category: tpl.category,
        title: tpl.title,
        authority: tpl.authority,
        dueDate: iso(dueMs),
        lastCompletedAt: iso(dueMs - tpl.intervalDays * DAY_MS),
        leadDays: 30,
        notes:
          tpl.category === "SPEED_GOVERNOR"
            ? `Governor must be set to ${80} km/h and re-sealed.`
            : undefined,
      });
    });
  });

  // ---- Live telemetry for the last 48 hours -----------------------------
  const telemetry = buildTelemetry({ rng, vehicles, trips, nowMs, hours: 48 });

  return {
    generatedAt: iso(nowTrue),
    fleets,
    vehicles,
    drivers,
    devices,
    trips: trips.sort((a, b) => a.startTs.localeCompare(b.startTs)),
    telemetry,
    fuelCards,
    fuelTransactions: fuelTransactions.sort((a, b) => a.ts.localeCompare(b.ts)),
    complianceItems,
  };
}

// ---------------------------------------------------------------------------
// Movement planning
// ---------------------------------------------------------------------------

interface PlanArgs {
  rng: Rng;
  spec: VehicleSpec;
  vehicleId: string;
  driverId: string;
  nowMs: number;
  historyDays: number;
}

function planTrips({ rng, spec, vehicleId, driverId, nowMs, historyDays }: PlanArgs): Trip[] {
  const corridor = CORRIDORS_BY_ID[spec.corridor]!;
  const trips: Trip[] = [];
  const startDay = Math.floor((nowMs - historyDays * DAY_MS) / DAY_MS);
  const today = Math.floor(nowMs / DAY_MS);
  let tripNo = 0;
  // Where the vehicle sits along its corridor, and which way it is heading.
  let fraction = rng.float(0.05, 0.4);
  let direction = 1;

  for (let day = startDay; day <= today; day++) {
    const dayStart = day * DAY_MS;
    const weekday = new Date(dayStart).getUTCDay();
    // Sunday is mostly a rest day for long-haul, lighter for urban fleets.
    const isSunday = weekday === 0;
    const load = isSunday ? 0.15 : weekday === 6 ? 0.6 : 1;
    // Workshop days leave the vehicle parked, which is what makes a fuel
    // transaction on one of those days forensically interesting.
    const tripCount = downtimeDay(spec, day)
      ? 0
      : Math.max(0, Math.round(spec.tripsPerDay * load * rng.float(0.85, 1.15)));
    let cursor = dayStart + (5 + rng.float(0, 1.5)) * HOUR_MS;

    for (let t = 0; t < tripCount; t++) {
      const distanceKm = round((spec.dailyKm / spec.tripsPerDay) * rng.float(0.82, 1.2), 1);
      const avgSpeedKph = spec.klass === "prime_mover" || spec.klass === "truck"
        ? rng.float(spec.corridor === "nairobi_metro" ? 26 : 48, spec.corridor === "nairobi_metro" ? 38 : 68)
        : rng.float(24, 46);
      const durationH = distanceKm / avgSpeedKph;
      const startTs = cursor;
      const endTs = startTs + durationH * HOUR_MS;
      if (endTs > nowMs) break;

      // Continuous movement: every leg starts exactly where the previous one
      // ended and bounces between the corridor's ends. Keeping the position
      // timeline physically coherent is what lets the fuel engine trust it — a
      // fill logged near a leg's start lands where the vehicle actually was.
      const span = Math.min(
        0.9,
        Math.max(0.02, distanceKm / Math.max(40, corridorLengthKm(corridor.id))),
      );
      let endFraction = fraction + direction * span;
      if (endFraction > 1) {
        direction = -1;
        endFraction = fraction + direction * span;
      } else if (endFraction < 0) {
        direction = 1;
        endFraction = fraction + direction * span;
      }
      const startFrac = fraction;
      const endFrac = Math.max(0, Math.min(1, endFraction));
      fraction = endFrac;

      const maxSpeedKph = avgSpeedKph * rng.float(1.05, spec.profile === "clean" ? 1.22 : 1.45);
      const overspeedRatio = Math.max(0, (maxSpeedKph - 80) / Math.max(1, maxSpeedKph));
      const overspeedSeconds = Math.round(overspeedRatio * durationH * 3600 * rng.float(0.2, 0.6));
      const idlingMinutes = Math.round(
        spec.corridor === "nairobi_metro" ? rng.float(6, 26) : rng.float(2, 14),
      );

      trips.push({
        id: `trp_${vehicleId.slice(4)}_${String(++tripNo).padStart(4, "0")}`,
        vehicleId,
        driverId,
        startTs: isoEat(startTs),
        endTs: isoEat(endTs),
        distanceKm,
        corridor: spec.corridor,
        startFraction: round(startFrac, 4),
        endFraction: round(endFrac, 4),
        avgSpeedKph: round(avgSpeedKph, 1),
        maxSpeedKph: round(maxSpeedKph, 1),
        overspeedSeconds,
        idlingMinutes,
        offCorridorDetourKm: spec.profile === "collusion" ? round(rng.float(4, 22), 1) : round(rng.float(0, 3), 1),
      });

      cursor = endTs + rng.float(0.6, 3) * HOUR_MS;
    }
  }

  return trips;
}

/** EAT midnight at the start of the day following an EAT epoch. */
function startOfNextEatDay(msEat: number): number {
  return (Math.floor(msEat / DAY_MS) + 1) * DAY_MS;
}

/**
 * Scheduled workshop days. Shared by the trip planner and the fuel generator so
 * both agree on which days a vehicle genuinely did not move.
 */
export function downtimeDay(spec: VehicleSpec, dayIndex: number): boolean {
  if (spec.profile === "ghost") return dayIndex % 7 === 2 || dayIndex % 7 === 5;
  return false;
}

function corridorLengthKm(id: CorridorId): number {
  const c = CORRIDORS_BY_ID[id]!;
  let total = 0;
  for (let i = 0; i < c.waypoints.length - 1; i++) {
    total += haversineKm(c.waypoints[i]!, c.waypoints[i + 1]!);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Fuel history
// ---------------------------------------------------------------------------

interface FuelGenArgs {
  rng: Rng;
  spec: VehicleSpec;
  vehicleId: string;
  driverId: string;
  cardId: string;
  corridor: (typeof CORRIDORS_BY_ID)[string];
  trips: Trip[];
  state: FuelState;
  nowMs: number;
  historyDays: number;
  out: FuelTransaction[];
}

function generateFuelHistory(args: FuelGenArgs): void {
  const { rng, spec, vehicleId, driverId, cardId, corridor, trips, state, out } = args;

  const ordered = [...trips].sort((a, b) => a.startTs.localeCompare(b.startTs));
  let txNo = 0;
  // Timestamps must stay strictly ordered across the ledger: two fills with no
  // driving between them would look exactly like theft to the engine.
  let lastEventTs = 0;

  for (let i = 0; i < ordered.length; i++) {
    const trip = ordered[i]!;
    const nextTripStart =
      i + 1 < ordered.length ? Date.parse(ordered[i + 1]!.startTs) + EAT_OFFSET_MS : args.nowMs;
    // Consume fuel for the leg. Burn is modelled at the vehicle's nominal
    // efficiency exactly, so the engine's independent reconstruction starts from
    // an identical baseline and never accumulates drift.
    const burn = trip.distanceKm / spec.kmPerLitre;
    state.level = Math.max(0.5, state.level - burn);
    state.odometer += trip.distanceKm;

    const levelFraction = state.level / spec.tankCapacityL;
    // The collusion profile tops up high and often, which is itself part of its
    // signature; ghost fills are injected separately on workshop days.
    const needsFuel =
      levelFraction <= REFILL_THRESHOLD ||
      (spec.profile === "collusion" && levelFraction <= 0.72);

    if (!needsFuel) continue;

    // Trip stamps are stored in UTC; convert back to the EAT working clock.
    const tripEnd = Date.parse(trip.endTs) + EAT_OFFSET_MS;
    // A fill is always booked *after* the journey that consumed the fuel, so the
    // ledger and the odometer tell the same story. Honest fleets fuel on arrival
    // a little after the leg; the collusion profile instead tops up in the small
    // hours before the next departure.
    const floor = Math.max(lastEventTs + 10 * 60_000, tripEnd + 20 * 60_000);
    const windowFrom =
      spec.profile === "collusion"
        ? Math.max(floor, startOfNextEatDay(tripEnd) + HOUR_MS)
        : floor;
    const windowTo =
      spec.profile === "collusion"
        ? Math.max(windowFrom, startOfNextEatDay(tripEnd) + 4 * HOUR_MS)
        : Math.max(floor, Math.min(nextTripStart - 30 * 60_000, tripEnd + 2 * HOUR_MS));
    const ts = rng.float(windowFrom, windowTo);
    if (ts + 60_000 > args.nowMs) continue;

    const positionAtFill = positionAtFraction(
      trip,
      spec.profile === "collusion" ? trip.startFraction : trip.endFraction,
      corridor,
    );
    const headroom = spec.tankCapacityL - state.level;
    const target = spec.tankCapacityL * FILL_TARGET - state.level;

    let litres = Math.max(0, target);
    // How much of the charged volume actually reaches the tank. The gap between
    // `litres` and `absorbed` is the physical fuel loss, and it is what the
    // engine's mass balance later re-discovers without being told.
    let absorbed = litres;
    let odometerAtPump: number | undefined = Math.round(state.odometer);
    let station = nearestStation(positionAtFill, rng);

    switch (spec.profile) {
      case "siphon": {
        // Direct pilferage on some fills: charged for a full top-up, but only a
        // fraction reaches the tank, so the vehicle keeps needing fuel far more
        // often than its duty cycle can justify.
        if (rng.bool(0.45)) {
          litres = Math.max(litres, headroom * rng.float(0.85, 1.0));
          absorbed = litres * rng.float(0.35, 0.6);
        }
        break;
      }
      case "overfill": {
        // Billed volume above the tank's physical capacity — the classic
        // "attendant-entered volume" card fraud, and the one case that needs no
        // reconstruction at all to prove.
        if (rng.bool(0.5)) {
          litres = spec.tankCapacityL * rng.float(1.05, 1.22);
          absorbed = headroom;
        }
        break;
      }
      case "phantom_station": {
        // Transaction logged at a station the truck was nowhere near.
        const far = FUEL_STATIONS.filter((s) => haversineKm(s.position, positionAtFill) > 150);
        if (far.length > 0 && rng.bool(0.6)) station = rng.pick(far);
        break;
      }
      case "collusion": {
        // Attendant padding of roughly a fifth at a single independent stop.
        // Individually each fill passes every per-transaction check; only the
        // cadence and concentration give it away.
        station = INDEPENDENT_STATION;
        litres = headroom * rng.float(1.08, 1.32);
        absorbed = headroom;
        break;
      }
      case "ghost":
      default:
        break;
    }

    if (litres < 8) continue;

    const unitPriceKes = round(rng.float(178, 196), 2);
    out.push({
      id: `ftx_${vehicleId.slice(4)}_${String(++txNo).padStart(4, "0")}`,
      cardId,
      vehicleId,
      driverId,
      ts: isoEat(ts),
      litres: round(litres, 2),
      unitPriceKes,
      totalKes: round(litres * unitPriceKes, 2),
      stationName: station.name,
      position: station.position,
      odometerAtPumpKm: odometerAtPump,
      receiptUrl: rng.bool(0.7) ? `/receipts/${vehicleId}/${String(txNo).padStart(4, "0")}.jpg` : undefined,
    });

    // Apply the physical effect. Only the absorbed volume enters the tank; any
    // overfill beyond capacity simply cannot land anywhere.
    state.level = Math.min(spec.tankCapacityL, state.level + absorbed);
    state.lastFillTs = ts;
    lastEventTs = ts;
    state.lastFillOdometer = odometerAtPump ?? null;
    state.lastFillLevel = state.level;
  }

  // Ghost profile: fills charged on scheduled workshop days, when the vehicle
  // provably never moved.
  if (spec.profile === "ghost") {
    const currentDay = Math.floor(args.nowMs / DAY_MS);
    for (let back = 1; back <= 24; back++) {
      const day = currentDay - back;
      if (!downtimeDay(spec, day)) continue;
      const ts = day * DAY_MS + 14 * HOUR_MS + rng.int(0, 90) * 60_000;
      if (ts > args.nowMs) continue;
      const station = rng.pick(FUEL_STATIONS);
      const litres = round(spec.tankCapacityL * rng.float(0.7, 0.92), 2);
      const unitPriceKes = round(rng.float(178, 196), 2);
      out.push({
        id: `ftx_${vehicleId.slice(4)}_g${back}`,
        cardId,
        vehicleId,
        driverId,
        ts: isoEat(ts),
        litres,
        unitPriceKes,
        totalKes: round(litres * unitPriceKes, 2),
        stationName: station.name,
        position: station.position,
        odometerAtPumpKm: undefined,
        receiptUrl: undefined,
      });
      // The tank is unaffected: this fuel never entered the vehicle.
    }
  }
}

function positionAtFraction(trip: Trip, f: number, corridor: (typeof CORRIDORS_BY_ID)[string]): GeoPoint {
  return pointAlongCorridor(corridor, Math.max(0, Math.min(1, f)));
}

function nearestStation(p: GeoPoint, rng: Rng) {
  const scored = FUEL_STATIONS.map((s) => ({ s, d: haversineKm(s.position, p) })).sort(
    (a, b) => a.d - b.d,
  );
  // Mostly the closest station, occasionally the second closest.
  return (rng.bool(0.75) ? scored[0] : scored[1] ?? scored[0])!.s;
}

// ---------------------------------------------------------------------------
// Live telemetry
// ---------------------------------------------------------------------------

interface TelemetryArgs {
  rng: Rng;
  vehicles: Vehicle[];
  trips: Trip[];
  nowMs: number;
  hours: number;
}

function buildTelemetry({ rng, vehicles, trips, nowMs, hours }: TelemetryArgs): TelemetryPing[] {
  const pings: TelemetryPing[] = [];
  const from = nowMs - hours * HOUR_MS;

  for (const vehicle of vehicles) {
    const vehicleTrips = trips
      .filter((t) => t.vehicleId === vehicle.id)
      .sort((a, b) => a.startTs.localeCompare(b.startTs));
    const corridor = CORRIDORS_BY_ID[vehicle.corridor]!;
    const depot = depotPoint(vehicle);
    const device = `dev_${vehicle.id.slice(4)}`;

    // 15-minute cadence inside trips, hourly when parked.
    for (let t = from; t <= nowMs; t += 15 * 60 * 1000) {
      const active = vehicleTrips.find((trip) => {
        const s = new Date(trip.startTs).getTime();
        const e = new Date(trip.endTs).getTime();
        return t >= s && t <= e;
      });

      let position: GeoPoint;
      let speedKph: number;
      let ignition: boolean;
      let headingDeg: number;

      if (active) {
        const s = new Date(active.startTs).getTime();
        const e = new Date(active.endTs).getTime();
        const progress = (t - s) / Math.max(1, e - s);
        const frac = active.startFraction + (active.endFraction - active.startFraction) * progress;
        const base = pointAlongCorridor(corridor, Math.max(0, Math.min(1, frac)));
        // Wander off-centre slightly to look like real road noise.
        position = offsetPoint(base, rng.float(0, 1.4), rng.float(0, 360));
        speedKph = Math.max(0, active.avgSpeedKph * rng.float(0.5, 1.3));
        ignition = true;
        headingDeg = rng.float(0, 360);
      } else {
        if (t % HOUR_MS > 60 * 1000) continue; // hourly only when parked
        position = offsetPoint(depot, rng.float(0, 0.25), rng.float(0, 360));
        speedKph = 0;
        ignition = rng.bool(0.12);
        headingDeg = rng.float(0, 360);
      }

      const fractionDriven = fractionOfHistory(t, from, nowMs);
      pings.push({
        vehicleId: vehicle.id,
        deviceId: device,
        vendor: "cartrack",
        ts: isoEat(t),
        position: {
          lat: round(position.lat, 5),
          lng: round(position.lng, 5),
        },
        speedKph: round(speedKph, 1),
        headingDeg: round(headingDeg, 0),
        ignition,
        // Parked fixes carry a device odometer and a fuel-probe reading, the way
        // a real tracker reports while stationary.
        odometerKm: active ? undefined : Math.round(vehicle.odometerKm - (1 - fractionDriven) * 5),
        fuelLevelL: active ? undefined : round(vehicle.tankCapacityL * rng.float(0.3, 0.8), 1),
      });
    }
  }

  return pings.sort((a, b) => a.ts.localeCompare(b.ts));
}

function fractionOfHistory(t: number, from: number, to: number): number {
  return (t - from) / Math.max(1, to - from);
}

function depotPoint(vehicle: Vehicle): GeoPoint {
  const anchor: Record<string, GeoPoint> = {
    "Nairobi Industrial Area": { lat: -1.308, lng: 36.854 },
    "Mombasa Changamwe": { lat: -4.0237, lng: 39.6293 },
    "Nakuru ICD": { lat: -0.3031, lng: 36.08 },
    "Eldoret Depot": { lat: 0.5143, lng: 35.2698 },
    "Athi River Yard": { lat: -1.4565, lng: 36.9784 },
  };
  return anchor[vehicle.homeDepot] ?? { lat: -1.308, lng: 36.854 };
}
