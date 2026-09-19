import clsx from "clsx";
import type { ReactNode } from "react";

/** Shared presentational primitives used across every console page. */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("vf-panel vf-panel-hover overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={clsx("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export type Tone = "signal" | "mint" | "warn" | "danger" | "violet" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  signal: "bg-signal/12 text-signal border-signal/25",
  mint: "bg-mint/12 text-mint border-mint/25",
  warn: "bg-warn/12 text-warn border-warn/25",
  danger: "bg-danger/12 text-danger border-danger/25",
  violet: "bg-violet/12 text-violet border-violet/25",
  muted: "bg-surface-3/60 text-muted border-line-2",
};

export function Pill({
  tone = "muted",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]",
        TONE_CLASS[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const SEVERITY_TONE: Record<string, Tone> = {
  critical: "danger",
  high: "warn",
  medium: "signal",
  low: "muted",
};

export const STATUS_TONE: Record<string, Tone> = {
  expired: "danger",
  critical: "warn",
  due_soon: "signal",
  ok: "mint",
  active: "mint",
  idle: "signal",
  maintenance: "warn",
  offline: "muted",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "signal",
  icon,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  icon?: ReactNode;
  trend?: string;
}) {
  const accent: Record<Tone, string> = {
    signal: "from-signal/18",
    mint: "from-mint/18",
    warn: "from-warn/18",
    danger: "from-danger/18",
    violet: "from-violet/18",
    muted: "from-surface-3/60",
  };
  const trendTone: Record<Tone, string> = {
    signal: "text-signal",
    mint: "text-mint",
    warn: "text-warn",
    danger: "text-danger",
    violet: "text-violet",
    muted: "text-muted",
  };
  return (
    <div className="vf-panel vf-panel-hover relative overflow-hidden p-4">
      <div
        className={clsx(
          "pointer-events-none absolute inset-x-0 -top-16 h-24 bg-gradient-to-b to-transparent",
          accent[tone],
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">
          {label}
        </span>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <div className="relative mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink vf-num">
        {value}
      </div>
      {(sub || trend) && (
        <div className="relative mt-2 flex items-center gap-2">
          {trend && (
            <span className={clsx("text-[11px] font-semibold", trendTone[tone])}>{trend}</span>
          )}
          {sub && <span className="text-[11px] leading-snug text-muted">{sub}</span>}
        </div>
      )}
    </div>
  );
}

/** Circular gauge used for the fleet health score. */
export function HealthRing({ score, size = 132 }: { score: number; size?: number }) {
  const radius = (size - 18) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const dash = (clamped / 100) * circumference;
  const color = clamped >= 80 ? "#34d399" : clamped >= 60 ? "#22d3ee" : clamped >= 40 ? "#fbbf24" : "#fb7185";

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1d2a44"
          strokeWidth={10}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          style={{ transition: "stroke-dasharray 600ms ease" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="vf-num text-3xl font-semibold leading-none text-ink">{clamped}</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-faint">
          Health
        </span>
      </div>
    </div>
  );
}

/** Horizontal meter bar for comparative rankings. */
export function MeterBar({
  value,
  max,
  tone = "signal",
  height = 6,
}: {
  value: number;
  max: number;
  tone?: Tone;
  height?: number;
}) {
  const pct = max <= 0 ? 0 : Math.max(2, Math.min(100, (value / max) * 100));
  const fill: Record<Tone, string> = {
    signal: "bg-signal",
    mint: "bg-mint",
    warn: "bg-warn",
    danger: "bg-danger",
    violet: "bg-violet",
    muted: "bg-muted",
  };
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-3" style={{ height }}>
      <div
        className={clsx("h-full rounded-full transition-all duration-500", fill[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line-2 px-4 py-8 text-center">
      <div className="text-[13px] font-medium text-ink">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-snug text-muted">{detail}</p>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-signal">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
