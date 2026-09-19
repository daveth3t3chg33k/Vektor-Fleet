import { pointAlongCorridor, polylineLengthKm } from "@/lib/domain/geo";
import type { Corridor, GeoPoint } from "@/lib/domain/types";

/**
 * Corridor centrelines used for route-deviation detection and the ops map.
 * Coordinates are approximate centreline points in driving order.
 */
export const CORRIDORS: Corridor[] = [
  {
    id: "mombasa_road",
    name: "Mombasa Road (A109)",
    waypoints: [
      { lat: -1.308, lng: 36.854 }, // Industrial Area, Nairobi
      { lat: -1.395, lng: 36.938 }, // Mlolongo
      { lat: -1.4565, lng: 36.9784 }, // Athi River
      { lat: -1.5177, lng: 37.2634 }, // Machakos turnoff
      { lat: -2.35, lng: 37.9 }, // Kibwezi approach
      { lat: -2.69, lng: 38.17 }, // Mtito Andei
      { lat: -3.3961, lng: 38.5561 }, // Voi
      { lat: -3.8639, lng: 39.4765 }, // Mariakani
      { lat: -4.0435, lng: 39.6682 }, // Mombasa port
    ],
  },
  {
    id: "northern_corridor",
    name: "Northern Corridor (A104)",
    waypoints: [
      { lat: -4.0435, lng: 39.6682 }, // Mombasa
      { lat: -3.3961, lng: 38.5561 }, // Voi
      { lat: -2.69, lng: 38.17 }, // Mtito Andei
      { lat: -1.5177, lng: 37.2634 }, // Machakos
      { lat: -1.308, lng: 36.854 }, // Nairobi
      { lat: -0.7167, lng: 36.4359 }, // Naivasha
      { lat: -0.3031, lng: 36.08 }, // Nakuru
      { lat: 0.5143, lng: 35.2698 }, // Eldoret
      { lat: 0.6342, lng: 34.2814 }, // Malaba (UG border)
    ],
  },
  {
    id: "nairobi_metro",
    name: "Nairobi Metro Distribution",
    waypoints: [
      { lat: -1.308, lng: 36.854 }, // Industrial Area
      { lat: -1.2921, lng: 36.8219 }, // CBD
      { lat: -1.2673, lng: 36.8065 }, // Westlands
      { lat: -1.3192, lng: 36.9278 }, // JKIA
      { lat: -1.38, lng: 36.75 }, // Ngong Road
    ],
  },
  {
    id: "thika_superhighway",
    name: "Thika Superhighway (A2)",
    waypoints: [
      { lat: -1.2921, lng: 36.8219 }, // Nairobi CBD
      { lat: -1.0332, lng: 37.0693 }, // Thika
      { lat: -0.9, lng: 37.3 }, // Kenol
      { lat: -0.4704, lng: 37.4637 }, // Embu road junction
    ],
  },
  {
    id: "kisumu_branch",
    name: "Nakuru–Kisumu (B1)",
    waypoints: [
      { lat: -0.3031, lng: 36.08 }, // Nakuru
      { lat: -0.2, lng: 35.5 }, // Timboroa
      { lat: -0.0917, lng: 34.768 }, // Kisumu
    ],
  },
];

export const CORRIDORS_BY_ID: Record<string, Corridor> = Object.fromEntries(
  CORRIDORS.map((c) => [c.id, c]),
);

export type StationProvider = "rubis" | "total" | "shell" | "independent";

export interface FuelStation {
  name: string;
  position: GeoPoint;
  provider: StationProvider;
}

