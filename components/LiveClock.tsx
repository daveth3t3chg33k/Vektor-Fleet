"use client";

import { useEffect, useState } from "react";

/** Nairobi-time clock for the console header. */
export default function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return <div className="h-8 w-[132px] rounded-lg bg-surface-2/50" aria-hidden />;
  }

  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Africa/Nairobi",
  });
  const date = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "Africa/Nairobi",
  });

  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">EAT</span>
      <span className="vf-num text-sm font-medium text-ink">{time}</span>
      <span className="text-[11px] text-muted">{date}</span>
    </div>
  );
}
