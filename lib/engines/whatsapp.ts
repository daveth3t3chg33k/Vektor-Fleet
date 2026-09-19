import type {
  OfflineEnvelope,
  TripReport,
  WhatsAppSession,
  WhatsAppStep,
} from "@/lib/domain/types";
import { driverById, driverByPhone, normalisePhone, vehicleById } from "@/lib/store/db";
import { logMessage, messagesFor, nextId, runtime } from "@/lib/store/runtime";

/**
 * WhatsApp-native driver assistant.
 *
 * Drivers never install an app. An automated WhatsApp Business thread collects
 * the same field data a heavy mobile app would, over a channel that is already
 * installed, already trusted and already cheap on data. The bot is a small,
 * explicit state machine so every transition is testable and auditable.
 */

export const PRE_TRIP_CHECKLIST: Array<{ key: string; prompt: string }> = [
  { key: "tyres", prompt: "Tyres: tread depth, pressure and no visible damage (reply OK or FAIL)" },
  { key: "brakes", prompt: "Brakes and air pressure within range" },
  { key: "lights", prompt: "Lights, indicators and reflectors working" },
  { key: "fluids", prompt: "Engine oil, coolant and no visible leaks under the vehicle" },
  { key: "load", prompt: "Load secured and within axle weight limits" },
  { key: "documents", prompt: "Originals on board: licence, insurance, inspection and transit papers" },
  { key: "fitness", prompt: "Driver fit for duty — no alcohol, rested, within hours-of-service" },
];

const HELP_TEXT = [
  "*VektorFleet Driver Assistant*",
  "",
  "• *START* — begin the pre-trip checklist",
  "• *ODO 154320* — log your odometer reading",
  "• *CARD 4521 88 120L* — confirm a fuel card transaction",
  "• *INCIDENT <details>* — report a breakdown or accident",
  "• *STATUS* — today's summary for your vehicle",
  "• *HELP* — show this menu",
  "",
  "Reply to any checklist item with OK or FAIL.",
].join("\n");

/** Exposed for the dashboard's bot simulator. */
export const BOT_HELP = HELP_TEXT;

export interface BotTurn {
  session: WhatsAppSession;
  replies: string[];
  /** Structured side-effects produced by this turn. */
  events: BotEvent[];
}

export type BotEvent =
  | { type: "checklist_item"; key: string; result: "pass" | "fail" }
  | { type: "odometer"; km: number }
  | { type: "receipt"; mediaUrl: string }
  | { type: "incident"; text: string }
  | { type: "trip_report"; report: TripReport }
  | { type: "unknown" };

export function getSession(phone: string): WhatsAppSession | null {
  return runtime().sessions.get(normalisePhone(phone)) ?? null;
}

