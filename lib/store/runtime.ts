import type {
  OfflineEnvelope,
  TripReport,
  WhatsAppMessage,
  WhatsAppSession,
} from "@/lib/domain/types";

/**
 * Mutable runtime state — things that change while the app is running rather
 * than being seeded: WhatsApp sessions, the message log, submitted trip reports
 * and the offline-first sync queue.
 *
 * Kept separate from the seeded dataset so reads of immutable domain data stay
 * cheap and side-effect free.
 */

interface RuntimeGlobal {
  __vektorFleetRuntime?: Runtime;
}

export interface Runtime {
  sessions: Map<string, WhatsAppSession>;
  messages: WhatsAppMessage[];
  tripReports: TripReport[];
  queue: OfflineEnvelope<unknown>[];
}

const globalRef = globalThis as unknown as RuntimeGlobal;

function freshRuntime(): Runtime {
  return { sessions: new Map(), messages: [], tripReports: [], queue: [] };
}

export function runtime(): Runtime {
  if (!globalRef.__vektorFleetRuntime) globalRef.__vektorFleetRuntime = freshRuntime();
  return globalRef.__vektorFleetRuntime;
}

export function resetRuntime(): void {
  globalRef.__vektorFleetRuntime = freshRuntime();
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export function logMessage(message: Omit<WhatsAppMessage, "id" | "ts"> & { ts?: string }): WhatsAppMessage {
  const full: WhatsAppMessage = {
    id: nextId("msg"),
    ts: message.ts ?? new Date().toISOString(),
    ...message,
  };
  runtime().messages.push(full);
  return full;
}

export function messagesFor(phone: string): WhatsAppMessage[] {
  return runtime()
    .messages.filter((m) => m.phone === phone)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
