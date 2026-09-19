/**
 * VektorFleet — core domain model.
 *
 * These types are the contract shared by the hardware adapters, the cloud
 * engine, the REST API and the dashboard. Keep them free of any framework or
 * storage concern so engines stay pure and unit-testable.
 */

export type VehicleClass = "truck" | "van" | "pickup" | "prime_mover" | "matatu";

export type VehicleStatus = "active" | "idle" | "maintenance" | "offline";

export type FuelType = "diesel" | "petrol";

/** Corridors we model for route-deviation and fuel-forensics logic. */
export type CorridorId =
  | "mombasa_road"
  | "northern_corridor"
  | "nairobi_metro"
  | "thika_superhighway"
  | "kisumu_branch";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Corridor {
  id: CorridorId;
  name: string;
  /** Ordered centreline of the corridor in driving order. */
  waypoints: GeoPoint[];
}

/** A GPS tracker already fitted to the customer's vehicle. */
export type GpsVendorId =
  | "cartrack"
  | "saferide"
  | "teltonika"
  | "ruptela"
  | "generic_tcp";

export interface GpsDevice {
  id: string;
  imei: string;
  vendor: GpsVendorId;
  /** Vendor-side device identifier used when calling their API. */
  vendorDeviceId: string;
  vehicleId: string;
  firmware: string;
  lastSeenAt: string;
  online: boolean;
}

/** A single normalised telemetry sample — vendor payloads are flattened into this. */
export interface TelemetryPing {
  vehicleId: string;
  deviceId: string;
  vendor: GpsVendorId;
  /** UTC ISO timestamp of the *reported* fix. */
  ts: string;
  position: GeoPoint;
  speedKph: number;
  headingDeg: number;
  ignition: boolean;
  /** Cumulative odometer as reported by the device, where available. */
  odometerKm?: number;
  /** Fuel level in litres as reported by the fuel probe, where available. */
  fuelLevelL?: number;
  /** True when the ping was captured offline and synced later. */
  delayedSync?: boolean;
}

export interface Driver {
  id: string;
  name: string;
  /** E.164 MSISDN, e.g. +254712345678. */
  phone: string;
  licenceNo: string;
  licenceExpiry: string;
  assignedVehicleId: string;
  /** Rolling score 0-100, reduced by fraud flags and safety events. */
  score: number;
}

export interface Vehicle {
  id: string;
  plate: string;
  fleetId: string;
  class: VehicleClass;
  make: string;
  model: string;
  year: number;
  fuelType: FuelType;
  /** Usable tank capacity in litres. */
  tankCapacityL: number;
  /** Nominal efficiency used as the fuel-match baseline. */
  kmPerLitre: number;
  odometerKm: number;
  status: VehicleStatus;
  corridor: CorridorId;
  homeDepot: string;
  deviceId: string;
  driverId: string;
  /** Speed governor set point in km/h (NTSA requires 80 for PSV/commercial). */
  governorLimitKph: number;
}

export type FuelCardProvider = "rubis" | "total" | "shell";

export interface FuelCard {
  id: string;
  provider: FuelCardProvider;
  maskedPan: string;
  vehicleId: string;
  driverId: string;
}

export interface FuelTransaction {
  id: string;
  cardId: string;
  vehicleId: string;
  driverId: string;
  ts: string;
  litres: number;
  unitPriceKes: number;
  totalKes: number;
  stationName: string;
  position: GeoPoint;
  /** Odometer captured at the pump, if the attendant/driver logged it. */
  odometerAtPumpKm?: number;
  receiptUrl?: string;
}

export type FlagSeverity = "critical" | "high" | "medium" | "low";

export type FuelFlagCode =
  | "OVERFILL_IMPOSSIBLE"
  | "EXCESS_LITRES"
  | "STATION_MISMATCH"
  | "GHOST_FILL"
  | "COLLUSION_PATTERN"
  | "OFF_HOURS_FILL"
  | "ODOMETER_REGRESSION";

export interface FuelFlag {
  id: string;
  code: FuelFlagCode;
  severity: FlagSeverity;
  vehicleId: string;
  driverId: string;
  transactionId: string;
  headline: string;
  detail: string;
  expectedLitres: number | null;
  actualLitres: number;
  /** Recoverable value if the flag is upheld, in KES. */
  exposureKes: number;
  /** 0-1 model confidence. */
  confidence: number;
  detectedAt: string;
}

export type ComplianceCategory =
  | "NTSA_INSPECTION"
  | "SPEED_GOVERNOR"
  | "INSURANCE"
  | "TRANSIT_LICENCE"
  | "COUNTY_PERMIT"
  | "KRA_TAX"
  | "EMISSION";

export type ComplianceStatus = "ok" | "due_soon" | "critical" | "expired";

