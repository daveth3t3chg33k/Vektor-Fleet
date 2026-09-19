/** Shared display formatters so numbers read consistently across the console. */

export function formatKes(value: number, opts: { compact?: boolean; decimals?: number } = {}): string {
  const { compact = false, decimals = 0 } = opts;
  if (!Number.isFinite(value)) return "KES —";

  if (compact) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `KES ${(value / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `KES ${(value / 1_000).toFixed(0)}K`;
  }

  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatLitres(value: number): string {
  return `${formatNumber(value, value < 100 ? 1 : 0)} L`;
}

export function formatKm(value: number): string {
  return `${formatNumber(value, value < 100 ? 1 : 0)} km`;
}

export function formatDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

export function formatDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
}

export function relativeTime(iso: string | number | Date, now = Date.now()): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = Math.round((now - ts) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 45) return "just now";
  if (abs < 3600) return `${Math.round(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${suffix}`;
  if (abs < 2592000) return `${Math.round(abs / 86400)}d ${suffix}`;
  return formatDate(iso);
}

export function formatDays(days: number): string {
  if (days === 0) return "today";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `${days}d`;
}

export function percent(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

/** Human label for a snake_case enum value. */
export function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const FLAG_CODE_LABEL: Record<string, string> = {
  OVERFILL_IMPOSSIBLE: "Impossible fill",
  EXCESS_LITRES: "Excess litres",
  STATION_MISMATCH: "Station mismatch",
  GHOST_FILL: "Ghost fill",
  COLLUSION_PATTERN: "Collusion pattern",
  OFF_HOURS_FILL: "Off-hours fill",
  ODOMETER_REGRESSION: "Odometer regression",
};

export const COMPLIANCE_LABEL: Record<string, string> = {
  ok: "Compliant",
  due_soon: "Due soon",
  critical: "Critical",
  expired: "Expired",
};
