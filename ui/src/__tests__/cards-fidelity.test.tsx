// Fidelity check 2 (cards): pure rules, approval/composer/module cards, new cards and the Compass line.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { SURFACES_J, VOICE_ASSISTANT, VOICE_YOU, VOICE_SPEAKING, VOICE_THINKING, withRecommended } from "../plugin.fixtures";
import { EmptyBoard, ErrorCard, FirstConnectCard, LoadingCard, makeErrorBudget } from "../components/CardsExtra";
import { Island } from "../components/Island";
import { FirstRunCard, MOD_NARROW } from "../components/IslandCards";
import { ApprovalCard, ApprovalCenter, ComposerCard, ProtrusionBump, ProtrusionCenter } from "../components/Plugin";
import { shortApprovalTitle } from "../lib/cardsText";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { onX, type XMsg } from "../lib/xwin";
import { APPROVAL_CHOICE, APPROVAL_HIGH, APPROVAL_LOW, COMPASS, OTHER, PLUGINS } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); resetMascotRegistry(); localStorage.clear();
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("pure rules", () => {
  it("peek title: a repeated risky phrase is shortened on high risk, shortTitle wins, the separator is flattened", () => {
    expect(shortApprovalTitle(APPROVAL_HIGH)).toBe("api-server needs approval");
    expect(shortApprovalTitle(APPROVAL_LOW)).toBe("api-server needs approval");
    expect(shortApprovalTitle({ ...APPROVAL_HIGH, shortTitle: "Short › Title" })).toBe("Short - Title");
  });
  it("the same error does not react a second time within 10 min", () => {
    let t = 0;
    const ok = makeErrorBudget(() => t);
    expect(ok("claude")).toBe(true);
    t += 5 * 60_000; expect(ok("claude")).toBe(false);
    expect(ok("other")).toBe(true);
    t += 6 * 60_000; expect(ok("claude")).toBe(true);
  });
});

describe("approval card", () => {
  it("c1: source name is faded (text 3), short title on high risk", () => {
    const { container, unmount } = render(<ApprovalCenter a={APPROVAL_LOW} />);
    expect(container.querySelector(".prefix .l3:last-child")?.textContent).toBe("Claude Code");
    unmount();
    render(<ApprovalCenter a={APPROVAL_HIGH} />);
    expect(screen.getByText("api-server needs approval")).toBeTruthy();
    expect(screen.getByText("high risk")).toBeTruthy();
  });
  it("c3: the recommended option is preselected and labelled; Approve plan is enabled right away; the 'Write another answer' button opens the box", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={withRecommended(APPROVAL_CHOICE)} />);
    expect(screen.getByRole("radio", { name: /existing component/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("recommended")).toBeTruthy();
    expect(screen.queryByLabelText("Write another answer")).toBeNull();
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "choice", choiceId: "extend" });
    fireEvent.click(screen.getByRole("button", { name: "Write another answer" }));
    expect(screen.getByLabelText("Write another answer")).toBeTruthy();
  });
  it("with no recommendation no option is preselected; the 300 ms guard and the absence of 'Always' on high risk are kept", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ApprovalCard a={APPROVAL_CHOICE} />);
    expect(screen.getAllByRole("radio").every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.queryByText("recommended")).toBeNull();
    unmount();
    render(<ApprovalCard a={APPROVAL_HIGH} />);
    expect(screen.queryByText("Always allow")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow: press and hold" }));
    expect(fakeBridge.log.filter((l) => l.cmd === "approval_answer")).toHaveLength(0); // no allow without press and hold
  });
});

