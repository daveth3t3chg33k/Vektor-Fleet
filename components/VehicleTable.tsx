"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowUpDown, Search } from "lucide-react";
import { COMPLIANCE_LABEL, formatKm, formatLitres, relativeTime, titleCase } from "@/lib/format";
import { Pill, SEVERITY_TONE, STATUS_TONE } from "@/components/ui";
import type { Fleet, VehicleSnapshot } from "@/lib/domain/types";

type SortKey = "plate" | "distance" | "flags" | "compliance" | "status";

const STATUS_FILTERS = ["all", "active", "idle", "maintenance", "offline"] as const;

export default function VehicleTable({
  snapshots,
  fleets,
}: {
  snapshots: VehicleSnapshot[];
  fleets: Fleet[];
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [fleetId, setFleetId] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "flags", dir: "desc" });

  const fleetName = useMemo(() => new Map(fleets.map((f) => [f.id, f.name])), [fleets]);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\s+/g, "");
    let list = snapshots.filter((s) => {
      if (status !== "all" && s.vehicle.status !== status) return false;
      if (fleetId !== "all" && s.vehicle.fleetId !== fleetId) return false;
      if (!q) return true;
      return (
        s.vehicle.plate.replace(/\s+/g, "").includes(q) ||
        (s.driver?.name ?? "").toUpperCase().includes(q)
      );
    });

    const rank = { expired: 4, critical: 3, due_soon: 2, ok: 1 } as const;
    list = [...list].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.key) {
        case "plate":
          return a.vehicle.plate.localeCompare(b.vehicle.plate) * dir;
        case "distance":
          return (a.distance24hKm - b.distance24hKm) * dir;
        case "flags":
          return (a.openFlags - b.openFlags) * dir;
        case "compliance":
          return (rank[a.complianceStatus] - rank[b.complianceStatus]) * dir;
        case "status":
          return a.vehicle.status.localeCompare(b.vehicle.status) * dir;
        default:
          return 0;
      }
    });
    return list;
  }, [snapshots, query, status, fleetId, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div className="vf-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plate or driver…"
            className="w-full rounded-lg border border-line bg-surface-2/60 py-2 pl-9 pr-3 text-[12.5px] text-ink placeholder:text-faint focus:border-signal/50 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={clsx(
                "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium capitalize transition-colors",
                status === s
                  ? "border-signal/40 bg-signal/12 text-signal"
                  : "border-line bg-surface-2/50 text-muted hover:text-ink",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <select
          value={fleetId}
          onChange={(e) => setFleetId(e.target.value)}
          className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-[12px] text-ink focus:border-signal/50 focus:outline-none"
        >
          <option value="all">All fleets</option>
          {fleets.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <span className="vf-num text-[11px] text-faint">{rows.length} shown</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.14em] text-faint">
              <Th onClick={() => toggleSort("plate")} active={sort.key === "plate"}>Vehicle</Th>
              <Th>Driver</Th>
              <Th onClick={() => toggleSort("status")} active={sort.key === "status"}>Status</Th>
              <Th align="right" onClick={() => toggleSort("distance")} active={sort.key === "distance"}>24h</Th>
              <Th align="right">Efficiency</Th>
              <Th align="right" onClick={() => toggleSort("flags")} active={sort.key === "flags"}>Flags</Th>
              <Th>Governor</Th>
              <Th onClick={() => toggleSort("compliance")} active={sort.key === "compliance"}>Compliance</Th>
              <Th align="right">Last seen</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((snap) => {
              const ping = snap.lastPing;
              const overGovernor = snap.overspeedEvents > 0;
              return (
                <tr
                  key={snap.vehicle.id}
                  className="group border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/50"
                >
                  <td className="px-5 py-3">
                    <Link href={`/vehicles/${snap.vehicle.id}`} className="block">
                      <span className="vf-num text-[12.5px] font-semibold text-ink group-hover:text-signal">
                        {snap.vehicle.plate}
                      </span>
                      <span className="block text-[10.5px] text-faint">
                        {snap.vehicle.make} {snap.vehicle.model} · {titleCase(snap.vehicle.class)}
                        <span className="mx-1.5 text-line-2">|</span>
                        {fleetName.get(snap.vehicle.fleetId)}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className="block text-[12px] text-ink">{snap.driver?.name ?? "Unassigned"}</span>
                    <span className="vf-num block text-[10.5px] text-faint">
                      score {snap.driver?.score ?? "—"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Pill tone={STATUS_TONE[snap.vehicle.status] ?? "muted"} dot>
                      {snap.vehicle.status}
                    </Pill>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="vf-num text-[12px] text-ink">{formatKm(snap.distance24hKm)}</span>
                    <span className="vf-num block text-[10.5px] text-faint">
                      {ping ? `${ping.speedKph.toFixed(0)} km/h now` : "no fix"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <span className="vf-num text-[12px] text-ink">
                      {snap.liveKmPerLitre ? `${snap.liveKmPerLitre} km/L` : "—"}
                    </span>
                    <span className="vf-num block text-[10.5px] text-faint">
                      nominal {snap.vehicle.kmPerLitre}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {snap.openFlags === 0 ? (
                      <span className="text-[11px] text-faint">clear</span>
                    ) : (
                      <Pill tone={snap.openFlags > 2 ? "danger" : "warn"}>{snap.openFlags} open</Pill>
                    )}
                    <span className="vf-num block text-[10.5px] text-faint">
                      {formatLitres(snap.vehicle.tankCapacityL)} tank
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Pill tone={overGovernor ? "danger" : "mint"}>
                      {snap.vehicle.governorLimitKph} km/h
                    </Pill>
                    <span className="vf-num block text-[10.5px] text-faint">
                      {snap.overspeedEvents} events
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Pill tone={STATUS_TONE[snap.complianceStatus] ?? "muted"}>
                      {COMPLIANCE_LABEL[snap.complianceStatus]}
                    </Pill>
                  </td>
                  <td className="px-5 py-3 text-right text-[11px] text-muted">
                    {ping ? relativeTime(ping.ts) : "—"}
                    <span className="block text-[10.5px] text-faint">
                      {snap.device ? `${snap.device.vendor} ${snap.device.online ? "· online" : "· offline"}` : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="px-5 py-10 text-center text-[12px] text-muted">
            No vehicles match those filters.
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-3 text-[10.5px] text-faint">
        <span>Severity tones:</span>
        {(["critical", "high", "medium", "low"] as const).map((s) => (
          <Pill key={s} tone={SEVERITY_TONE[s]}>
            {s}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
  onClick,
  active,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <th className={clsx("px-5 py-3 font-semibold", align === "right" && "text-right")}>
      {onClick ? (
        <button
          onClick={onClick}
          className={clsx(
            "inline-flex items-center gap-1 transition-colors hover:text-ink",
            active && "text-signal",
          )}
        >
          {children}
          <ArrowUpDown className="h-3 w-3" />
        </button>
      ) : (
        children
      )}
    </th>
  );
}