export interface ComplianceItem {
  id: string;
  vehicleId: string;
  category: ComplianceCategory;
  title: string;
  authority: string;
  dueDate: string;
  lastCompletedAt?: string;
  /** Lead time in days for the first reminder. */
  leadDays: number;
  notes?: string;
}

export interface ComplianceEvaluation extends ComplianceItem {
  status: ComplianceStatus;
  daysRemaining: number;
  /** Cost of doing nothing — statutory fine plus downtime estimate, KES. */
  penaltyExposureKes: number;
}

export type AlertChannel = "whatsapp" | "sms" | "email";

export interface ComplianceAlert {
  id: string;
  itemId: string;
  vehicleId: string;
  dueDate: string;
  daysRemaining: number;
  channel: AlertChannel;
  /** Reminder tier: T-30, T-7, overdue, expired. */
  tier: "T-30" | "T-7" | "T-1" | "OVERDUE";
  message: string;
}

export interface Fleet {
  id: string;
  name: string;
  sector: string;
  /** Tier 1 / 2 / 3 per the go-to-market segmentation. */
  tier: 1 | 2 | 3;
  hq: string;
  contractPlan: "standard" | "premium" | "enterprise";
  seatsBilled: number;
}

// ---------------------------------------------------------------------------
// WhatsApp-native driver assistant
// ---------------------------------------------------------------------------

export type WhatsAppStep =
  | "IDLE"
  | "PRE_TRIP"
  | "ODOMETER"
  | "FUEL_RECEIPT"
  | "INCIDENT"
  | "DONE";

export interface WhatsAppSession {
  /** Driver MSISDN. */
  phone: string;
  driverId: string;
  step: WhatsAppStep;
  /** Index into the pre-trip checklist. */
  checklistIndex: number;
  answers: Record<string, string>;
  updatedAt: string;
}

export interface WhatsAppMessage {
  id: string;
  phone: string;
  direction: "inbound" | "outbound";
  body: string;
  ts: string;
  /** Payload-free media reference for receipts. */
  mediaUrl?: string;
}

export interface TripReport {
  id: string;
  driverId: string;
  vehicleId: string;
  submittedAt: string;
  checklist: Record<string, "pass" | "fail">;
  odometerKm?: number;
  receiptMediaUrl?: string;
}

/**
 * Offline-first sync envelope. Field units in dead zones stamp the device
 * clock locally and hand the envelope to the cloud when a signal returns.
 */
export interface OfflineEnvelope<T> {
  id: string;
  kind: "telemetry" | "trip_report" | "fuel_receipt";
  /** ISO timestamp captured on the *device*, not at sync time. */
  capturedAt: string;
  enqueuedAt: string;
  deviceId: string;
  payload: T;
  synced: boolean;
}

/**
 * A completed movement between two points on a corridor. The trip index is the
 * backbone of fuel forensics: it tells the engine how far a vehicle actually
 * drove between two fills, and where it was at any point in time.
 */
export interface Trip {
  id: string;
  vehicleId: string;
  driverId: string;
  startTs: string;
  endTs: string;
  distanceKm: number;
  corridor: CorridorId;
  startFraction: number;
  endFraction: number;
  avgSpeedKph: number;
  maxSpeedKph: number;
  overspeedSeconds: number;
  idlingMinutes: number;
  /** Distance driven off the modelled corridor centreline (km). */
  offCorridorDetourKm: number;
}

// ---------------------------------------------------------------------------
// Derived analytics surfaces consumed by the dashboard
// ---------------------------------------------------------------------------

export interface VehicleSnapshot {
  vehicle: Vehicle;
  driver: Driver | null;
  device: GpsDevice | null;
  lastPing: TelemetryPing | null;
  /** Distance driven in the last 24h, GPS-derived. */
  distance24hKm: number;
  /** Efficiency over the last 24h, km/L. */
  liveKmPerLitre: number | null;
  overspeedEvents: number;
  idlingMinutes: number;
  openFlags: number;
  compliance: ComplianceEvaluation[];
  /** Worst compliance status across all items. */
  complianceStatus: ComplianceStatus;
}

export interface FleetKpis {
  vehicles: number;
  active: number;
  offline: number;
  distanceTodayKm: number;
  fuelLitresToday: number;
  fuelSpendTodayKes: number;
  /** Estimated annualised savings delivered by the fuel-match + maintenance engines. */
  annualisedSavingKes: number;
  unverifiedLitres: number;
  flaggedExposureKes: number;
  openCriticalFlags: number;
  complianceExpiring30d: number;
  complianceExpired: number;
  /** 0-100 composite operational health. */
  healthScore: number;
}

export interface SavingsBreakdown {
  label: string;
  description: string;
  annualKes: number;
  method: string;
}
