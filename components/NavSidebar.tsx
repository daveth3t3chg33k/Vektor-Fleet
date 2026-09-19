"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BadgeCheck,
  Fuel,
  Gauge,
  LayoutDashboard,
  MessageCircle,
  Plug,
  Truck,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, hint: "Control tower" },
  { href: "/vehicles", label: "Vehicles", icon: Truck, hint: "Fleet register" },
  { href: "/fuel", label: "Fuel forensics", icon: Fuel, hint: "Match engine" },
  { href: "/compliance", label: "Compliance", icon: BadgeCheck, hint: "NTSA · KRA" },
  { href: "/whatsapp", label: "Driver assistant", icon: MessageCircle, hint: "WhatsApp bot" },
  { href: "/integrations", label: "Integrations", icon: Plug, hint: "GPS vendors" },
];

export default function NavSidebar({ fleets }: { fleets: Array<{ id: string; name: string; tier: number }> }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-signal to-signal-dim shadow-lg shadow-signal/20">
          <Gauge className="h-5 w-5 text-void" strokeWidth={2.6} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-ink">
            Vektor<span className="text-signal">Fleet</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-faint">Operations console</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3 py-2">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
                active
                  ? "bg-signal/10 text-ink"
                  : "text-muted hover:bg-surface-2/70 hover:text-ink",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-signal" />
              )}
              <Icon
                className={clsx("h-[18px] w-[18px] shrink-0", active ? "text-signal" : "text-faint group-hover:text-muted")}
                strokeWidth={2}
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-tight">{item.label}</span>
                <span className="block truncate text-[10px] uppercase tracking-[0.1em] text-faint">
                  {item.hint}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-2 px-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
          Managed fleets
        </div>
        <ul className="flex flex-col gap-1.5">
          {fleets.map((fleet) => (
            <li key={fleet.id} className="flex items-start gap-2 text-[12px] text-muted">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-signal/70" />
              <span className="min-w-0">
                <span className="block truncate leading-tight">{fleet.name}</span>
                <span className="text-[10px] uppercase tracking-[0.1em] text-faint">
                  Tier {fleet.tier}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto p-4">
        <div className="rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
            Offline-first
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Field data is queued with its original timestamp in dead zones and replayed
            automatically when signal returns.
          </p>
        </div>
      </div>
    </aside>
  );
}
