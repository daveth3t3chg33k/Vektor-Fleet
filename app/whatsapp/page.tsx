import { Languages, MessageCircle, Smartphone, WifiOff } from "lucide-react";
import BotSimulator from "@/components/BotSimulator";
import { PageHeader, Panel, StatCard } from "@/components/ui";
import { PRE_TRIP_CHECKLIST, queueDepth } from "@/lib/engines/whatsapp";
import { getDataset } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export default function WhatsAppPage() {
  const dataset = getDataset();
  const queue = queueDepth();

  const roster = dataset.vehicles.map((vehicle) => {
    const driver = dataset.drivers.find((d) => d.id === vehicle.driverId);
    return {
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      driverId: driver?.id ?? "",
      driverName: driver?.name ?? "Unassigned",
      phone: driver?.phone ?? "",
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Field data capture"
        title="WhatsApp driver assistant"
        description="Drivers never install an app. The assistant runs the pre-trip checklist, logs odometer readings, collects fuel-receipt photos and files incidents — all inside the chat app they already use, without burning mobile data."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Install required"
          value="None"
          sub="Runs over the WhatsApp Business API"
          tone="mint"
          icon={<Smartphone className="h-4 w-4" />}
        />
        <StatCard
          label="Data per checklist"
          value="~2 KB"
          sub="Versus tens of megabytes for a native app"
          tone="signal"
          icon={<MessageCircle className="h-4 w-4" />}
        />
        <StatCard
          label="Offline queue"
          value={`${queue.pending} pending`}
          sub={`${queue.synced} synced with original timestamps`}
          tone={queue.pending > 0 ? "warn" : "muted"}
          icon={<WifiOff className="h-4 w-4" />}
        />
        <StatCard
          label="Languages"
          value="EN · SW"
          sub="Swahili replies handled natively (SAWA, ANZA)"
          tone="violet"
          icon={<Languages className="h-4 w-4" />}
        />
      </div>

      <BotSimulator initialRoster={roster} />

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title={`Pre-trip checklist — ${PRE_TRIP_CHECKLIST.length} items`}
          subtitle="The exact sequence the bot walks the driver through. A FAIL opens a maintenance task instead of letting the vehicle depart."
        >
          <ol className="space-y-2">
            {PRE_TRIP_CHECKLIST.map((item, index) => (
              <li key={item.key} className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
                <span className="vf-num grid h-6 w-6 shrink-0 place-items-center rounded-md border border-signal/25 bg-signal/10 text-[11px] font-semibold text-signal">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">
                    {item.key}
                  </div>
                  <div className="text-[12px] leading-snug text-ink">{item.prompt}</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="Why this beats an app"
          subtitle="The adoption problem is the real problem in African fleet digitisation."
        >
          <ul className="space-y-3 text-[12px] leading-relaxed text-muted">
            <Bullet title="Zero installation friction">
              Drivers already have WhatsApp. There is no APK sideload, no Play Store account, no
              login to forget and no IT support call when an update breaks.
            </Bullet>
            <Bullet title="Data-light by design">
              Text checklists cost kilobytes. Receipt photos are the only media, and they arrive
              compressed and on demand rather than continuously streamed.
            </Bullet>
            <Bullet title="Offline-first capture">
              On the Mombasa–Kampala corridor signal drops for hours. Field entries are stamped
              with the device clock at capture time and replayed in order when connectivity returns,
              so the audit trail never loses its timing.
            </Bullet>
            <Bullet title="Auditable by default">
              Every message, checklist answer and receipt is retained against the driver, the
              vehicle and the shift — which is exactly the evidence needed when fuel is disputed.
            </Bullet>
            <Bullet title="Typed, not just chat">
              Each turn emits structured events (checklist item, odometer, receipt, incident) that
              the rest of the platform consumes directly.
            </Bullet>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
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
