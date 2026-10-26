import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ccLimit, createBatteryTiers, createBurst, createCcSessions, burstLabel } from "../lib/notes";
import { VOICE_THINKING, PROTRUSION } from "../plugin.fixtures";
import type { Media } from "../bridge";

// 11 volume indicator / 13 two sessions / 15 quota / 16 transcript + music / 26 battery / 33 notification burst / 43 Why?
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
// With the fake clock on (vi.useFakeTimers at the start of the test) there is no real waiting: same result under load; a 16 ms step = one frame, React work (effects, timers) is flushed after every step
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 80) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const center = () => document.querySelector<HTMLElement>(".islandCenter")!;
const MUSIC: Media = { title: "Song", artist: "Artist", album: "A", app: "Spotify", art: null, playing: true, positionMs: 10000, positionAt: Date.now(), durationMs: 200000, canNext: true, canPrevious: true, canSeek: true };
const LIVE = { ...PROTRUSION, title: "Claude · Thinking…", icon: "code", actions: [] };
const batt = (percent: number, powered = false) => fakeBridge.setBattery({ percent, charging: powered, plugged: powered, remaining: null });

describe("pure logic", () => {
  it("battery: once at 20%, once at 10%, resets when plugged in, jumping straight to 8% yields only 10", () => {
    const t = createBatteryTiers();
    expect([t.feed(30, false), t.feed(20, false), t.feed(19, false), t.feed(10, false), t.feed(9, false)]).toEqual([null, 20, null, 10, null]);
    expect(t.feed(50, true)).toBeNull();
    expect(t.feed(20, false)).toBe(20);
    const u = createBatteryTiers();
    expect([u.feed(8, false), u.feed(7, false), u.feed(null, false)]).toEqual([10, null, null]);
  });
  it("burst: the first list is the baseline; 6 new within 5 s = one peek; spread over more than 5 s yields none", () => {
    const n = (i: number) => ({ id: "n" + i, app: i % 2 ? "Discord" : "Outlook" });
    const b = createBurst();
    expect(b.feed([n(100)], 0)).toBeNull();
    const six = [1, 2, 3, 4, 5, 6].map(n);
    expect(b.feed(six.slice(0, 5), 1000)).toBeNull();
    expect(b.feed(six, 2000)).toEqual({ n: 6, apps: ["Discord", "Outlook"] });
    expect(b.feed(six, 2500)).toBeNull();
    const c = createBurst(); c.feed([], 0);
    expect([1, 2, 3, 4, 5, 6].map((i) => c.feed([n(i)], i * 2000))).toEqual([null, null, null, null, null, null]);
  });
  it("label: two names and an ellipsis, no names when hidden", () => {
    expect(burstLabel(6, ["Discord", "Outlook", "Teams"])).toBe("6 new notifications: Discord, Outlook…");
    expect(burstLabel(6, ["Discord"], true)).not.toContain("Discord");
  });
  it("session count: starts minus ends; resets when stale", () => {
    const s = createCcSessions(1000);
    expect([s.feed({ kind: "session_start" }, 0), s.feed({ kind: "session_start" }, 10), s.feed({ kind: "pre_tool" }, 20), s.feed({ kind: "session_end" }, 30), s.feed({ kind: "session_end" }, 40), s.feed({ kind: "session_end" }, 50)]).toEqual([1, 2, 2, 1, 0, 0]);
    s.feed({ kind: "session_start" }, 100);
    expect(s.feed({ kind: "session_start" }, 5000)).toBe(1);
  });
  it("session label (sid): tracked by id, keeps the last tool, session_end removes it, a silent one drops out", () => {
    const s = createCcSessions(1000, 5000);
    expect(s.feed({ kind: "session_start", sid: "aaaaaaaa" }, 0)).toBe(1);
    expect(s.feed({ kind: "session_start", sid: "bbbbbbbb" }, 10)).toBe(2);
    expect(s.feed({ kind: "pre_tool", tool: "Bash", sid: "aaaaaaaa" }, 20)).toBe(2);
    expect(s.feed({ kind: "post_tool", sid: "aaaaaaaa" }, 30)).toBe(2);
    expect(s.list(30)).toEqual([{ sid: "aaaaaaaa", agent: "claude", tool: "Bash", at: 30, origin: null }, { sid: "bbbbbbbb", agent: "claude", tool: null, at: 10, origin: null }]);
    expect(s.count(5020)).toBe(1); // b stayed silent for 5 s and dropped out
    expect(s.feed({ kind: "session_end", sid: "aaaaaaaa" }, 5100)).toBe(0);
    expect(s.feed({ kind: "stop", sid: "bbbbbbbb" }, 5200)).toBe(1); // a dropped session comes back with a new event
    expect(s.feed({ kind: "session_start" }, 5300)).toBe(2); // one without a sid (main assistant) is counted by the counter
  });
});