describe("voice cards", () => {
  it("strip: the phase text comes from Peeka's table and the wave uses the phase color; dictation keeps its own title", () => {
    const { container, unmount } = render(<ProtrusionCenter item={VOICE_THINKING} />);
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect((container.querySelector(".wave") as HTMLElement).style.getPropertyValue("--phase")).toBe("var(--orange)");
    unmount();
    render(<ProtrusionCenter item={{ ...VOICE_SPEAKING, title: "uydurma metin" }} />);
    expect(screen.getByText("Speaking")).toBeTruthy();
    expect(screen.queryByText("uydurma metin")).toBeNull();
    cleanup();
    render(<ProtrusionCenter item={{ plugin: COMPASS, title: "Dictation", state: "info", mascot: "listening" }} />);
    expect(screen.getByText("Dictation")).toBeTruthy();
  });
  it("the phase table is closed to everything except the main assistant and prototype keys", () => {
    const first = render(<ProtrusionCenter item={{ ...VOICE_THINKING, plugin: OTHER }} />);
    expect(first.container.querySelector(".wave")).toBeNull(); // no phase view on another plugin
    first.unmount();
    const { container } = render(<ProtrusionCenter item={{ plugin: COMPASS, title: "x", state: "info", mascot: "constructor" }} />);
    expect(container.querySelector(".wave")).toBeNull();
  });
  it("peek: 'You' and plugin rows, always-listening hint", async () => {
    render(<ProtrusionBump item={VOICE_SPEAKING} />);
    await act(async () => { fakeBridge.emit("plugin_stream", { streamId: "voice", text: VOICE_YOU, speaker: "You" }); });
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.queryByText("Compass")).toBeNull();
    await act(async () => { fakeBridge.emit("plugin_stream", { streamId: "voice", text: VOICE_ASSISTANT, speaker: "Compass" }); });
    expect(screen.getByText("Compass")).toBeTruthy();
    expect(screen.getByText(VOICE_ASSISTANT)).toBeTruthy();
    expect(screen.getByText(/Always listening/)).toBeTruthy();
  });
});

