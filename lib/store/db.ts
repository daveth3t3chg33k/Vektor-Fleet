import { buildDataset, type Dataset } from "@/lib/domain/seed";

/**
 * In-process data store.
 *
 * The demo ships with a deterministic seeded dataset held in memory so the app
 * runs with zero external services. Every read goes through `getDataset()`, and
 * writes go through `mutateDataset()`, so swapping this for Postgres/SQLite is a
 * single-module change — nothing downstream imports the seed generator.
 */

interface StoreGlobal {
  __vektorFleetDataset?: Dataset;
}

const globalRef = globalThis as unknown as StoreGlobal;

export function getDataset(): Dataset {
  if (!globalRef.__vektorFleetDataset) {
    globalRef.__vektorFleetDataset = buildDataset();
  }
  return globalRef.__vektorFleetDataset;
}

export function mutateDataset<T>(fn: (dataset: Dataset) => T): T {
  return fn(getDataset());
}

export function resetDataset(): Dataset {
  globalRef.__vektorFleetDataset = buildDataset();
  return globalRef.__vektorFleetDataset;
}

// ---------------------------------------------------------------------------
// Convenience accessors — keep call sites free of array scanning noise.
// ---------------------------------------------------------------------------

export function vehicleById(id: string) {
  return getDataset().vehicles.find((v) => v.id === id) ?? null;
}

export function vehicleByPlate(plate: string) {
  const normalised = plate.replace(/\s+/g, "").toUpperCase();
  return (
    getDataset().vehicles.find((v) => v.plate.replace(/\s+/g, "").toUpperCase() === normalised) ??
    null
  );
}

export function driverById(id: string) {
  return getDataset().drivers.find((d) => d.id === id) ?? null;
}

export function driverByPhone(phone: string) {
  const normalised = normalisePhone(phone);
  return getDataset().drivers.find((d) => normalisePhone(d.phone) === normalised) ?? null;
}

export function deviceByVehicle(vehicleId: string) {
  return getDataset().devices.find((d) => d.vehicleId === vehicleId) ?? null;
}

export function tripsForVehicle(vehicleId: string) {
  return getDataset().trips.filter((t) => t.vehicleId === vehicleId);
}

export function transactionsForVehicle(vehicleId: string) {
  return getDataset()
    .fuelTransactions.filter((t) => t.vehicleId === vehicleId)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function complianceForVehicle(vehicleId: string) {
  return getDataset()
    .complianceItems.filter((c) => c.vehicleId === vehicleId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Human-friendly phone comparison — handles 07xx, +2547xx and 2547xx forms. */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `+254${digits}`;
  return `+${digits}`;
}