describe("26 battery tiers (island)", () => {
  it("25% silent, 20% once, Esc silences, 10% again, resets when plugged in", { timeout: 20000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => batt(25));
    await settle();
    expect(center().textContent).not.toContain("Battery");
    act(() => batt(20));
    await settle();
    expect(center().textContent).toContain("Battery 20%");
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(220);
    expect(center().textContent).not.toContain("Battery");
    act(() => batt(19));
    await settle();
    expect(center().textContent).not.toContain("Battery"); // the same tier does not show a second time
    act(() => batt(10));
    await settle();
    expect(center().textContent).toContain("Battery 10%");
    act(() => batt(12, true));
    await settle(220);
    expect(center().textContent).not.toContain("Battery 10%");
    act(() => batt(19));
    await settle(3300); // the plug-in peek (3 s) goes away first
    expect(center().textContent).toContain("Battery 19%"); // earns the tier again after charging
  });
  it("20% drops to the bubble below the live task, 10% rises above the live task", { timeout: 20000 }, async () => {
    fakeBridge.setSurfaces({ protrusion: LIVE });
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => batt(20));
    await settle(300);
    expect(center().textContent).toContain("Claude");
    expect(document.querySelector(".sideBtn")?.getAttribute("aria-label")).toContain("Battery 20%");
    act(() => batt(10));
    await settle(300);
    expect(center().textContent).toContain("Battery 10%");
  });
});

describe("33 notification burst", () => {
  it("6 notifications within 5 s become a single peek; clicking dismisses the peek", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { for (let i = 1; i <= 6; i++) fakeBridge.pushNotice({ id: "y" + i, app: i % 2 ? "Discord" : "Outlook", title: "t" + i }); });
    await settle(300);
    expect(center().textContent).toContain("6 new notifications: Discord, Outlook");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await settle(300);
    expect(center().textContent).not.toContain("6 new notifications");
  });
  it("5 notifications are not enough; no app name while locked", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { for (let i = 1; i <= 5; i++) fakeBridge.pushNotice({ id: "z" + i, app: "Discord", title: "t" }); });
    await settle(300);
    expect(center().textContent).not.toContain("new notifications");
    act(() => fakeBridge.setLocked(true));
    act(() => fakeBridge.pushNotice({ id: "z6", app: "Discord", title: "t" }));
    await settle(300);
    expect(center().textContent).toContain("New notifications");
    expect(center().textContent).not.toContain("Discord");
  });
});

describe("15 usage limit reached", () => {
  it("stop_failure + rate_limit: 'Usage limit reached' (no reset time); OK dismisses it; other reasons do not show it", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "server_error" }));
    await settle(200);
    expect(center().textContent).not.toContain("Usage limit reached");
    act(() => fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "rate_limit" }));
    await settle(300);
    expect(center().textContent).toContain("Usage limit reached");
    expect(center().textContent).not.toMatch(/Resets/);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await settle(300);
    expect(center().textContent).not.toContain("Usage limit reached");
  });
});

