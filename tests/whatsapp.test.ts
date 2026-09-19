import { beforeEach, describe, expect, it } from "vitest";
import { handleInbound, OfflineQueue, parseOdometer, PRE_TRIP_CHECKLIST } from "@/lib/engines/whatsapp";
import { getDataset } from "@/lib/store/db";
import { resetRuntime } from "@/lib/store/runtime";

const DAY = 24 * 60 * 60 * 1000;

describe("whatsapp driver assistant", () => {
  let phone: string;

  beforeEach(() => {
    resetRuntime();
    phone = getDataset().drivers[0]!.phone;
  });

  it("greets a registered driver with a useful menu", () => {
    const turn = handleInbound(phone, "hello");
    expect(turn.replies).toHaveLength(1);
    expect(turn.replies[0]).toContain("VektorFleet");
    expect(turn.session.step).toBe("IDLE");
  });

  it("refuses an unregistered number without creating a driver session", () => {
    const turn = handleInbound("+254799000111", "hello");
    expect(turn.replies[0]).toContain("not registered");
    expect(turn.events).toHaveLength(0);
  });

  it("runs the whole pre-trip checklist and files a trip report", () => {
    handleInbound(phone, "START");
    let last = handleInbound(phone, "OK");
    for (let i = 1; i < PRE_TRIP_CHECKLIST.length; i++) {
      last = handleInbound(phone, "OK");
    }
    const report = last.events.find((e) => e.type === "trip_report");
    expect(report).toBeDefined();
    expect(last.session.step).toBe("ODOMETER");
    if (report && report.type === "trip_report") {
      expect(Object.keys(report.report.checklist)).toHaveLength(PRE_TRIP_CHECKLIST.length);
      expect(Object.values(report.report.checklist).every((v) => v === "pass")).toBe(true);
    }
  });

  it("raises a defect instead of passing when the driver replies FAIL", () => {
    handleInbound(phone, "START");
    const turn = handleInbound(phone, "FAIL");
    expect(turn.replies[0]).toContain("Defect logged");
    expect(turn.events[0]).toEqual({ type: "checklist_item", key: "tyres", result: "fail" });
  });

  it("re-prompts when a checklist answer is neither OK nor FAIL", () => {
    handleInbound(phone, "START");
    const turn = handleInbound(phone, "maybe");
    expect(turn.replies[0]).toContain("Please reply");
    expect(turn.session.checklistIndex).toBe(0);
  });

  it("accepts Swahili acknowledgements", () => {
    const turn = handleInbound(phone, "ANZA");
    expect(turn.session.step).toBe("PRE_TRIP");
    const next = handleInbound(phone, "SAWA");
    expect(next.events[0]).toMatchObject({ type: "checklist_item", result: "pass" });
  });

  it("logs an odometer reading and flags a regression against the tracker", () => {
    const vehicle = getDataset().vehicles[0]!;
    const suspicious = handleInbound(phone, `ODO ${vehicle.odometerKm - 5000}`);
    expect(suspicious.events[0]).toMatchObject({ type: "odometer" });
    expect(suspicious.replies[0]).toContain("flagged this for review");
  });

  it("records a receipt photo as a structured event", () => {
    const turn = handleInbound(phone, "", "/receipts/upload/slip.jpg");
    expect(turn.events[0]).toEqual({ type: "receipt", mediaUrl: "/receipts/upload/slip.jpg" });
  });

  it("escalates an incident", () => {
    const turn = handleInbound(phone, "INCIDENT blowout near Mariakani");
    expect(turn.events[0]).toMatchObject({ type: "incident" });
    expect(turn.replies[0]).toContain("escalated");
  });

  it("parses odometer readings in several formats but ignores implausible numbers", () => {
    expect(parseOdometer("ODO 154320")).toBe(154320);
    expect(parseOdometer("odometer: 154,320")).toBe(154320);
    expect(parseOdometer("154320 km")).toBe(154320);
    expect(parseOdometer("123")).toBeNull();
    expect(parseOdometer("hello")).toBeNull();
    expect(parseOdometer("99999999")).toBeNull();
  });
});

describe("offline-first queue", () => {
  beforeEach(() => resetRuntime());

  it("holds items stamped with device capture time, then replays them in order", () => {
    const queue = new OfflineQueue();
    const first = queue.enqueue("telemetry", "dev_1", { speed: 40 }, new Date(Date.now() - 3 * DAY));
    const second = queue.enqueue("trip_report", "dev_1", { odometer: 100 }, new Date(Date.now() - 2 * DAY));

    expect(first.synced).toBe(false);
    expect(queue.pending()).toHaveLength(2);

    const replayed = queue.flush();
    expect(replayed.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(queue.pending()).toHaveLength(0);
    expect(queue.size).toBe(2);

    // The capture timestamp survives the dead zone, which is the whole point.
    expect(Date.parse(replayed[0]!.capturedAt)).toBeLessThan(Date.parse(replayed[1]!.capturedAt));
  });

  it("is idempotent — a second flush has nothing to send", () => {
    const queue = new OfflineQueue();
    queue.enqueue("telemetry", "dev_2", { speed: 12 });
    expect(queue.flush()).toHaveLength(1);
    expect(queue.flush()).toHaveLength(0);
  });
});