/** Branded stations an enterprise fleet actually holds fuel cards with. */
const BRANDED_STATIONS: FuelStation[] = [
  { name: "Rubis Mlolongo", position: { lat: -1.3951, lng: 36.9384 }, provider: "rubis" },
  { name: "Total Athi River", position: { lat: -1.4562, lng: 36.9781 }, provider: "total" },
  { name: "Rubis Voi", position: { lat: -3.3958, lng: 38.5567 }, provider: "rubis" },
  { name: "Total Mariakani", position: { lat: -3.8635, lng: 39.4771 }, provider: "total" },
  { name: "Shell Changamwe", position: { lat: -4.0237, lng: 39.6293 }, provider: "shell" },
  { name: "Total Nakuru", position: { lat: -0.3028, lng: 36.0805 }, provider: "total" },
  { name: "Shell Industrial Area", position: { lat: -1.3085, lng: 36.8536 }, provider: "shell" },
  { name: "Rubis Eldoret", position: { lat: 0.5141, lng: 35.2701 }, provider: "rubis" },
];

/**
 * An independent operator — the archetypal venue for collusive fuelling,
 * because it sits outside the corporate card's branded network controls.
 */
export const INDEPENDENT_STATION: FuelStation = {
  name: "Makutano Fuels · Machakos bypass",
  position: { lat: -1.5305, lng: 37.3102 },
  provider: "independent",
};

/**
 * Towns along each corridor, used to label the stops we generate.
 * Stations are then placed at roughly 40 km intervals along the centreline, so a
 * vehicle is never more than ~20 km from a plausible fuelling point. Without
 * this density the station-mismatch detector would fire on honest fills in
 * sparsely serviced stretches such as Tsavo.
 */
const CORRIDOR_TOWNS: Record<string, string[]> = {
  mombasa_road: [
    "Mlolongo", "Athi River", "Salama", "Sultan Hamud", "Emali", "Kibwezi",
    "Mtito Andei", "Tsavo", "Voi", "Mackinnon Road", "Samburu", "Mariakani", "Changamwe",
  ],
  northern_corridor: [
    "Changamwe", "Voi", "Mtito Andei", "Athi River", "Naivasha", "Gilgil",
    "Nakuru", "Salgaa", "Timboroa", "Eldoret", "Webuye", "Bungoma", "Malaba",
  ],
  nairobi_metro: ["Industrial Area", "CBD", "Westlands", "JKIA", "Karen", "Ngong"],
  thika_superhighway: ["Ruiru", "Juja", "Thika", "Kenol", "Sagana", "Karatina", "Embu Junction"],
  kisumu_branch: ["Nakuru", "Timboroa", "Kapsabet", "Kisumu", "Ahero", "Muhoroni"],
};

const CORRIDOR_TAG: Record<string, string> = {
  mombasa_road: "A109",
  northern_corridor: "A104",
  nairobi_metro: "Metro",
  thika_superhighway: "A2",
  kisumu_branch: "B1",
};

const PROVIDER_CYCLE: StationProvider[] = ["rubis", "total", "shell", "independent", "total", "rubis"];

function buildCorridorStations(): FuelStation[] {
  const stations: FuelStation[] = [];
  for (const corridor of CORRIDORS) {
    const lengthKm = polylineLengthKm(corridor.waypoints);
    const stops = Math.max(2, Math.round(lengthKm / 40));
    const towns = CORRIDOR_TOWNS[corridor.id] ?? [];
    const tag = CORRIDOR_TAG[corridor.id] ?? corridor.id;
    for (let i = 0; i <= stops; i++) {
      const fraction = i / stops;
      const town = towns[i % Math.max(1, towns.length)] ?? `Stop ${i}`;
      stations.push({
        name: `${town} · ${tag}`,
        position: pointAlongCorridor(corridor, fraction),
        provider: PROVIDER_CYCLE[i % PROVIDER_CYCLE.length]!,
      });
    }
  }
  return stations;
}

/** Every fuelling point the generator can choose from. */
export const FUEL_STATIONS: FuelStation[] = [
  ...BRANDED_STATIONS,
  INDEPENDENT_STATION,
  ...buildCorridorStations(),
];

export const DEPOTS = [
  "Nairobi Industrial Area",
  "Mombasa Changamwe",
  "Nakuru ICD",
  "Eldoret Depot",
  "Athi River Yard",
];
