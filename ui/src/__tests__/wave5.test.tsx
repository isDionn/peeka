import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SECRET, fakeBridge } from "../bridge.fake";
import { bridge } from "../bridge";
import { Island } from "../components/Island";
import { ShelfBump, ShelfCard } from "../components/Extras";
import { ContextMenu } from "../components/Menus";
import { NotificationList } from "../components/Notifications";
import { ClipboardView } from "../components/Pano";
import { ApprovalCenter, Lead, ProtrusionBump, ProtrusionCenter } from "../components/Plugin";
import { Shell } from "../components/Shell";
import { AppIcon } from "../components/common";
import { clearPreviewCache } from "../components/WindowPreview";
import { FIRST_KEY } from "../lib/firstRun";
import { moodOf } from "../lib/plugin";
import { onX, sendX, type XMsg } from "../lib/xwin";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { MOODS } from "../mascot";
import { Ghost } from "../mascot/ghost";
import { APPROVAL_LOW, OTHER, PLUGINS, PROTRUSION, SURFACES_FULL, COMPASS } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  clearPreviewCache();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  resetMascotRegistry();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-color");
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);
const center = () => document.querySelector<HTMLElement>(".islandCenter")!;
/** During the cross-fade the old content stays in the DOM for 140 ms; this picks the current one. */
const now = () => center().querySelector<HTMLElement>(".islandMascot:not(.leaving)")!;
const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-clip="${id}"]`);

describe("security: if clip_visible fails the password row is never drawn", () => {
  const mockVisible = (impl: () => Promise<boolean>) => {
    const orig = fakeBridge.call.bind(fakeBridge) as (c: string, a?: unknown) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, args?: { on?: boolean }) => (cmd === "clip_visible" && args?.on ? impl() : orig(cmd, args))) as never);
  };
  it("Rust returns false: no password row, the others are there, the reason is written", async () => {
    mockVisible(async () => false);
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    expect(rowOf("c6")).toBeNull();
    expect(document.body.textContent).not.toContain("Bitwarden");
    expect(document.body.textContent).toContain("Passwords hidden");
  });
  it("the command is rejected (error): likewise no password", async () => {
    mockVisible(async () => { throw "denied"; });
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    expect(rowOf("c6")).toBeNull();
  });
  it("no row is drawn until the answer arrives (password included)", async () => {
    mockVisible(() => new Promise(() => undefined));
    render(<ClipboardView />);
    await settle();
    expect(rowOf("c6")).toBeNull();
    expect(rowOf("c9")).toBeNull();
  });
  it("returns true: the password row is drawn masked, no plain text", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    expect(rowOf("c6")).not.toBeNull();
    expect(document.body.textContent).not.toContain(FAKE_SECRET);
  });
});

describe("live transcript: speaker label (decision 18)", () => {
  const item = { ...PROTRUSION, liveText: { streamId: "s9" }, icon: "mic" };
  it("when a speaker arrives the line starts with a label; with no speaker there is no label", async () => {
    const { container } = render(<ProtrusionBump item={item} />);
    await settle();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "s9", text: "tomorrow morning at nine with the team" }));
    expect(container.querySelector(".liveText")!.textContent).toBe("tomorrow morning at nine with the team");
    expect(container.querySelector(".who")).toBeNull();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "s9", text: "tomorrow morning at nine with the team", speaker: "You" }));
    const live = container.querySelector(".liveText")!;
    expect(live.querySelector(".who")!.textContent).toBe("You");
    expect(live.firstElementChild!.className).toBe("who"); // before the text
    expect(live.textContent).toBe("Youtomorrow morning at nine with the team");
  });
  it("the label is plain text (HTML-escaped) and truncated", async () => {
    const { container } = render(<ProtrusionBump item={item} />);
    await settle();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "s9", text: "x", speaker: "<b>You</b>" + "a".repeat(80) }));
    expect(container.querySelector(".liveText b")).toBeNull();
    expect(container.querySelector(".who")!.textContent!.length).toBeLessThanOrEqual(24);
  });
});

describe("mascot", () => {
  beforeEach(() => { vi.spyOn(bridge, "now").mockReturnValue(new Date(new Date().setHours(14))); }); // daytime: the mascot asserts don't depend on the wall clock (M1 makes a calm ghost drowsy at night)
  it("state name -> mascot mood; every mood is in the table", () => {
    expect(moodOf("listening")).toBe("listening");
    expect(moodOf("thinking")).toBe("thinking");
    expect(moodOf("speaking")).toBe("speaking");
    expect(moodOf("approval")).toBe("approval");
    expect(moodOf("done")).toBe("done");
    expect(moodOf("error")).toBe("error");
    expect(moodOf("undefined-state")).toBe("idle");
    for (const h of ["ready", "listening", "thinking", "speaking", "approval", "serious", "error", "done", "music", "drowsy", "sleeping", "quiet", "tired", "attention"]) expect(MOODS[moodOf(h)]).toBeDefined();
  });
  it("a question approval gets the 'question' mascot, a permission approval 'approval' (real source: the approval kind)", () => {
    const q = render(<ApprovalCenter a={{ ...APPROVAL_LOW, kind: "question" }} />);
    expect(q.container.querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("question"); q.unmount(); resetMascotRegistry();
    const c = render(<ApprovalCenter a={{ ...APPROVAL_LOW, kind: "command" }} />);
    expect(c.container.querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("approval");
    expect([moodOf("searching"), moodOf("question"), moodOf("ratelimit"), moodOf("dizzy")]).toEqual(["searching", "question", "ratelimit", "dizzy"]);
  });
  it("progress bar: the main assistant's mascot rides the bar (one mascot, no second one in the middle row); without progress the bar is unchanged", () => {
    const item = { ...PROTRUSION, progress: 0.4, mascot: "thinking" };
    const a = render(<><ProtrusionCenter item={item} /><ProtrusionBump item={item} /></>);
    expect(a.container.querySelectorAll(".mascot").length).toBe(1);
    expect(a.container.querySelector(".progressMascot .rider .mascot")).not.toBeNull();
    expect(a.container.querySelector<HTMLElement>(".progressMascot")!.style.getPropertyValue("--y")).toBe("0.4");
    a.unmount(); resetMascotRegistry();
    const b = render(<ProtrusionBump item={{ ...PROTRUSION, progress: 0.4, mascot: null }} />);
    expect(b.container.querySelector(".progressMascot")).toBeNull(); expect(b.container.querySelector(".miniProgress")).not.toBeNull();
  });
  it("Lead: a mascot for the main assistant (with size and mood), otherwise an initials tile", () => {
    const main = render(<Lead plugin={COMPASS} mascot="listening" size={56} />);
    const m = main.container.querySelector<HTMLElement>(".mascot")!;
    expect(m.dataset.mood).toBe("listening");
    expect(m.dataset.size).toBe("56");
    main.unmount();
    const other = render(<Lead plugin={OTHER} mascot="listening" />);
    expect(other.container.querySelector(".mascot")).toBeNull();
    expect(other.container.querySelector(".initials")).not.toBeNull();
  });
  it("idle: with Compass connected, mascot + 'Compass ready' + approval and notification counts; no clock in the center", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: null }); // the attention budget did not turn the approval into a peek: only the count on the strip
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const c = center();
    expect(c.querySelector(".mascot")!.getAttribute("data-size")).toBe("40");
    expect(c.querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("approval"); // a pending approval determines the mascot's mood
    expect(c.textContent).toContain("Compass ready");
    expect(c.textContent).toContain("1 approval");
    expect(c.textContent).toContain("4 notifications");
    expect(c.querySelector(".num.b6:not(.approvalCount)")).toBeNull();
  });
  it("the same 40 px hanging mascot in all three states: no Compass (idle), not connected (idle, not asleep), connected (the real mood)", async () => {
    const sig = () => { const m = center().querySelector<HTMLElement>(".mascot")!; return { mood: m.dataset.mood, size: m.dataset.size, hang: m.dataset.hang, w: m.style.width, h: m.style.height }; };
    fakeBridge.setPlugins([]);
    const a = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const none = sig();
    expect(center().textContent).toMatch(/\d{1,2}:\d\d/);
    expect(center().textContent).not.toContain("Compass ready");
    a.unmount(); resetMascotRegistry();
    fakeBridge.setPlugins(PLUGINS.map((p) => ({ ...p, connected: false })));
    const b = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const asleep = sig();
    expect(center().querySelector(".dim")).toBeNull();
    expect(center().textContent).not.toContain("Compass ready");
    b.unmount(); resetMascotRegistry();
    fakeBridge.setPlugins(PLUGINS);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const up = sig();
    expect([none.mood, asleep.mood]).toEqual(["idle", "idle"]);
    for (const x of [none, asleep]) expect({ ...x, mood: 0 }).toEqual({ ...up, mood: 0 });
    expect(up).toMatchObject({ size: "40", hang: "1", w: "40px", h: "30px" });
  });
  it("Claude Code events (cc_event) drive the calm mascot: searching, question, done; Compass's approval stays in front", async () => {
    const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>;
    const spy = vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "assistant_counts" ? Promise.resolve({ jobs: 0, memory: 0, approvals: 0 }) : real(c, ...a))) as never);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const mood = () => center().querySelector<HTMLElement>(".mascot")!.dataset.mood;
    expect(mood()).toBe("idle");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "WebSearch" }); });
    expect(mood()).toBe("searching");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "AskUserQuestion" }); });
    expect(mood()).toBe("question");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "stop_failure", reason: "rate_limit" }); });
    expect(document.querySelector(".islandCenter")!.textContent).toContain("Usage limit reached"); // the quota peek takes the center (item 15); after Esc dismisses it the mascot stays tired
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
    expect(mood()).toBe("ratelimit");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "stop" }); });
    expect(mood()).toBe("done");
    await act(async () => { fakeBridge.emit("cc_event", { kind: "session_end" }); });
    expect(mood()).toBe("idle");
    spy.mockRestore();
  });
  it("cc_event: Compass's pending approval takes precedence over the Claude Code mood", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.emit("cc_event", { kind: "pre_tool", tool: "WebSearch" }); });
    expect(center().querySelector<HTMLElement>(".mascot")!.dataset.mood).toBe("approval");
  });
  it("while a chat is running the mascot mood changes: thinking -> speaking", async () => {
    fakeBridge.setSurfaces({ composer: { ...COMPASS, voice: true } });
    render(<Island monitor="m1" init={{ view: null, ask: "hello" }} />);
    await settle(20);
    // the ask card is open; once it closes the mascot on the strip shows the real mood
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(30);
    expect(["thinking", "speaking", "done", "idle"]).toContain(center().querySelector<HTMLElement>(".mascot")?.dataset.mood);
  });
  it("click: the mascot in the center hops and the Modules card opens", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    fireEvent.click(center());
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modules/ })).toBeTruthy();
    expect(center().querySelector(".mascot:not(.out)")).toBeNull(); // one piece of information once on the card (the strip ghost cross-fades out, M1)
  });
});

describe("idle prank (Island polling)", { timeout: 30_000 }, () => {
  const run = async (prep?: () => void, minutes = 47) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0); // interval = the shortest, 45 min
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null); // playing music blocks the prank (PrankEnv.musicPlaying)
    prep?.();
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(minutes * 60_000); });
    return prank;
  };
  it("plays once after 45 min with no input", async () => { expect((await run()).mock.calls).toHaveLength(1); });
  it("does not play before the time is up", async () => { expect((await run(undefined, 30)).mock.calls).toHaveLength(0); });
  it("does not play if turned off in settings", async () => { expect((await run(() => void fakeBridge.call("set_settings", { patch: { mascotPranks: false } }))).mock.calls).toHaveLength(0); });
  it("does not play while do not disturb is on", async () => { expect((await run(() => void fakeBridge.call("set_dnd", { on: true }))).mock.calls).toHaveLength(0); });
  it("does not play in fullscreen", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    act(() => fakeBridge.emit("notch://fullscreen", true));
    await act(async () => { vi.advanceTimersByTime(47 * 60_000); });
    expect(prank).not.toHaveBeenCalled();
  });
  it("if there was input in the last 3 s (input_tick) it is postponed, and plays once it is quiet", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const prank = vi.spyOn(Ghost.prototype, "prank").mockImplementation(() => undefined);
    fakeBridge.setMedia(null);
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(45 * 60_000 - 1000); });
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 500, cursor: null }));
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(prank).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(prank).toHaveBeenCalledTimes(1);
  });
});

describe("Settings › Mascot", () => {
  it("the prank switch writes to settings; 'Show first run again' clears the flag and notifies the island page", async () => {
    render(<Shell monitor="m1" init={{ panel: "mascot" }} />);
    const sw = await screen.findByRole("switch", { name: "Mascot pranks" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).mascotPranks).toBe(false);
    localStorage.setItem(FIRST_KEY, "1");
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    await settle(80);
    off();
    expect(localStorage.getItem(FIRST_KEY)).toBeNull();
    expect(got).toContainEqual({ t: "firstrun" });
  });
  it("island: the 'firstrun' message opens the welcome card", async () => {
    localStorage.setItem(FIRST_KEY, "1");
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.queryByRole("dialog", { name: /Welcome/ })).toBeNull();
    sendX({ t: "firstrun" });
    await settle(80);
    expect(screen.getByRole("dialog", { name: /Welcome/ })).toBeTruthy();
  });
});

describe("small peeks (decision 12)", () => {
  it("charging: when plugged in, 'Charging 78%' and an 'about' time to full", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setBattery({ percent: 78, charging: true, plugged: true, remaining: "1h" }));
    await settle();
    expect(center().textContent).toContain("Charging");
    expect(screen.getByRole("group", { name: "Charging" }).textContent).toContain("About 1h until full");
  });
  it("if already charging at startup no peek opens (only the moment of plugging in)", async () => {
    fakeBridge.setBattery({ percent: 78, charging: true, plugged: true, remaining: "1h" });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(center().textContent).not.toContain("Charging");
  });
  it("low battery: a peek at 12% when not plugged in; 'Battery saver' opens the Settings page; Esc silences it", async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setBattery({ percent: 12, charging: false, plugged: false, remaining: "25m" }));
    await settle();
    expect(center().textContent).toContain("Battery 12%");
    expect(screen.getByText("About 25m left")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Battery saver settings" }));
    expect(spy).toHaveBeenCalledWith("open_windows_settings", { uri: "ms-settings:batterysaver" });
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(220);
    expect(center().textContent).not.toContain("Battery 12%");
  });
  it("no low-battery peek while plugged in or at 21%", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setBattery({ percent: 21, charging: false, plugged: false, remaining: null }));
    await settle();
    expect(center().textContent).not.toMatch(/Battery \d+%/);
    act(() => fakeBridge.setBattery({ percent: 9, charging: false, plugged: true, remaining: null }));
    await settle();
    expect(center().textContent).not.toContain("Battery 9%");
  });
  it("Bluetooth headphones: 'Battery 80%' if there is a battery; on a device that reports none, only 'connected' on the strip", async () => {
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    act(() => fakeBridge.emit("bluetooth_connected", { name: "Buds Pro", battery: 80 }));
    await settle();
    expect(center().textContent).toContain("Buds Pro connected");
    expect(screen.getByText("Battery 80%")).toBeTruthy();
    act(() => fakeBridge.emit("bluetooth_connected", { name: "Speaker", battery: null }));
    await settle(220);
    expect(center().textContent).toContain("Speaker connected");
    expect(screen.queryByText(/Battery \d+%/)).toBeNull();
  });
  it("timer: the remaining time on the strip, pause / +5 min / finish go to Rust", async () => {
    fakeBridge.setTimer({ label: "Focus", totalS: 1500, remainingS: 1452, running: true });
    fakeBridge.setMedia(null); // playing music takes precedence over the timer (side bubble decision 2026-10-17); here the timer is the only job
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(center().textContent).toMatch(/24:1[12]/);
    expect(center().textContent).toContain("Focus");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "+5 min" }));
    await settle();
    expect(logged("timer_control").map((l) => (l.args as { action: string }).action)).toEqual(["pause", "add5"]);
    fireEvent.click(center()); // clicking the center opens Modules while the timer is running too
    await settle();
    expect(screen.getByRole("dialog", { name: /^Modules/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(220);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await settle(220);
    expect(center().textContent).not.toContain("Focus");
  });
  it("dictation: wave and live text; ticket: ticket icon; recording: red dot + counter on the strip, Stop is red-filled", () => {
    const dictation = render(<ProtrusionCenter item={{ ...PROTRUSION, title: "Dictation", icon: null, state: "info", mascot: "listening", liveText: { streamId: "s" } }} />);
    expect(dictation.container.querySelector(".wave")).not.toBeNull();
    dictation.unmount(); resetMascotRegistry();
    const ticket = render(<ProtrusionCenter item={{ ...PROTRUSION, title: "New ticket", icon: "ticket", mascot: null }} />);
    expect(ticket.container.querySelector(".ikK svg")).not.toBeNull();
    ticket.unmount();
    const recording = { ...PROTRUSION, title: "Recording", icon: null, state: "danger" as const, mascot: null, timer: { startedAt: new Date(Date.now() - 134_000).toISOString() }, actions: [{ id: "pause", label: "Pause" }, { id: "stop", label: "Stop", style: "destructive" as const }] };
    const rec = render(<><ProtrusionCenter item={recording} /><ProtrusionBump item={recording} /></>);
    expect(rec.container.querySelector(".recDot")).not.toBeNull();
    expect(rec.container.querySelector(".ms .counter")!.textContent).toMatch(/^02:1\d$/);
    expect(rec.container.querySelectorAll(".counter, .peekBar .num")).toHaveLength(1); // one piece of information once
    expect(within(rec.container).getByRole("button", { name: "Stop" }).className).toContain("destructiveFill");
  });
  it("calendar/meeting: 'Join' is the primary (blue) button with a camera icon, goes to the plugin; no camera mirror", () => {
    const { container } = render(<ProtrusionBump item={PROTRUSION} />);
    const b = within(container).getByRole("button", { name: "Join" });
    expect(b.className).toContain("blue");
    expect(b.querySelector("svg")).not.toBeNull();
    fireEvent.click(b);
    expect(container.textContent).not.toMatch(/mirror/i);
  });
  it("shelf: 'Share' goes to share_open by id; 'Ask Compass' when an assistant exists; two drop targets while dragging", async () => {
    fakeBridge.setShelf([{ id: "f1", name: "presentation-draft.pdf", sub: "2.4 MB, just now", kind: "pdf" }, { id: "f2", name: "screen-recording.mp4", sub: "38 MB", kind: "video" }]);
    const main = PLUGINS[0];
    const { container } = render(<ShelfCard items={await fakeBridge.call("shelf_list")} main={main} />);
    fireEvent.click(within(container).getByRole("button", { name: "presentation-draft.pdf, share" }));
    fireEvent.click(within(container).getByRole("button", { name: "screen-recording.mp4, Ask Compass" }));
    await settle();
    expect(logged("share_open")[0].args).toEqual({ id: "f1" });
    expect(logged("shelf_ask")[0].args).toEqual({ id: "f2" });
    expect(container.textContent).not.toMatch(/Nearby sharing/i);
    const bump = render(<ShelfBump main={main} />);
    expect(bump.container.querySelectorAll(".dropSmall")).toHaveLength(2);
  });
  it("shelf: without an assistant, no Ask button but a hint row (no dead end)", async () => {
    fakeBridge.setShelf([{ id: "f1", name: "a.pdf", sub: "1 MB", kind: "pdf" }]);
    const { container } = render(<ShelfCard items={await fakeBridge.call("shelf_list")} main={null} />);
    expect(container.querySelector(".mini.ask")).toBeNull();
    expect(container.textContent).toMatch(/Connect an assistant/);
  });
  it("shelf: share_open is rejected for a file that does not exist (fake bridge)", async () => {
    await expect(fakeBridge.call("share_open", { id: "missing" })).rejects.toBe("denied");
  });
  it("microphone/camera privacy dot: the app using it is named in the label; absent if nobody is using it", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    expect(document.querySelector(".privacyDot")).toBeNull();
    act(() => fakeBridge.setPrivacy({ mic: ["Chrome"], camera: [] }));
    await settle();
    expect(screen.getByRole("img", { name: "Microphone in use" })).toBeTruthy();
    act(() => fakeBridge.setPrivacy({ mic: [], camera: ["Teams"] }));
    await settle();
    expect(document.querySelector(".privacyDot")!.getAttribute("data-only")).toBe("camera");
    act(() => fakeBridge.setPrivacy({ mic: [], camera: [] }));
    await settle();
    expect(document.querySelector(".privacyDot")).toBeNull();
  });
  it("screen share (B1): the dot says so with no app name, and the strip goes generic (Rust sends presentation)", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.setPrivacy({ mic: [], camera: [], screen: true }));
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }));
    await settle();
    const dot = screen.getByRole("img", { name: "Screen is being shared" });
    expect(dot.getAttribute("data-only")).toBeNull();
    act(() => fakeBridge.setPrivacy({ mic: [], camera: [] }));
    await settle();
    expect(document.querySelector(".privacyDot")).toBeNull();
  });
});

describe("window preview", () => {
  const chrome = () => document.querySelector<HTMLElement>('.pin[data-app="chrome"]')!;
  it("on hover it opens after an intent delay; a placeholder while loading, then the image; afterwards instantly from the cache", async () => {
    fakeBridge.setPreviewDelay(150);
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(chrome());
    expect(document.querySelector(".preview")).toBeNull(); // ~250 ms intent
    await settle(300);
    const box = document.querySelector(".preview")!;
    expect(box.querySelectorAll(".small")).toHaveLength(2); // Chrome's two windows
    expect(box.querySelector(".image.loading")).not.toBeNull();
    await settle(250);
    expect(box.querySelector(".image.loading")).toBeNull();
    expect(box.querySelectorAll("img")).toHaveLength(2);
    expect(logged("window_preview").map((l) => (l.args as { hwnd: number }).hwnd).sort()).toEqual([2, 3]);
    // closes when the pointer leaves; when it comes back the cached image shows immediately
    fireEvent.pointerLeave(chrome());
    await settle(300);
    expect(document.querySelector(".preview")).toBeNull();
    fireEvent.pointerEnter(chrome());
    await settle(300);
    expect(document.querySelectorAll(".preview img")).toHaveLength(2);
  });
  it("no preview on a closed pin; clicking the preview brings the window to the front", async () => {
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(document.querySelector<HTMLElement>('.pin[data-app="steam"]')!);
    await settle(300);
    expect(document.querySelector(".preview")).toBeNull();
    fireEvent.pointerEnter(chrome());
    await settle(300);
    fireEvent.click(document.querySelector<HTMLElement>('.preview .small[data-hwnd="3"]')!);
    await settle();
    expect(document.querySelector(".preview")).toBeNull();
    expect((await fakeBridge.call("list_windows", { monitor: "m1" })).find((w) => w.hwnd === 3)!.active).toBe(true);
  });
  it("if the preview request fails the placeholder stays and the error does not propagate", async () => {
    const orig = fakeBridge.call.bind(fakeBridge) as (c: string, a?: unknown) => Promise<unknown>;
    vi.spyOn(fakeBridge, "call").mockImplementation(((cmd: string, a?: unknown) => (cmd === "window_preview" ? Promise.reject("io") : orig(cmd, a))) as never);
    render(<Shell monitor="m1" />);
    await settle();
    fireEvent.pointerEnter(chrome());
    await settle(350);
    expect(document.querySelectorAll(".preview .image.loading")).toHaveLength(2);
  });
});

describe("module management and color icons", () => {
  it("turned-off modules are hidden on the card, plugin tabs follow the saved order", async () => {
    fakeBridge.setSurfaces(SURFACES_FULL);
    await fakeBridge.call("modules_set", { order: ["general", "music", "clipboard", "shelf", "calendar", "timer", "system", "notifications", "claude code", "compass", "team"], off: ["system", "shelf", "timer"] });
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const tabs = within(screen.getByRole("tablist", { name: "Modules" })).getAllByRole("tab").map((t) => t.getAttribute("aria-label") ?? t.textContent);
    expect(tabs).toEqual(["General", "Music", "Clipboard", "Calendar", "Notifications", "Compass › Claude Code", "Compass"]);
    expect(screen.queryByRole("heading", { name: "System" })).toBeNull();
    expect(screen.queryByText("CPU")).toBeNull();
  });
  it("with everything on, the Shelf tab and the System tile are there", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.getByRole("tab", { name: "Shelf" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System: open tab" })).toBeTruthy();
  });
  it("in Settings › Appearance the color icons switch writes the setting and puts a flag on the page; no flag while off", async () => {
    render(<Shell monitor="m1" init={{ panel: "appearance" }} />);
    const sw = await screen.findByRole("switch", { name: "Color app icons" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.hasAttribute("data-color")).toBe(false);
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).colorIcons).toBe(true);
    expect(document.documentElement.hasAttribute("data-color")).toBe(true);
  });
  it("AppIcon: a color icon enters the style only with a safe data URL", () => {
    const ok = render(<AppIcon src="data:image/svg+xml,mono" color="data:image/png;base64,AAAA" />);
    expect(ok.container.firstElementChild!.getAttribute("style")).toContain("--icon-color");
    ok.unmount();
    const bad = render(<AppIcon src="data:image/svg+xml,mono" color={'https://evil/x.png");background:url(x'} />);
    expect(bad.container.firstElementChild!.getAttribute("style") ?? "").not.toContain("--icon-color");
  });
});

describe("lock gaps", () => {
  it("notification contents are hidden while locked (count only); they come back on unlock", async () => {
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect(screen.getByText("Report ready")).toBeTruthy();
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    expect(screen.queryByText("Report ready")).toBeNull();
    expect(document.body.textContent).not.toContain("Disk 91%");
    expect(screen.getByRole("status").textContent).toContain("Peeka is locked");
    act(() => fakeBridge.setLocked(false));
    await settle();
    expect(screen.getByText("Report ready")).toBeTruthy();
  });
  it("the strip right-click menu has 'Lock Peeka', and not while locked", () => {
    const props = { menu: { kind: "strip", x: 10 } as const, pins: [], windows: [], onClose: () => undefined, onPins: () => undefined, onSettings: () => undefined, onQuit: () => undefined };
    const a = render(<ContextMenu {...props} />);
    expect(within(a.container).getByRole("menuitem", { name: "Lock Peeka" })).toBeTruthy();
    a.unmount();
    const b = render(<ContextMenu {...props} locked />);
    expect(within(b.container).queryByRole("menuitem", { name: "Lock Peeka" })).toBeNull();
  });
  it("'Lock Peeka' in the menu calls lock_now", async () => {
    const props = { menu: { kind: "strip", x: 10 } as const, pins: [], windows: [], onClose: () => undefined, onPins: () => undefined, onSettings: () => undefined, onQuit: () => undefined };
    render(<ContextMenu {...props} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Lock Peeka" }));
    await settle();
    expect((await fakeBridge.call("lock_state")).locked).toBe(true);
  });
});

describe("short label in the center: Search, Settings, Clipboard (one piece of information once)", () => {
  it("when the strip page opens a panel the island center says 'Search' / 'Peeka settings', and the clock / Compass ready returns when it closes", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(center().textContent).toContain("Compass ready");
    sendX({ t: "panel", panel: "search" });
    await settle(80);
    expect(now().textContent).toContain("Search");
    expect(now().textContent).not.toContain("Compass ready");
    sendX({ t: "panel", panel: "settings" });
    await settle(220);
    expect(now().textContent).toContain("Peeka settings");
    sendX({ t: "panel", panel: null });
    await settle(220);
    expect(now().textContent).toContain("Compass ready");
  });
  it("Shell sends the message when a panel opens and closes (main screen)", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Shell monitor="m1" init={{ panel: "search" }} />);
    await settle(80);
    expect(got).toContainEqual({ t: "panel", panel: "search" });
    off();
  });
  it("while the Clipboard card is open the center has a 'Clipboard' label", async () => {
    render(<Island monitor="m1" init={{ view: "clipboard" }} />);
    await settle();
    expect(center().textContent).toContain("Clipboard");
  });
});

describe("Wave 4 contract fixes", () => {
  it("clip_clear({passwords:true}) deletes only passwords; without the field it deletes everything", async () => {
    await fakeBridge.call("clip_clear", { passwords: true });
    const left = await fakeBridge.call("clip_list");
    expect(left.some((c) => c.kind === "password")).toBe(false);
    expect(left.length).toBeGreaterThan(5);
    await fakeBridge.call("clip_clear", {});
    expect(await fakeBridge.call("clip_list")).toEqual([]);
  });
  it("Settings › Clipboard: a single 'Delete all' row (mockup clipboard); no password-specific row", async () => {
    render(<Shell monitor="m1" init={{ panel: "clipboard" }} />);
    expect(await screen.findByText("Can't be undone")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete all: press and hold" })).toBeTruthy();
    expect(screen.queryByText("Delete all passwords")).toBeNull();
  });
  it("search_ask returns {turn}", async () => {
    expect(await fakeBridge.call("search_ask", { query: "hello" })).toEqual({ turn: expect.any(Number) });
  });
});

describe("Wave 5 contract", () => {
  it("window_preview returns a PNG/SVG data URL", async () => {
    expect(await fakeBridge.call("window_preview", { hwnd: 2 })).toMatch(/^data:image\//);
  });
  it("input_tick feeds the cursor and last input: the mascot drops its own pointermove", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 5000, cursor: { x: 300, y: 40 } }));
    await settle();
    expect(center().querySelector(".mascot")).not.toBeNull();
  });
});
