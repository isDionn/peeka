import { describe, expect, it } from "vitest";
import { createFakeBridge } from "../bridge.fake";
import type { Alert } from "../bridge";
import { ageLabel, liveAlerts, nextExpiry, pickProtrusion, sortAlerts } from "../lib/alerts";

const a = (id: string, over: Partial<Alert> = {}): Alert => ({ id, title: id, subtitle: null, icon: null, color: null, progress: null, priority: 50, action: null, style: "standard", expand: false, source: "api", kind: "alert", expiresAt: null, updatedAt: 100, review: null, ...over });

describe("alert list rules", () => {
  it("priority high to low, newer first on ties; a system alert (100) outranks a script (<=99)", () => {
    const l = sortAlerts([a("old", { updatedAt: 1 }), a("new", { updatedAt: 9 }), a("volume", { priority: 100, source: "volume" }), a("important", { priority: 90 })]);
    expect(l.map((x) => x.id)).toEqual(["volume", "important", "new", "old"]);
  });
  it("expired ones drop, ones without expiry stay", () => {
    const l = [a("short", { expiresAt: 3000 }), a("forever")];
    expect(liveAlerts(l, 2500).map((x) => x.id)).toEqual(["short", "forever"]);
    expect(liveAlerts(l, 3001).map((x) => x.id)).toEqual(["forever"]);
    expect(nextExpiry(l, 1500)).toBe(1500);
    expect(nextExpiry([a("x")], 0)).toBeNull();
  });
  it("peek: only expand ones that were not seen yet, highest priority", () => {
    const l = sortAlerts([a("a", { expand: true, priority: 10 }), a("b", { expand: true, priority: 80 }), a("c", { priority: 99 })]);
    expect(pickProtrusion(l, new Set())?.id).toBe("b");
    expect(pickProtrusion(l, new Set(["b"]))?.id).toBe("a");
    expect(pickProtrusion(l, new Set(["a", "b"]))).toBeNull();
  });
  it("age label", () => {
    expect([5, 180, 7200, 200000].map(ageLabel)).toEqual(["now", "3m", "2h", "2d"]);
  });
  it("fake bridge: same id replaces, dismiss and clear emit alerts_changed", async () => {
    const b = createFakeBridge();
    const seen: unknown[] = [];
    await b.on("alerts_changed", () => seen.push(1));
    const n = (await b.call("list_alerts")).items.length;
    b.pushAlert({ id: "disk", title: "Disk %95", priority: 70 });
    const l = (await b.call("list_alerts")).items;
    expect(l.length).toBe(n);
    expect(l[0].title).toBe("Disk %95");
    await b.call("dismiss_alert", { id: "disk" });
    expect((await b.call("list_alerts")).items.some((x) => x.id === "disk")).toBe(false);
    await b.call("clear_alerts");
    expect((await b.call("list_alerts")).items).toEqual([]);
    expect(seen.length).toBe(3);
  });
});
