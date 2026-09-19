# VektorFleet

Hardware-agnostic, WhatsApp-native fleet management SaaS for African logistics enterprises.

This repository is the working foundation of the product described in the business plan: the
software layer that sits on top of whichever GPS trackers a customer already owns, joins telemetry
against fuel-card transactions and the Kenyan regulatory calendar, and captures field data through
WhatsApp instead of a native app.

## Why this architecture

The four structural problems in the plan each map to a concrete engineering decision:

| Business problem | Engineering answer |
| --- | --- |
| Disjointed hardware ecosystems | A canonical `TelemetryPing` contract plus a per-vendor adapter. Adding a tracker brand is one file. |
| Systemic fuel theft | A single-pass reconciliation joining card volume, the GPS trip index and tank physics. |
| Driver app friction | A WhatsApp state machine that emits *typed* events, not just chat. |
| Complex local compliance | One timeline over NTSA, governor, insurance, transit, county, KRA and emissions clocks with tiered reminders. |
| Spotty corridor coverage | An offline-first envelope that preserves the device capture timestamp and replays in order. |

## Quick start

```bash
npm install
npm run dev          # http://localhost:3010
```

The app runs with **zero external services**. A deterministic seeded dataset (three customer fleets,
14 vehicles across five GPS vendors, 30 days of trips, fuel-card history with deliberately injected
anomaly profiles, and 98 compliance obligations) is generated in-process on first request.

```bash
npm test             # unit tests for every engine
npm run typecheck    # tsc --noEmit
npm run seed         # write the fixture to data/vf-seed.json for inspection
```

## The engines

All business logic lives in `lib/engines/` and is pure, framework-free and unit-tested.

- **`adapters.ts`** — hardware-agnostic ingestion. Normalises CarTrack polling payloads, SafeRide
  webhooks, Teltonika Codec 8 IO elements, Ruptela FMS pulls and generic JT/T 808 gateways into one
  `TelemetryPing`.
- **`telemetry.ts`** — position reconstruction. `positionAt(vehicle, ts)` answers "where was this
  vehicle at any instant" from the trip index, so fuel forensics works on transactions far older
  than the raw ping buffer. Also GPS denoising, overspeed and idling analytics.
- **`fuelMatch.ts`** — the flagship. One chronological walk over trips and card transactions where
  trips burn fuel and fills add it. Emits seven flag types, each with evidence, expected-vs-actual
  volumes, a confidence score and a KES exposure:

  | Code | What it catches |
  | --- | --- |
  | `OVERFILL_IMPOSSIBLE` | More litres charged than the tank can hold, or than the reconstructed headroom allows |
  | `EXCESS_LITRES` | Card volume that the distance actually driven cannot justify |
  | `STATION_MISMATCH` | Card used at a station the vehicle was nowhere near |
  | `GHOST_FILL` | Fuel billed while the vehicle never moved |
  | `COLLUSION_PATTERN` | Same driver, same station, high volumes, a cadence that ignores the duty cycle |
  | `ODOMETER_REGRESSION` | Pump odometer reading lower than the previous logged one |
  | `OFF_HOURS_FILL` | Fuel drawn outside the authorised 06:00–22:00 EAT window |

- **`compliance.ts`** — NTSA/KRA/county schedules on one timeline, ranked by money at risk rather
  than by date, with a T-30 / T-7 / T-1 / overdue escalation ladder and WhatsApp-or-email routing.
- **`whatsapp.ts`** — the driver assistant state machine (pre-trip checklist, odometer capture,
  receipt photos, incidents), the intent parser, and the offline-first `OfflineQueue`.
- **`fleet.ts`** — the aggregation layer that turns engine output into dashboard shapes, including
  the auditable savings breakdown behind the headline "up to 25%" claim.

## Data model

`lib/domain/types.ts` is the single contract shared by the adapters, engines, REST API and UI.
`lib/domain/seed.ts` is the *only* place physics is defined: trips drive both the telemetry timeline
and the fuel burn, so the fuel-match engine reconciles against data that genuinely adds up — except
where an anomaly profile deliberately breaks it.

`lib/store/db.ts` is the storage seam. Everything reads through `getDataset()`; swapping the in-memory
seed for Postgres or SQLite is a single-module change.

## REST API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness and dataset census |
| `GET /api/fleet/summary` | KPIs plus the savings breakdown |
| `GET /api/vehicles` | Snapshots, filterable by fleet, status, plate, flags |
| `GET /api/vehicles/:id` | Snapshot, trips, fuel ledger, reconciliation, compliance |
| `GET /api/fuel/audit` | Full fleet reconciliation and flag queue |
| `GET /api/compliance` | Posture, reminder queue, per-vehicle matrix |
| `GET /api/whatsapp/thread` | Conversation, session state, driver roster |
| `POST /api/whatsapp/inbound` | Bot entry point (accepts the WhatsApp Cloud API envelope) |
| `POST /api/telemetry/ingest` | Vendor-agnostic telemetry ingress |
| `GET /api/integrations` | Adapter catalogue with live normalisation preview |

## Console

Seven screens, all server-rendered from the engines: overview control tower with a live corridor map,
fleet register, vehicle detail with trip log and fuel ledger, fuel forensics investigation queue,
compliance runway and matrix, an interactive WhatsApp bot simulator, and the integrations console.

## Not yet built

This is the product spine, not a shippable SaaS. Deliberately out of scope for now: authentication
and tenancy, a real database, live vendor API credentials, WhatsApp Cloud API transport and template
approval, billing, and the reporting/export layer. The seams for each are marked above.
# Vektor-Fleet