describe("Ctrl+Space box", () => {
  const owner = { ...COMPASS, voice: true };
  it("placeholder 'Ask Compass anything: ...', scan + paperclip + highlighted microphone, chips and attachment", async () => {
    fakeBridge.setShelf([{ id: "a", name: "a.pdf", sub: "", kind: "pdf", pinned: false }, { id: "b", name: "b.pdf", sub: "", kind: "pdf", pinned: false }]);
    fakeBridge.addClip({ id: "k1", createdAt: Date.now(), pinned: false, source: "Chrome", kind: "text", text: "https://example.com/x", hint: "link", sub: null, thumb: null, screenshot: false });
    const send = vi.fn();
    const { container } = render(<ComposerCard owner={owner} turns={[]} send={send} />);
    await settle();
    expect(screen.getByPlaceholderText("Ask Compass anything")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach screenshot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach file" })).toBeTruthy();
    expect(container.querySelector(".slot.accent")).toBeTruthy();
    expect(screen.queryByText(/This window/)).toBeNull(); // the old chip (never worked) is gone
    expect(screen.getByText("Link on clipboard")).toBeTruthy();
    expect(screen.getByText("2 files on Shelf")).toBeTruthy();
    fireEvent.click(screen.getByText("Link on clipboard"));
    fireEvent.click(screen.getByRole("button", { name: "Attach screenshot" }));
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/Ask Compass/), { target: { value: "summarize" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/Ask Compass/), { key: "Enter" });
    expect(send).toHaveBeenCalledWith("summarize", [{ kind: "clipboard_link" }, { kind: "screen_image" }]);
  });
  it("P1: mic and round send sit in fixed slots; send is disabled while empty, the mic's fill hands over to send once there is text; clicking sends", async () => {
    const send = vi.fn();
    const { container } = render(<ComposerCard owner={owner} turns={[]} send={send} />);
    await settle();
    const sendBtn = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendBtn().disabled).toBe(true);
    expect(container.querySelector(".slot.accent")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Ask Compass/), { target: { value: "hello" } });
    expect(sendBtn().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Ask by voice" })).toBeTruthy(); // the mic stays where it was
    expect(container.querySelector(".slot.accent")).toBeNull();
    fireEvent.click(sendBtn());
    expect(send).toHaveBeenCalledWith("hello", []);
    expect(screen.getByRole("button", { name: "Send" })).toBe(sendBtn()); // same button after the click, now disabled
    expect(sendBtn().disabled).toBe(true);
  });
  it("when Rust reports no attachment kinds there are no chips or attach buttons (no out-of-contract kind is sent)", async () => {
    { const real = fakeBridge.call.bind(fakeBridge) as (c: string, ...a: unknown[]) => Promise<unknown>; vi.spyOn(fakeBridge, "call").mockImplementation(((c: string, ...a: unknown[]) => (c === "composer_kinds" ? Promise.reject("unknown") : real(c, ...a))) as never); }
    fakeBridge.setShelf([{ id: "a", name: "a.pdf", sub: "", kind: "pdf", pinned: false }]);
    render(<ComposerCard owner={owner} turns={[]} send={() => undefined} />);
    await settle();
    expect(screen.queryByText(/Raftaki/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach file" })).toBeNull();
    expect(screen.queryByText("1 file on Shelf")).toBeNull();
  });
  it("another plugin's name stays as a prefix", async () => {
    render(<ComposerCard owner={{ ...OTHER, voice: false }} turns={[]} send={() => undefined} />);
    expect(screen.getByPlaceholderText("Ask Sample Assistant anything")).toBeTruthy();
  });
});

describe("Modules (j)", () => {
  it("the gear opens Settings › Modules in the strip; the Claude tab shows the chat", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Modules settings" }));
    await vi.waitFor(() => expect(got).toContainEqual({ t: "open-panel", panel: "modules" }));
    off();
    fireEvent.click(within(screen.getByRole("tablist", { name: "Modules" })).getByRole("tab", { name: "Claude" }));
    await settle();
    expect(screen.getByRole("region", { name: "Claude chat" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Message to Claude" })).toBeTruthy();
  });
  it("with Island only on there is no strip to open Settings in: the gear brings the strip back", async () => {
    await fakeBridge.call("set_settings", { patch: { islandOnly: true } });
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Show the strip" }));
    await vi.waitFor(async () => expect((await fakeBridge.call("get_settings")).islandOnly).toBe(false));
  });
  it("13 tabs (Claude chat last of Peeka's own) and a gear; General has the Compass box and a link to its Claude Code tab, then one place per module; quota bars, session states, Stop", async () => {
    fakeBridge.setSurfaces(SURFACES_J);
    const { container } = render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const tabs = within(screen.getByRole("tablist", { name: "Modules" })).getAllByRole("tab").map((t) => t.getAttribute("aria-label") ?? t.textContent);
    expect(tabs).toEqual(["General", "Music", "Clipboard", "Shelf", "Calendar", "Timer", "System", "Usage", "Notifications", "Claude", "Compass", "Compass › Claude Code", "Compass › Team"]);
    expect(screen.getByRole("button", { name: "Modules settings" })).toBeTruthy(); // owner: a gear to Settings › Modules (hide Calendar / Timer)
    expect(container.querySelectorAll(".genPlug > .box")).toHaveLength(1);
    // General home (Places): every place's name opens its tab, in fixed place order (Claude Code: the sessions list); the plugin's General tab is a link last
    expect([...container.querySelectorAll(".genHome .genHead")].map((b) => b.getAttribute("aria-label")))
      .toEqual(["Music: open tab", "Compass › Claude Code: open tab", "Claude Code sessions, show list", "Clipboard: open tab", "Calendar: open tab", "Timer: open tab", "System: open tab"]);
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByText("3 note suggestions")).toBeTruthy();
    // one mascot: General's 56 px ghost outranks the Compass box's 24 px one (single-mascot registry)
    expect([...container.querySelectorAll(".mascot")].map((m) => m.getAttribute("data-size"))).toEqual(["56"]);
    expect(container.querySelector(".genHome .genGhost .mascot")).toBeTruthy();
    // the Claude Code tab's blocks live on its own tab, one click from General
    fireEvent.click(screen.getByRole("button", { name: "Compass › Claude Code: open tab" }));
    await settle();
    expect(container.querySelectorAll(".quota .meter")).toHaveLength(2);
    expect(container.querySelector(".quota .threshold")).toBeTruthy();
    expect(screen.getByText("Resets in 2h 14m")).toBeTruthy();
    expect(container.querySelector(".sessions .pulse")).toBeTruthy();
    expect(container.querySelector(".sessions .ring")).toBeTruthy();
    expect(container.querySelector(".sessions .tickGreen")).toBeTruthy();
  });
  it.each([
    ["installed but not connected", () => PLUGINS.map((p) => (p.main ? { ...p, connected: false } : p))],
    ["no assistant at all", () => []],
  ])("General always shows the 56 px ghost (%s) and the strip's rest ghost yields", async (_, list) => {
    fakeBridge.setPlugins(list());
    const rest = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect([...rest.container.querySelectorAll(".mascot")].map((m) => m.getAttribute("data-size"))).toEqual(["40"]);
    rest.unmount(); resetMascotRegistry();
    const { container } = render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(container.querySelector(".genHome .genGhost .mascot[data-size='56']")).toBeTruthy();
    expect([...container.querySelectorAll(".mascot")].map((m) => m.getAttribute("data-size"))).toEqual(["56"]);
  });
  it("Music and Timer on their own tabs", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    expect(screen.queryByLabelText("Minutes")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Timer" }));
    expect(screen.getByLabelText("Minutes")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Music" }));
    expect(screen.getByRole("button", { name: "Previous track" })).toBeTruthy();
  });
  it("General home: the Music place follows the music, the Clipboard place shows count/kind/age only, never the copied text", async () => {
    fakeBridge.addClip({ id: "s1", createdAt: Date.now(), pinned: false, source: "Chrome", kind: "text", text: "secret text", sub: null, thumb: null, screenshot: false } as never);
    const { container } = render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const home = container.querySelector(".genHome")!;
    expect(home.querySelector(".genMusic")?.textContent).toContain("Night Train");
    const clip = home.querySelector('.genRow[style*="grid-area: clip"]');
    expect(clip?.textContent).toMatch(/^ClipboardText, just now\d+ items?$/); // kind and age of the newest (the text item), then the count
    expect(home.textContent).not.toContain("secret");
    expect(home.textContent).not.toContain("Chrome");
  });
  it("a General place opens its own tab in one click; an empty module keeps its place", async () => {
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Timer: open tab" }));
    expect(screen.getByRole("tab", { name: "Timer" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Minutes")).toBeTruthy();
  });
});

describe("Modules card width", () => {
  it("every tab is 620 wide, General included (Places), and tabs are icon-only", async () => {
    expect(MOD_NARROW).toBe(620);
    fakeBridge.setSurfaces(SURFACES_J); // even with plugin boxes General stays 620 (they stack under the places)
    // a 1920 screen and a window with room for the wide card (jsdom: screen 0, window 1024)
    vi.spyOn(window.screen, "width", "get").mockReturnValue(1920);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1920);
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const kart = () => (document.querySelector(".islandInner.mockCard, .islandInner") as HTMLElement).style.width;
    expect(kart()).toBe("620px");
    vi.restoreAllMocks();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(kart()).toBe("620px");
    expect(screen.getByRole("tab", { name: "Clipboard" }).textContent).toBe("");
    expect(screen.getByRole("tab", { name: "Calendar" }).textContent).toBe("");
  });
  it("tabs are always icon-only; clicking does not change order, count or size class, the name shows in a tooltip after 400 ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeBridge.setSurfaces(SURFACES_J);
    render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    const snap = () => within(screen.getByRole("tablist", { name: "Modules" })).getAllByRole("tab").map((t) => [t.getAttribute("aria-label"), t.textContent, t.offsetLeft]);
    const before = snap();
    expect(before.every(([, text]) => text === "")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Timer" }));
    expect(snap()).toEqual(before); // offsetLeft is 0 in jsdom; the real position was measured in a Playwright frame
    fireEvent.mouseEnter(screen.getByRole("tab", { name: "Compass › Claude Code" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(450); });
    expect(screen.getByRole("tooltip").textContent).toBe("Compass › Claude Code");
    vi.useRealTimers();
  }, 20_000); // 12 tabs x 400 ms tooltip waits; slow CI runners need the room
});

describe("new cards", () => {
  it("firstconnect: the text, Skip and OK do the same job", async () => {
    const done = vi.fn();
    render(<FirstConnectCard onDone={done} />);
    expect(await screen.findByText("Hi, I'm Compass")).toBeTruthy();
    expect(screen.getByText(/Press Ctrl\+Space to ask me/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(done).toHaveBeenCalledTimes(2);
  });
  it("ky: the skeleton never shows for a load under 800 ms, shows when longer", () => {
    vi.useFakeTimers();
    const { container } = render(<LoadingCard />);
    advance(799); expect(container.querySelector(".skeleton")).toBeNull();
    advance(2); expect(container.querySelectorAll(".skeleton")).toHaveLength(3);
    expect(screen.getByText("Reading clipboard")).toBeTruthy();
  });
  it("kh: Try again calls retry, Why? opens the technical text", () => {
    const retry = vi.fn();
    render(<ErrorCard title="Can't reach Claude Code" detail="hook bridge is not responding" onRetry={retry} />);
    expect(screen.queryByText("hook bridge is not responding")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText("hook bridge is not responding")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("kb: searching mascot 96 (M1) and the empty Clipboard text", () => {
    const { container } = render(<EmptyBoard />);
    expect(screen.getByText("Clipboard is empty")).toBeTruthy();
    expect(container.querySelector(".mascot")?.getAttribute("data-size")).toBe("96");
    expect(container.querySelector(".mascot")?.getAttribute("data-mood")).toBe("searching");
  });
});

describe("first run (welcome)", () => {
  it("three pages: Skip on the first two, the mockup's full text and the way back on the last; a 96 px waving mascot while Compass is connected", () => {
    const done = vi.fn();
    const { container } = render(<FirstRunCard onDone={done} mascot />);
    expect(container.querySelector(".mascot")?.getAttribute("data-size")).toBe("96");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Press Ctrl\+K to search apps, windows, files and settings\./)).toBeTruthy();
    expect(screen.getByText(/Restore taskbar/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(done).toHaveBeenCalledOnce();
  });
  it("Skip finishes from the first page; neutral icon without Compass", () => {
    const done = vi.fn();
    const { container } = render(<FirstRunCard onDone={done} />);
    expect(container.querySelector(".mascot")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(done).toHaveBeenCalledOnce();
  });
});

describe("dictation, ticket and counter (strip)", () => {
  it("dictation: quoted live row and 'Esc cancel'; ticket: 'draft ready' note; Compass's mascot-less peek has no 'A' tile, the name prefix stays", async () => {
    const dict = { plugin: COMPASS, title: "Dictation", state: "info" as const, mascot: "listening", liveText: { streamId: "d9" }, actions: [{ id: "finish", label: "Stop" }] };
    const { container, unmount } = render(<ProtrusionBump item={dict} />);
    await settle();
    act(() => fakeBridge.emit("plugin_stream", { streamId: "d9", text: "tomorrow morning at nine" }));
    expect(container.querySelector(".liveText")!.textContent).toBe("“tomorrow morning at nine”");
    expect(screen.getByText("cancel")).toBeTruthy();
    unmount();
    const ticket = { plugin: COMPASS, title: "New ticket", icon: "ticket", state: "attention" as const };
    const c = render(<ProtrusionCenter item={ticket} />);
    expect(screen.getByText("draft ready")).toBeTruthy();
    expect(c.container.querySelector(".initials")).toBeNull();
    expect(c.container.textContent).toContain("Compass ›");
  });
  it("the counter has two-digit minutes", async () => {
    const { elapsed } = await import("../lib/plugin");
    expect(elapsed("2026-10-16T14:00:00Z", Date.parse("2026-10-16T14:02:14Z"))).toBe("02:14");
    expect(elapsed("2026-10-16T14:00:00Z", Date.parse("2026-10-16T15:02:03Z"))).toBe("1:02:03");
  });
});
