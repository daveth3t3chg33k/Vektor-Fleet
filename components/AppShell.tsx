import { fleetKpis } from "@/lib/engines/fleet";
import { getDataset } from "@/lib/store/db";
import { formatKes } from "@/lib/format";
import NavSidebar from "@/components/NavSidebar";
import LiveClock from "@/components/LiveClock";

/**
 * Console shell: fixed navigation rail, a live top bar, and the page surface.
 * Rendered on the server so the header KPIs come straight from the engines.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const dataset = getDataset();
  const kpis = fleetKpis();

  return (
    <div className="flex min-h-screen">
      <NavSidebar fleets={dataset.fleets.map((f) => ({ id: f.id, name: f.name, tier: f.tier }))} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-void/85 backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="vf-ping absolute inline-flex h-full w-full rounded-full bg-mint" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-mint" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-faint">
                Live telemetry
              </span>
              <span className="vf-num text-xs text-muted">
                {kpis.vehicles} vehicles · {kpis.active} active · {kpis.offline} offline
              </span>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
              <TopStat label="Unexplained fuel" value={`${kpis.unverifiedLitres.toLocaleString()} L`} tone="danger" />
              <TopStat label="Flagged exposure" value={formatKes(kpis.flaggedExposureKes, { compact: true })} tone="warn" />
              <TopStat label="Annualised saving" value={formatKes(kpis.annualisedSavingKes, { compact: true })} tone="mint" />
              <LiveClock />
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-5 py-6 lg:px-8 lg:py-8">{children}</main>

        <footer className="border-t border-line px-5 py-4 text-[11px] text-faint lg:px-8">
          VektorFleet · hardware-agnostic fleet intelligence for African logistics · data
          generated {new Date(dataset.generatedAt).toLocaleString("en-GB", { timeZone: "Africa/Nairobi" })} EAT
        </footer>
      </div>
    </div>
  );
}

function TopStat({ label, value, tone }: { label: string; value: string; tone: "danger" | "warn" | "mint" }) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-mint";
  return (
    <div className="hidden flex-col leading-tight sm:flex">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</span>
      <span className={`vf-num text-sm font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}
