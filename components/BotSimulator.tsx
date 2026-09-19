"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ImageIcon, Send, TriangleAlert, User2, Zap } from "lucide-react";
import type { WhatsAppMessage, WhatsAppSession } from "@/lib/domain/types";
import { Pill } from "@/components/ui";

interface RosterEntry {
  vehicleId: string;
  plate: string;
  driverId: string;
  driverName: string;
  phone: string;
}

interface ApiData {
  thread: WhatsAppMessage[];
  session: WhatsAppSession | null;
  roster: RosterEntry[];
  queue: { pending: number; synced: number };
  events?: Array<{ type: string; [key: string]: unknown }>;
  replies?: string[];
}

const QUICK = ["START", "STATUS", "HELP", "INCIDENT burst tyre near Voi", "ODO 154320"];

export default function BotSimulator({ initialRoster }: { initialRoster: RosterEntry[] }) {
  const [roster, setRoster] = useState<RosterEntry[]>(initialRoster);
  const [phone, setPhone] = useState(initialRoster[0]?.phone ?? "");
  const [thread, setThread] = useState<WhatsAppMessage[]>([]);
  const [session, setSession] = useState<WhatsAppSession | null>(null);
  const [queue, setQueue] = useState({ pending: 0, synced: 0 });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!phone) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/whatsapp/thread?phone=${encodeURIComponent(phone)}`);
      const json = (await res.json()) as { data: ApiData };
      if (cancelled) return;
      setThread(json.data.thread ?? []);
      setSession(json.data.session ?? null);
      setQueue(json.data.queue ?? { pending: 0, synced: 0 });
      if (json.data.roster?.length) setRoster(json.data.roster);
    })();
    return () => {
      cancelled = true;
    };
  }, [phone]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  async function send(body: string, mediaUrl?: string) {
    if (!phone || busy) return;
    if (!body.trim() && !mediaUrl) return;
    setBusy(true);
    setInput("");
    try {
      const res = await fetch("/api/whatsapp/inbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, body, mediaUrl }),
      });
      const json = (await res.json()) as { data: ApiData };
      setThread(json.data.thread ?? []);
      setSession(json.data.session ?? null);
      setQueue(json.data.queue ?? { pending: 0, synced: 0 });
      if (json.data.events?.length) {
        setEvents((prev) =>
          [
            ...json.data.events!.map((e) => describeEvent(e)).filter((x): x is string => Boolean(x)),
            ...prev,
          ].slice(0, 12),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const selected = roster.find((r) => r.phone === phone);

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr_280px]">
      {/* Driver roster */}
      <div className="vf-panel overflow-hidden">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-[12.5px] font-semibold text-ink">Driver roster</h2>
          <p className="mt-0.5 text-[10.5px] text-muted">
            Every driver is reachable on the number already in their pocket.
          </p>
        </header>
        <ul className="max-h-[520px] overflow-y-auto">
          {roster.map((entry) => {
            const active = entry.phone === phone;
            return (
              <li key={entry.phone}>
                <button
                  onClick={() => setPhone(entry.phone)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 border-b border-line/60 px-4 py-2.5 text-left transition-colors last:border-0",
                    active ? "bg-signal/10" : "hover:bg-surface-2/60",
                  )}
                >
                  <span
                    className={clsx(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-full border",
                      active ? "border-signal/40 bg-signal/15 text-signal" : "border-line bg-surface-3 text-faint",
                    )}
                  >
                    <User2 className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-ink">
                      {entry.driverName}
                    </span>
                    <span className="vf-num block truncate text-[10px] text-faint">{entry.phone}</span>
                  </span>
                  <span className="vf-num shrink-0 text-[10px] text-muted">{entry.plate}</span>
                </button>
              </li>
            );
          })}
          {roster.length === 0 && (
            <li className="px-4 py-6 text-center text-[11px] text-muted">No drivers registered.</li>
          )}
        </ul>
      </div>

      {/* Chat */}
      <div className="vf-panel flex h-[640px] flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-mint to-signal text-void">
            <Zap className="h-4 w-4" strokeWidth={2.6} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-ink">
              VektorFleet Assistant
              <span className="ml-2 text-[10px] font-normal text-mint">Business account · verified</span>
            </div>
            <div className="text-[10.5px] text-muted">
              {selected ? `${selected.driverName} · ${selected.plate}` : "Select a driver"}
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-mint/25 bg-mint/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-mint sm:inline-flex">
            <Check className="h-3 w-3" /> no app install
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {thread.length === 0 ? (
            <div className="mx-auto mt-10 max-w-sm rounded-xl border border-dashed border-line-2 px-4 py-6 text-center">
              <div className="text-[12.5px] font-medium text-ink">No messages yet</div>
              <p className="mt-1 text-[11.5px] leading-snug text-muted">
                Send <span className="font-mono text-signal">START</span> to run the pre-trip
                checklist, or use a quick action below. Replies come from the real bot engine.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {thread.map((msg) => (
                <li
                  key={msg.id}
                  className={clsx("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={clsx(
                      "vf-rise max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap",
                      msg.direction === "outbound"
                        ? "rounded-br-sm bg-signal/15 text-ink ring-1 ring-signal/25"
                        : "rounded-bl-sm bg-surface-2 text-ink ring-1 ring-line",
                    )}
                  >
                    {msg.mediaUrl && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-muted">
                        <ImageIcon className="h-3 w-3" /> {msg.mediaUrl}
                      </div>
                    )}
                    {renderBody(msg.body)}
                    <div className="mt-1 text-right text-[9.5px] text-faint">
                      {new Date(msg.ts).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Africa/Nairobi",
                      })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-line px-4 py-3">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={busy}
                className="rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-[10.5px] text-muted transition-colors hover:border-signal/35 hover:text-signal disabled:opacity-50"
              >
                {q.length > 22 ? `${q.slice(0, 22)}…` : q}
              </button>
            ))}
            <button
              onClick={() => send("", "/receipts/upload/diesel-slip.jpg")}
              disabled={busy}
              className="rounded-lg border border-line bg-surface-2/60 px-2.5 py-1.5 text-[10.5px] text-muted transition-colors hover:border-signal/35 hover:text-signal disabled:opacity-50"
            >
              Upload receipt photo
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type as the driver would…"
              className="flex-1 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] text-ink placeholder:text-faint focus:border-signal/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !phone}
              className="grid h-10 w-10 place-items-center rounded-xl bg-signal text-void transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Bot state */}
      <div className="flex flex-col gap-4">
        <div className="vf-panel p-4">
          <h2 className="text-[12.5px] font-semibold text-ink">Bot state machine</h2>
          <div className="mt-3 space-y-2 text-[11.5px]">
            <Row label="Step" value={session?.step ?? "IDLE"} />
            <Row
              label="Checklist"
              value={
                session ? `${session.checklistIndex} of 7 items` : "—"
              }
            />
            <Row label="Answers captured" value={String(Object.keys(session?.answers ?? {}).length)} />
          </div>
          {session && Object.keys(session.answers).length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-line pt-3">
              {Object.entries(session.answers).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10.5px] text-faint">{key}</span>
                  <Pill tone={value === "fail" ? "danger" : "mint"}>{value}</Pill>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="vf-panel p-4">
          <h2 className="text-[12.5px] font-semibold text-ink">Offline-first queue</h2>
          <p className="mt-1 text-[10.5px] leading-snug text-muted">
            Dead-zone capture keeps the original timestamp and replays in order once signal returns.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-faint">Pending</div>
              <div className="vf-num text-[16px] font-semibold text-warn">{queue.pending}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-[0.1em] text-faint">Synced</div>
              <div className="vf-num text-[16px] font-semibold text-mint">{queue.synced}</div>
            </div>
          </div>
        </div>

        <div className="vf-panel p-4">
          <h2 className="text-[12.5px] font-semibold text-ink">Structured events</h2>
          <p className="mt-1 text-[10.5px] leading-snug text-muted">
            The bot does not just chat — each turn yields typed data the platform can act on.
          </p>
          <ul className="mt-3 space-y-1.5">
            {events.length === 0 ? (
              <li className="text-[11px] text-faint">No events yet.</li>
            ) : (
              events.map((e, i) => (
                <li key={`${e}-${i}`} className="flex items-start gap-2 text-[11px] text-muted">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-signal" />
                  <span className="font-mono text-[10.5px]">{e}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function describeEvent(event: { type: string; [key: string]: unknown }): string | null {
  switch (event.type) {
    case "checklist_item":
      return `checklist_item(key=${event.key}, result=${event.result})`;
    case "odometer":
      return `odometer(km=${event.km})`;
    case "receipt":
      return `receipt(media=${event.mediaUrl})`;
    case "incident":
      return `incident("${String(event.text).slice(0, 40)}")`;
    case "trip_report":
      return "trip_report(persisted to trip log)";
    case "unknown":
      return "unknown(intent not mapped)";
    default:
      return null;
  }
}

/** Renders *bold* WhatsApp formatting. */
function renderBody(body: string) {
  const parts = body.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) =>
    part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(1, -1)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5 last:border-0">
      <span className="text-faint">{label}</span>
      <span className="vf-num font-semibold text-ink">{value}</span>
    </div>
  );
}