describe("F3 plan limit", () => {
  it("ccLimit: on with rate_limit, off with the next stop or Claude Code's auto-resume; other events keep it", () => {
    expect(ccLimit(false, { kind: "stop_failure", reason: "rate_limit" })).toBe(true);
    expect(ccLimit(false, { kind: "stop_failure", reason: "server_error" })).toBe(false);
    for (const e of [{ kind: "prompt" }, { kind: "session_end" }, { kind: "pre_tool" }, { kind: "notification", reason: "idle_prompt" }]) expect(ccLimit(true, e)).toBe(true);
    expect(ccLimit(true, { kind: "stop" })).toBe(false);
    expect(ccLimit(true, { kind: "notification", reason: "quota_auto_resume_fired" })).toBe(false);
  });
  it("the sessions list shows 'Usage limit reached' until the limit lifts", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start", sid: "1a2b3c4d" }); fakeBridge.emit("cc_event", { kind: "session_start", sid: "5e6f7a8b" }); });
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 sessions/ }));
    const list = () => screen.getByRole("group", { name: "Claude Code sessions" }).textContent!;
    expect(list()).not.toContain("Usage limit reached");
    act(() => fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "rate_limit", sid: "1a2b3c4d" }));
    await settle(100);
    expect(list()).toContain("Usage limit reached");
    act(() => fakeBridge.emit("cc_event", { kind: "notification", reason: "quota_auto_resume_fired", sid: "1a2b3c4d" }));
    await settle(100);
    expect(list()).not.toContain("Usage limit reached");
  });
});

describe("13 two sessions", () => {
  it("two session_start: an 'N sessions' chip; clicking opens the list; one session_end removes the chip", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cc_event", { kind: "session_start" }));
    await settle(100);
    expect(document.querySelector(".sessionChip")).toBeNull();
    act(() => fakeBridge.emit("cc_event", { kind: "session_start" }));
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 sessions/ }));
    expect(screen.getByRole("group", { name: "Claude Code sessions" }).textContent).toContain("2 Claude Code sessions open");
    act(() => fakeBridge.emit("cc_event", { kind: "session_end" }));
    await settle(100);
    expect(document.querySelector(".sessionChip")).toBeNull();
  });
  it("sessions are listed as 'Session 1', 'Session 2' with their last tools", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start", sid: "1a2b3c4d" }); fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "Grep", sid: "5e6f7a8b" }); });
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 sessions/ }));
    const list = screen.getByRole("group", { name: "Claude Code sessions" }).textContent!;
    expect(list).toContain("Session 1: event");
    expect(list).toContain("Session 2: Grep");
    expect(list).not.toContain("can't be told apart");
    expect(list).not.toContain("1a2b3c4d");
  });
  it("a session started in Claude Desktop or Cursor gets a small label; a terminal one shows none", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start", sid: "1a2b3c4d", origin: "desktop" }); fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "Grep", sid: "5e6f7a8b", origin: "terminal" }); fakeBridge.emit("cc_event", { kind: "stop", sid: "1a2b3c4d" }); });
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 sessions/ }));
    const rows = [...screen.getByRole("group", { name: "Claude Code sessions" }).querySelectorAll(".sideRow")].map((r) => r.textContent);
    expect(rows.find((r) => r?.includes("Session 1"))).toMatch(/Desktop$/); // kept from session_start
    expect(rows.find((r) => r?.includes("Session 2"))).not.toMatch(/Terminal|Desktop/);
  });
  it("mixed agents: each row names its agent with its accent dot", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start", sid: "1a2b3c4d" }); fakeBridge.emit("cc_event", { agent: "codex", kind: "pre_tool", tool: "Bash", sid: "5e6f7a8b" }); });
    await settle(100);
    fireEvent.click(screen.getByRole("button", { name: /2 sessions/ }));
    const group = screen.getByRole("group", { name: "Agent sessions" });
    expect(group.textContent).toContain("2 agent sessions open");
    expect(group.textContent).toContain("Claude Code · Session 1: event");
    expect(group.textContent).toContain("Codex · Session 2: Bash");
    expect(group.querySelectorAll(".agentDot")).toHaveLength(2);
  });
  it("the chip does not change the island center box", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const before = center().style.width;
    act(() => { fakeBridge.emit("cc_event", { kind: "session_start" }); fakeBridge.emit("cc_event", { kind: "session_start" }); });
    await settle(100);
    expect(document.querySelector(".sessionChip")).not.toBeNull();
    expect(center().style.width).toBe(before);
  });
});

