import IntegrationsConsole from "@/components/IntegrationsConsole";
import { PageHeader, Panel, Pill, StatCard } from "@/components/ui";
import { ADAPTERS, normalizePing } from "@/lib/engines/adapters";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

const SAMPLES: Record<string, Record<string, unknown>> = {
  cartrack: { DeviceID: "CT-882301", Lat: -1.3085, Lon: 36.8541, Speed: 62, Heading: 118, Ignition: 1, Timestamp: 1789800000, Odometer: 154320000, Fuel1: 4820 },
  saferide: { vehicle_id: "SR-20455", latitude: -3.3958, longitude: 38.5567, velocity_kmh: 71, direction: 291, acc_status: true, date_time: "2026-09-19T07:42:00Z", mileage_km: 421880.4, fuel_litres: 173.2 },
  teltonika: { imei: "864025060123456", ts: 1789800120000, gps: { lat: -1.4565, lon: 36.9784, spd: 54, ang: 205 }, io: { "239": 1, "16": 274118000, "48": 1184 } },
  ruptela: { tracker_id: "RP-99120", timestamp_utc: "2026-09-19T07:42:00Z", gps_lat: -0.3031, gps_lng: 36.08, gps_speed: 38, gps_angle: 77, ignition_status: 1, total_odometer_km: 231004.9, fuel_level_l: 96.5 },
  generic_tcp: { device: "GEN-55012", time: "2026-09-19T07:42:00Z", lat: -4.0237, lng: 39.6293, speed: 0, heading: 12, ignition: 0, odometer_km: 318442.0, fuel_l: 210.4 },
};

export default function IntegrationsPage() {
  const dataset = getDataset();
  const vendors = Object.keys(ADAPTERS) as Array<keyof typeof ADAPTERS>;

  const adapters = vendors.map((vendor) => {
    const adapter = ADAPTERS[vendor];
    const sample = SAMPLES[vendor] ?? {};
    let normalised: Record<string, unknown> | null = null;
    let error: string | null = null;
    try {
      normalised = normalizePing(vendor, sample, { deviceId: "dev_preview", vehicleId: "veh_preview" }) as unknown as Record<string, unknown>;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    return {
      vendor,
      label: adapter.label,
      integration: adapter.integration,
      docsUrl: adapter.docsUrl,
      connectedDevices: dataset.devices.filter((d) => d.vendor === vendor).length,
      sampleRaw: sample,
      sampleNormalised: normalised,
      error,
    };
  });

  const others = dataset.devices.filter((d) => !vendors.includes(d.vendor as never));

  return (
    <>
      <PageHeader
        eyebrow="Hardware-agnostic"
        title="Integrations"
        description="No proprietary hardware, ever. VektorFleet ingests from whichever trackers are already bolted to the customer's vehicles and normalises every payload into a single telemetry contract — which is what makes a mixed yard readable in one screen."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vendor adapters" value={String(vendors.length)} sub="REST pull, webhook push and raw TCP stream" tone="signal" />
        <StatCard
          label="Devices ingested"
          value={String(dataset.devices.length)}
          sub={`Across ${new Set(dataset.devices.map((d) => d.vendor)).size} hardware brands`}
          tone="mint"
        />
        <StatCard
          label="Normalised samples"
          value={dataset.telemetry.length.toLocaleString()}
          sub="In the live buffer"
          tone="violet"
        />
        <StatCard
          label="Protocols"
          value="4"
          sub="Polling, webhook, Teltonika codec and JT/T 808"
          tone="warn"
        />
      </div>

      <IntegrationsConsole adapters={adapters} connected={dataset.devices} />

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="The commercial argument"
          subtitle="Why hardware-agnostic wins in this market."
        >
          <ul className="space-y-3 text-[12px] leading-relaxed text-muted">
            <Point title="No rip-and-replace">
              Enterprise fleets already paid for trackers. Asking them to scrap working hardware to
              buy ours is the fastest way to lose the deal. VektorFleet sells into what exists.
            </Point>
            <Point title="Customer leverage forces open APIs">
              When a Tier 1 fleet demands data access from its tracker vendor, the vendor is
              contractually obliged to expose it. The negotiation is between the customer and its
              supplier — not between us and a competitor.
            </Point>
            <Point title="Mixed fleets become one fleet">
              The failure mode today is four disconnected screens for four hardware brands. One
              canonical telemetry model collapses them into one operational picture.
            </Point>
            <Point title="Ingest, don&apos;t integrate twice">
              A single <code className="font-mono text-[11px] text-signal">POST /api/telemetry/ingest</code>{" "}
              endpoint accepts every vendor batch and returns the normalised result, so onboarding a
              new brand is a config change rather than a project.
            </Point>
          </ul>
        </Panel>

        <Panel
          title="Ingest contract"
          subtitle="One endpoint, every vendor. Vendors are resolved by adapter, not by bespoke code paths."
        >
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-void/60 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                Request
                <Pill tone="signal">POST /api/telemetry/ingest</Pill>
              </div>
              <pre className="overflow-auto font-mono text-[10.5px] leading-relaxed text-muted">{`{
  "vendor": "teltonika",
  "deviceId": "dev_003",
  "samples": [
    { "imei": "864025060123456",
      "gps": { "lat": -1.4565, "lon": 36.9784, "spd": 54 },
      "io":  { "239": 1, "16": 274118000 } }
  ]
}`}</pre>
            </div>
            <div className="rounded-xl border border-mint/20 bg-void/60 p-3">
              <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                Response
              </div>
              <pre className="overflow-auto font-mono text-[10.5px] leading-relaxed text-mint/90">{`{
  "received": 1,
  "accepted": 1,
  "rejected": 0,
  "normalised": [{
    "vehicleId": "veh_003",
    "ts": "2026-09-19T07:42:00.000Z",
    "speedKph": 54,
    "ignition": true,
    "odometerKm": 274118
  }]
}`}</pre>
            </div>
            {others.length > 0 && (
              <p className="text-[11px] text-muted">
                {others.length} device(s) on vendors without a matching adapter would be rejected
                with a 400 until an adapter is added.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal/70" />
      <span>
        <span className="font-medium text-ink">{title}. </span>
        {children}
      </span>
    </li>
  );
}
