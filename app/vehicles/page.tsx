import VehicleTable from "@/components/VehicleTable";
import { PageHeader, StatCard } from "@/components/ui";
import { allSnapshots } from "@/lib/engines/fleet";
import { auditFleet } from "@/lib/engines/fuelMatch";
import { formatKes, formatLitres, formatNumber } from "@/lib/format";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export default function VehiclesPage() {
  const snapshots = allSnapshots();
  const audit = auditFleet();
  const fleets = getDataset().fleets;

  const flagged = snapshots.filter((s) => s.openFlags > 0).length;
  const totalDistance = snapshots.reduce((s, x) => s + x.distance24hKm, 0);
  const offline = snapshots.filter((s) => !s.device?.online).length;

  return (
    <>
      <PageHeader
        eyebrow="Fleet register"
        title="Every vehicle, every tracker brand"
        description="Vehicles from three customer fleets running five different GPS vendors. The platform normalises all of them into one register, so a mixed yard finally reads as a single fleet."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vehicles under management" value={String(snapshots.length)} sub={`${fleets.length} customer fleets`} tone="signal" />
        <StatCard label="With open fuel flags" value={String(flagged)} sub={`${audit.flags.length} findings in the window`} tone="warn" />
        <StatCard label="Devices offline" value={String(offline)} sub="No fix in the last hour" tone="muted" />
        <StatCard
          label="Distance, last 24h"
          value={`${formatNumber(totalDistance)} km`}
          sub={`${formatLitres(audit.totals.litres / 30)} billed today · ${formatKes(audit.totals.spendKes / 30, { compact: true })}`}
          tone="mint"
        />
      </div>

      <VehicleTable snapshots={snapshots} fleets={fleets} />
    </>
  );
}