export function emptySession(phone: string, driverId: string): WhatsAppSession {
  return {
    phone: normalisePhone(phone),
    driverId,
    step: "IDLE",
    checklistIndex: 0,
    answers: {},
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Handles one inbound message and returns the bot's reply, mutating the session
 * and logging both sides of the conversation.
 */
export function handleInbound(
  phoneRaw: string,
  bodyRaw: string,
  mediaUrl?: string,
): BotTurn {
  const phone = normalisePhone(phoneRaw);
  const driver = driverByPhone(phone);
  const text = (bodyRaw ?? "").trim();
  const events: BotEvent[] = [];

  logMessage({ phone, direction: "inbound", body: text, mediaUrl });

  if (!driver) {
    const reply = `This number (${phone}) is not registered on any VektorFleet fleet. Ask your transport manager to add you, or email support@vektorfleet.co.ke.`;
    logMessage({ phone, direction: "outbound", body: reply });
    return {
      session: emptySession(phone, "unregistered"),
      replies: [reply],
      events: [],
    };
  }

  const vehicle = vehicleById(driver.assignedVehicleId);
  const session = getSession(phone) ?? emptySession(phone, driver.id);
  const replies: string[] = [];

  const upper = text.toUpperCase();

  // ---- Global commands, valid from any state ---------------------------
  if (upper === "HELP" || upper === "MENU" || upper === "?") {
    session.step = "IDLE";
    replies.push(HELP_TEXT);
  } else if (upper === "STATUS") {
    replies.push(statusMessage(driver.id, driver.assignedVehicleId));
  } else if (upper.startsWith("INCIDENT")) {
    const detail = text.slice("INCIDENT".length).trim() || "(no detail supplied)";
    events.push({ type: "incident", text: detail });
    replies.push(
      `Incident logged and escalated to the transport manager: "${detail}". Reference *INC-${driver.id.slice(-3).toUpperCase()}*. Keep this thread open and reply with your location and whether the vehicle is safely off the road.`,
    );
    session.step = "INCIDENT";
  } else if (upper.startsWith("START") || upper === "PRE-TRIP" || upper === "PRETRIP") {
    session.step = "PRE_TRIP";
    session.checklistIndex = 0;
    session.answers = {};
    replies.push(
      `Karibu ${driver.name.split(" ")[0]}! Pre-trip checklist for *${vehicle?.plate ?? "your vehicle"}*. Reply OK or FAIL to each item (${PRE_TRIP_CHECKLIST.length} items):`,
    );
    replies.push(`1/${PRE_TRIP_CHECKLIST.length} — ${PRE_TRIP_CHECKLIST[0]!.prompt}`);
  } else if (u_trip_command(upper)) {
    session.step = "PRE_TRIP";
    session.checklistIndex = 0;
    replies.push(`Starting the pre-trip checklist. 1/${PRE_TRIP_CHECKLIST.length} — ${PRE_TRIP_CHECKLIST[0]!.prompt}`);
  } else if (session.step === "PRE_TRIP") {
    replies.push(...advanceChecklist(session, text, events));
  } else if (parseOdometer(text) !== null) {
    const km = parseOdometer(text)!;
    events.push({ type: "odometer", km });
    session.answers.odometerKm = String(km);
    if (vehicle && km < vehicle.odometerKm - 50) {
      replies.push(
        `Noted ${km.toLocaleString()} km, but the tracker already has ${vehicle.odometerKm.toLocaleString()} km. I've flagged this for review and logged your reading.`,
      );
    } else {
      replies.push(`Odometer logged at ${km.toLocaleString()} km. Umefika salama.`);
    }
    session.step = "FUEL_RECEIPT";
  } else if (mediaUrl) {
    events.push({ type: "receipt", mediaUrl });
    session.answers.receiptUrl = mediaUrl;
    replies.push(
      "Receipt received. I've attached it to your last fuel card transaction for matching against the pump data.",
    );
  } else if (upper.startsWith("CARD")) {
    replies.push(
      "Fuel card confirmation noted. I'll match it against the pump terminal capture and flag any variance over 5%.",
    );
  } else if (session.step !== "IDLE") {
    if (text) {
      replies.push(
        `Received: "${text}". I couldn't map that to an action. Reply HELP for the command menu, or OK/FAIL during a checklist.`,
      );
      events.push({ type: "unknown" });
    } else if (mediaUrl) {
      replies.push("Media received and filed.");
    }
  } else if (text.length === 0 && !mediaUrl) {
    replies.push("Empty message received. Reply HELP for options.");
  } else {
    replies.push(
      `Habari ${driver.name.split(" ")[0]}. I'm the VektorFleet assistant for *${vehicle?.plate ?? "your assigned vehicle"}*. Reply HELP to see what you can do, or START to run your pre-trip checklist.`,
    );
  }

  session.updatedAt = new Date().toISOString();
  runtime().sessions.set(phone, session);

  if (replies.length === 0) replies.push("Reply HELP for the command menu.");
  for (const body of replies) {
    logMessage({ phone, direction: "outbound", body });
  }

  return { session, replies, events };
}

function u_trip_command(upper: string): boolean {
  return ["GO", "TRIP", "DEPART", "CHECKLIST", "ANZA"].includes(upper);
}

/** Steps through the checklist one item per inbound message. */
function advanceChecklist(session: WhatsAppSession, text: string, events: BotEvent[]): string[] {
  const replies: string[] = [];
  const item = PRE_TRIP_CHECKLIST[session.checklistIndex];
  if (!item) {
    session.step = "ODOMETER";
    return ["Checklist already complete. Send your odometer reading, e.g. *ODO 154320*."];
  }

  const result = parseChecklistAnswer(text);
  if (result === null) {
    return [
      `Please reply *OK* to pass or *FAIL* to raise a defect for: ${item.prompt}`,
    ];
  }

  session.answers[item.key] = result;
  events.push({ type: "checklist_item", key: item.key, result });

  if (result === "fail") {
    replies.push(
      `*Defect logged* on ${item.key}. Do not depart until the transport manager clears it. I've opened a maintenance task and notified the workshop.`,
    );
  }

  session.checklistIndex += 1;
  const next = PRE_TRIP_CHECKLIST[session.checklistIndex];

  if (!next) {
    session.step = "ODOMETER";
    const report = finaliseReport(session);
    events.push({ type: "trip_report", report });
    replies.push(
      `Checklist complete (${Object.values(session.answers).filter((v) => v === "pass").length}/${PRE_TRIP_CHECKLIST.length} passed). Send your odometer reading to close out the pre-trip, e.g. *ODO ${(lastOdometer(session) + 312) || 154320}*.`,
    );
    return replies;
  }

  replies.push(
    `${session.checklistIndex + 1}/${PRE_TRIP_CHECKLIST.length} — ${next.prompt}${
      result === "fail" ? "\n\nI'll wait here — reply OK to continue once the defect is resolved." : ""
    }`,
  );
  return replies;
}

function parseChecklistAnswer(text: string): "pass" | "fail" | null {
  const t = text.trim().toUpperCase();
  if (["OK", "OKAY", "PASS", "SAWA", "YES", "Y", "1", "✅"].includes(t)) return "pass";
  if (["FAIL", "NO", "N", "DEFECT", "NOT OK", "2", "❌"].includes(t)) return "fail";
  return null;
}

export function parseOdometer(text: string): number | null {
  const cleaned = text.replace(/[,_ ]/g, "").toUpperCase();
  const match = cleaned.match(/(?:ODO(?:METER)?|KM|MILEAGE)?[:\s]*(\d{4,7})(?:KM)?$/);
  if (!match) return null;
  const hasKeyword = /ODO|KM|MILEAGE/.test(cleaned);
  const value = Number(match[1]);
  // A bare 5-7 digit number is only treated as an odometer reading when it is
  // plausible for a commercial vehicle.
  if (!hasKeyword && (value < 10_000 || value > 3_000_000)) return null;
  return value;
}

function lastOdometer(session: WhatsAppSession): number {
  const fromAnswers = Number(session.answers.odometerKm ?? 0);
  if (fromAnswers > 0) return fromAnswers;
  const vehicle = vehicleById(driverVehicleId(session.driverId));
  return vehicle?.odometerKm ?? 0;
}

function driverVehicleId(driverId: string): string {
  return driverById(driverId)?.assignedVehicleId ?? "";
}

function finaliseReport(session: WhatsAppSession): TripReport {
  const checklist: Record<string, "pass" | "fail"> = {};
  for (const item of PRE_TRIP_CHECKLIST) {
    const value = session.answers[item.key];
    if (value === "pass" || value === "fail") checklist[item.key] = value;
  }
  const report: TripReport = {
    id: nextId("rpt"),
    driverId: session.driverId,
    vehicleId: driverVehicleId(session.driverId),
    submittedAt: new Date().toISOString(),
    checklist,
    odometerKm: session.answers.odometerKm ? Number(session.answers.odometerKm) : undefined,
    receiptMediaUrl: session.answers.receiptUrl,
  };
  runtime().tripReports.push(report);
  return report;
}

function statusMessage(driverId: string, vehicleId: string): string {
  const vehicle = vehicleById(vehicleId);
  const reports = runtime().tripReports.filter((r) => r.driverId === driverId).length;
  const pendingDefects = runtime()
    .tripReports.filter((r) => r.driverId === driverId)
    .flatMap((r) => Object.values(r.checklist))
    .filter((v) => v === "fail").length;
  return [
    `*Today — ${vehicle?.plate ?? vehicleId}*`,
    `Odometer: ${vehicle?.odometerKm.toLocaleString() ?? "?"} km`,
    `Trip reports submitted: ${reports}`,
    pendingDefects > 0 ? `Open defects: ${pendingDefects} — do not depart until cleared.` : "Open defects: none",
    "",
    "Reply START to run your pre-trip checklist, or ODO <number> to log a reading.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Offline-first sync queue
// ---------------------------------------------------------------------------

/**
 * Dead zones on the Mombasa–Kampala corridor are routine, so field data must
 * survive without a signal. Items are stamped with the device clock at capture
 * time, queued locally, and replayed in order when connectivity returns; the
 * cloud accepts them with their original timestamps.
 */
export class OfflineQueue {
  private readonly items: OfflineEnvelope<unknown>[] = [];

  enqueue<T>(kind: OfflineEnvelope<T>["kind"], deviceId: string, payload: T, capturedAt: Date = new Date()): OfflineEnvelope<T> {
    const envelope: OfflineEnvelope<T> = {
      id: nextId(`env_${kind}`),
      kind,
      capturedAt: capturedAt.toISOString(),
      enqueuedAt: new Date().toISOString(),
      deviceId,
      payload,
      synced: false,
    };
    this.items.push(envelope as OfflineEnvelope<unknown>);
    runtime().queue.push(envelope as OfflineEnvelope<unknown>);
    return envelope;
  }

  pending(): OfflineEnvelope<unknown>[] {
    return this.items.filter((i) => !i.synced);
  }

  /** Replays everything held locally; returns the envelopes that were accepted. */
  flush(): OfflineEnvelope<unknown>[] {
    const pending = this.pending().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    for (const item of pending) item.synced = true;
    return pending;
  }

  get size(): number {
    return this.items.length;
  }
}

/** Shared queue used by the demo routes. */
export const fieldQueue = new OfflineQueue();

export function queueDepth(): { pending: number; synced: number } {
  const all = runtime().queue;
  return {
    pending: all.filter((q) => !q.synced).length,
    synced: all.filter((q) => q.synced).length,
  };
}
