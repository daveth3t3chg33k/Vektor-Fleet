import { CORRIDORS, FUEL_STATIONS } from "@/lib/domain/corridors";
import type { GeoPoint, VehicleSnapshot } from "@/lib/domain/types";
import { formatKm, relativeTime, titleCase } from "@/lib/format";

/**
 * Corridor operations map.
 *
 * A dependency-free SVG projection of the modelled Kenyan corridors with live
 * vehicle positions. Deliberately not a slippy map: it renders instantly, works
 * offline, and shows exactly what an ops manager needs — who is on which
 * corridor, and who has stopped moving.
 */

const PAD = 44;
const SCALE = 168; // px per degree

function buildProjection(points: GeoPoint[]) {
  const minLat = Math.min(...points.map((p) => p.lat));
  const maxLat = Math.max(...points.map((p) => p.lat));
  const minLng = Math.min(...points.map((p) => p.lng));
  const maxLng = Math.max(...points.map((p) => p.lng));

  const width = (maxLng - minLng) * SCALE + PAD * 2;
  const height = (maxLat - minLat) * SCALE + PAD * 2;

  const project = (p: GeoPoint): [number, number] => [
    (p.lng - minLng) * SCALE + PAD,
    // Latitude increases northwards, SVG y increases downwards.
    (maxLat - p.lat) * SCALE + PAD,
  ];

  return { project, width, height };
}

function pathFor(waypoints: GeoPoint[], project: (p: GeoPoint) => [number, number]): string {
  return waypoints
    .map((w, i) => {
      const [x, y] = project(w);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

const CITY_LABELS: Array<{ name: string; point: GeoPoint }> = [
  { name: "Nairobi", point: { lat: -1.2921, lng: 36.8219 } },
  { name: "Mombasa", point: { lat: -4.0435, lng: 39.6682 } },
  { name: "Nakuru", point: { lat: -0.3031, lng: 36.08 } },
  { name: "Eldoret", point: { lat: 0.5143, lng: 35.2698 } },
  { name: "Kisumu", point: { lat: -0.0917, lng: 34.768 } },
  { name: "Malaba", point: { lat: 0.6342, lng: 34.2814 } },
  { name: "Voi", point: { lat: -3.3961, lng: 38.5561 } },
];

export default function OpsMap({ snapshots }: { snapshots: VehicleSnapshot[] }) {
  const allPoints = [
    ...CORRIDORS.flatMap((c) => c.waypoints),
    ...CITY_LABELS.map((c) => c.point),
    ...FUEL_STATIONS.map((s) => s.position),
    ...snapshots
      .map((s) => s.lastPing?.position)
      .filter((p): p is GeoPoint => Boolean(p)),
  ];

  const { project, width, height } = buildProjection(allPoints);

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-void/70">
      <div className="vf-grid-lines absolute inset-0 opacity-40" />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="relative block h-auto w-full"
        role="img"
        aria-label="Live vehicle positions across Kenyan logistics corridors"
      >
        <defs>
          <linearGradient id="corridorStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.7" />
          </linearGradient>
          <filter id="dotGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Corridor centrelines */}
        {CORRIDORS.map((corridor) => (
          <g key={corridor.id}>
            <path
              d={pathFor(corridor.waypoints, project)}
              fill="none"
              stroke="#1d2a44"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={pathFor(corridor.waypoints, project)}
              fill="none"
              stroke="url(#corridorStroke)"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.9}
            />
            <path
              d={pathFor(corridor.waypoints, project)}
              fill="none"
              stroke="#e8eefb"
              strokeWidth={1.4}
              strokeLinecap="round"
              opacity={0.35}
              className="vf-flow"
            />
          </g>
        ))}

        {/* Fuel stations */}
        {FUEL_STATIONS.map((station) => {
          const [x, y] = project(station.position);
          return (
            <g key={station.name}>
              <rect x={x - 2.6} y={y - 2.6} width={5.2} height={5.2} fill="#5b6d8c" opacity={0.75} />
              <title>{station.name}</title>
            </g>
          );
        })}

        {/* Cities */}
        {CITY_LABELS.map((city) => {
          const [x, y] = project(city.point);
          return (
            <g key={city.name}>
              <circle cx={x} cy={y} r={3.6} fill="#0a1120" stroke="#8195b6" strokeWidth={1.6} />
              <text
                x={x + 8}
                y={y + 3.6}
                fontSize={11.5}
                fill="#8195b6"
                fontWeight={500}
                style={{ letterSpacing: "0.02em" }}
              >
                {city.name}
              </text>
            </g>
          );
        })}

        {/* Vehicles */}
        {snapshots.map((snap) => {
          const ping = snap.lastPing;
          if (!ping) return null;
          const [x, y] = project(ping.position);
          const colour = dotColour(snap);
          const moving = ping.ignition && ping.speedKph > 3;
          return (
            <g key={snap.vehicle.id}>
              {moving && (
                <circle cx={x} cy={y} r={5} fill={colour} opacity={0.35} className="vf-ping" />
              )}
              <circle cx={x} cy={y} r={5.4} fill={colour} filter="url(#dotGlow)" />
              <circle cx={x} cy={y} r={2} fill="#05080f" />
              <title>
                {snap.vehicle.plate} · {snap.driver?.name ?? "Unassigned"} ·{" "}
                {titleCase(snap.vehicle.status)} · {formatKm(ping.speedKph)}/h ·{" "}
                {relativeTime(ping.ts)} · {snap.openFlags} flag(s)
              </title>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3">
        <Legend colour="#34d399" label="Moving normally" />
        <Legend colour="#22d3ee" label="Parked / idle" />
        <Legend colour="#fbbf24" label="Open fuel flag" />
        <Legend colour="#fb7185" label="Critical flag" />
        <span className="ml-auto text-[10.5px] text-faint">
          {snapshots.filter((s) => (s.lastPing?.speedKph ?? 0) > 3).length} of {snapshots.length} in motion
        </span>
      </div>
    </div>
  );
}

function dotColour(snap: VehicleSnapshot): string {
  if (snap.vehicle.status === "offline") return "#5b6d8c";
  if (snap.openFlags > 0 && snap.complianceStatus === "expired") return "#fb7185";
  if (snap.openFlags > 0) return "#fbbf24";
  const ping = snap.lastPing;
  if (ping && ping.ignition && ping.speedKph > 3) return "#34d399";
  return "#22d3ee";
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[10.5px] text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
      {label}
    </span>
  );
}