describe("43 Why?", () => {
  it("error card: Why? opens the details; details hidden while locked", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: "error", err: "Bash" }} />);
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByRole("note").textContent).toContain("Bash failed");
  });
  it("no path or tool name is visible while locked", { timeout: 20000 }, async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: "error", err: "C:\\secret\\path.txt" }} />);
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByRole("note").textContent).toBe("Details are hidden while locked.");
    expect(document.body.textContent).not.toContain("secret\\path");
  });
});

describe("11 volume indicator while Claude is live", () => {
  it("the OSD borrows the center for 1.8 s, Claude returns; the bubble stays in place", { timeout: 20000 }, async () => {
    fakeBridge.setSurfaces({ protrusion: LIVE });
    fakeBridge.setMedia(MUSIC);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle(300);
    expect(center().textContent).toContain("Claude");
    const bubble = document.querySelector(".sideBtn")?.getAttribute("aria-label");
    expect(bubble).toBeTruthy();
    act(() => fakeBridge.volumeOsd({ percent: 40, muted: false, device: null }));
    await settle(200);
    expect(center().textContent).toContain("Volume");
    expect(document.querySelector(".sideBtn")?.getAttribute("aria-label")).toBe(bubble);
    for (let i = 0; i < 20 && center().textContent!.includes("Volume"); i++) await settle(250); // timers can lag under load
    expect(center().textContent).toContain("Claude");
    expect(center().textContent).not.toContain("Volume");
  });
});

describe("11 volume indicator keeps the strip's right side still", () => {
  it("while the island clock is centered, a volume change doesn't hand the clock back to the strip (no time jumping next to the date)", async () => {
    const said: boolean[] = [];
    const ch = new BroadcastChannel("notch-center-clock");
    ch.onmessage = (e) => { if (typeof e.data === "boolean") said.push(e.data); };
    fakeBridge.setPlugins([]);
    try {
      render(<Island monitor="m1" init={{ view: null }} />);
      await settle(300);
      expect(said.at(-1)).toBe(true); // no assistant: the island shows the clock, the strip only the date
      const before = said.length;
      act(() => fakeBridge.volumeOsd({ percent: 40, muted: false, device: null }));
      await settle(200);
      expect(center().textContent).toContain("Volume");
      expect(said.slice(before)).not.toContain(false);
    } finally { ch.close(); }
  });
});

describe("11b Bluetooth and charger peeks keep the clock too", () => {
  for (const [name, fire] of [
    ["Bluetooth", () => fakeBridge.emit("bluetooth_connected", { name: "Buds Pro", battery: 80 })],
    ["charger", () => batt(50, true)],
  ] as const) {
    it(`${name}: no hand-over to the strip and back`, async () => {
      const said: boolean[] = [];
      const ch = new BroadcastChannel("notch-center-clock");
      ch.onmessage = (e) => { if (typeof e.data === "boolean") said.push(e.data); };
      fakeBridge.setPlugins([]);
      act(() => batt(50));
      try {
        render(<Island monitor="m1" init={{ view: null }} />);
        await settle(300);
        expect(said.at(-1)).toBe(true);
        const before = said.length, rest = center().textContent;
        act(() => fire());
        await settle(300);
        expect(center().textContent).not.toBe(rest); // the peek is up
        expect(said.slice(before)).not.toContain(false);
      } finally { ch.close(); }
    });
  }
});

describe("16 Hey Compass transcript", () => {
  it("music sits in the side bubble while the transcript is on the main strip", { timeout: 20000 }, async () => {
    fakeBridge.setSurfaces({ protrusion: VOICE_THINKING });
    fakeBridge.setMedia(MUSIC);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle(300);
    expect(document.querySelector(".sideBtn")?.getAttribute("aria-label")).toContain("Playing");
    expect(center().textContent).not.toContain("Playing");
  });
});
