import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildDataset } from "../lib/domain/seed";

/**
 * Materialises the deterministic demo dataset to data/vf-seed.json.
 *
 * The app itself generates the dataset in-process, so this script exists for
 * inspecting the fixture, diffing generator changes, and loading the same data
 * into a real database during a migration rehearsal.
 */
const dataset = buildDataset();
const out = resolve(process.cwd(), "data/vf-seed.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(dataset, null, 2));

const counts = {
  fleets: dataset.fleets.length,
  vehicles: dataset.vehicles.length,
  drivers: dataset.drivers.length,
  devices: dataset.devices.length,
  trips: dataset.trips.length,
  telemetry: dataset.telemetry.length,
  fuelTransactions: dataset.fuelTransactions.length,
  complianceItems: dataset.complianceItems.length,
};

console.log(`Wrote ${out}`);
for (const [key, value] of Object.entries(counts)) {
  console.log(`  ${key.padEnd(18)} ${value.toLocaleString()}`);
}
