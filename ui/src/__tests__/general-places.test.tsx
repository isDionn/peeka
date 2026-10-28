// General home "Places" (owner chose B): fixed spots per module, the Now box only for what needs you, privacy gate, no shift between states.
// @ts-expect-error node types are not installed; vitest runs on Node
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { bridge, type Media, type Status } from "../bridge";
import { ModulesCard } from "../components/IslandCards";
import { Island } from "../components/Island";
import { APPROVAL_HIGH, APPROVAL_LOW, EMPTY_SURFACES } from "../plugin.fixtures";
import { resetMascotRegistry } from "../mascot/useSingleMascot";

beforeEach(() => { fakeBridge.reset(); resetMascotRegistry(); localStorage.clear(); vi.spyOn(bridge, "call"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const calls = () => vi.mocked(bridge.call).mock.calls.map(([m, a]) => ({ m: m as string, a }));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

const SONG: Media = { title: "Night Train", artist: "Ada", album: "Lines", app: "Spotify", art: null, playing: true, positionMs: 0, positionAt: 0, durationMs: 200_000, canNext: true, canPrevious: true, canSeek: true };
const OK: Status["battery"] = { percent: 82, charging: false, plugged: false, remaining: null };
const LOW: Status["battery"] = { percent: 14, charging: false, plugged: false, remaining: null };
const MEET = { plugin: { id: "p", name: "Cal", main: false }, id: "m1", icon: "calendar", title: "Design review", subtitle: "3:30 PM" } as never;
const clip = (kind: string, ageMs: number) => fakeBridge.addClip({ id: "c" + ageMs, createdAt: Date.now() - ageMs, pinned: false, source: "Chrome", kind, text: "secret text", sub: null, thumb: null, screenshot: false } as never);

type P = Partial<Parameters<typeof ModulesCard>[0]>;
async function home(p: P = {}) {
  const r = render(<ModulesCard media={null} pos={0} sys={null} cpu={[]} surf={EMPTY_SURFACES} shelf={[]} main={null} meeting={null} onPage={() => undefined} onClose={() => undefined} onApproval={() => undefined} battery={OK} {...p} />);
  await settle();
  const el = r.container.querySelector(".genHome") as HTMLElement;
  const now = el.querySelector(".genNow") as HTMLElement;
  // the places in DOM order with their grid spot: the eye learns them, so they never change with the state
  const places = [...el.querySelectorAll(":scope > .genTile, .genGlance > .genRow")].map((x) => (x as HTMLElement).style.gridArea || [...x.classList].find((k) => k.startsWith("gen") && !["genTile", "genRow"].includes(k)));
  return { ...r, el, now, places, head: now.querySelector(".t17")?.textContent };
}
const PLACES = ["genNow", "genMusic", "genGlance", "cc", "clip", "cal", "timer", "power"];

describe("General home: Places", () => {
  it("idle: 'Nothing needs you', the 56 px ghost, every place", async () => {
    const h = await home();
    expect(h.head).toBe("Nothing needs you");
    expect(h.now.querySelector(".genGhost .mascot[data-size='56']")).toBeTruthy();
    expect(h.places).toEqual(PLACES);
    expect(h.now.classList.contains("attn") || h.now.classList.contains("warn")).toBe(false);
  });

  it("music: the Music place has the title and its own prev / play / next; the Now box stays quiet", async () => {
    const h = await home({ media: SONG });
    expect(h.head).toBe("Nothing needs you");
    expect(h.el.querySelector(".genMusic")?.textContent).toContain("Night Train");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Next track" }));
    await settle();
    expect(calls().filter((c) => c.m === "media_control").map((c) => c.a)).toEqual([{ action: "play_pause" }, { action: "next" }]);
    expect(h.places).toEqual(PLACES);
  });

  it("approval waiting (low risk): the Now box glows and offers Deny / Allow, which answer the plugin", async () => {
    const h = await home({ surf: { ...EMPTY_SURFACES, approvals: [APPROVAL_LOW] } });
    expect(h.head).toBe("Compass needs your approval");
    expect(h.now.classList.contains("attn")).toBe(true);
    fireEvent.click(within(h.now).getByRole("button", { name: "Deny" }));
    expect(within(h.now).getByRole("button", { name: "Allow" })).toBeTruthy();
    await settle();
    expect(calls().find((c) => c.m === "approval_answer")?.a).toMatchObject({ id: "ap-1", decision: "deny" });
    expect(h.places).toEqual(PLACES);
  });

  it("approval waiting (high risk): no Allow here, only Details (the card asks for the hold)", async () => {
    const onApproval = vi.fn();
    const h = await home({ surf: { ...EMPTY_SURFACES, approvals: [APPROVAL_HIGH] }, onApproval });
    expect(within(h.now).queryByRole("button", { name: "Allow" })).toBeNull();
    fireEvent.click(within(h.now).getByRole("button", { name: "Details" }));
    expect(onApproval).toHaveBeenCalledWith("ap-2");
  });

  it("clipboard copied: the Clipboard place lights up with kind, age and count only, never the content", async () => {
    clip("image", 2_000);
    const h = await home();
    const tile = h.el.querySelector('.genRow[style*="grid-area: clip"]') as HTMLElement;
    expect(tile.classList.contains("info")).toBe(true);
    expect(tile.textContent).toMatch(/^ClipboardImage, just now\d+ items?$/);
    expect(h.el.textContent).not.toContain("secret");
    expect(h.el.textContent).not.toContain("Chrome");
    expect(h.head).toBe("Nothing needs you");
  });

  it("an older copy doesn't glow", async () => {
    clip("text", 5 * 60_000);
    const h = await home();
    expect((h.el.querySelector('.genRow[style*="grid-area: clip"]') as HTMLElement).classList.contains("info")).toBe(false);
  });

  it("low battery: the Now box warns with Battery saver settings; the Power place turns orange; charging stays quiet", async () => {
    const h = await home({ battery: LOW });
    expect(h.head).toBe("Battery at 14%");
    expect(h.now.classList.contains("warn")).toBe(true);
    expect(h.el.querySelector('.genRow[style*="grid-area: power"]')?.classList.contains("warn")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Battery saver settings" }));
    await settle();
    expect(calls().find((c) => c.m === "open_windows_settings")?.a).toEqual({ uri: "ms-settings:batterysaver" });
    cleanup(); resetMascotRegistry();
    expect((await home({ battery: { ...LOW, plugged: true } })).head).toBe("Nothing needs you");
  });

  it("timer quick starts: 5 / 15 / 25 min start a timer", async () => {
    await home();
    fireEvent.click(screen.getByRole("button", { name: "Start a 15 minute timer" }));
    await settle();
    expect(calls().find((c) => c.m === "timer_start")?.a).toEqual({ label: "Timer", seconds: 900 });
  });

  it("a place's name opens its tab; 'Claude Code' opens the sessions list, Escape closes it", async () => {
    const pages: string[] = [];
    await home({ onPage: (p) => { pages.push(p); }, sessN: 2, lastCc: { tool: "Edit", at: Date.now() - 5_000 } });
    fireEvent.click(screen.getByRole("button", { name: "Calendar: open tab" }));
    expect(pages.at(-1)).toBe("calendar");
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    const cc = screen.getByRole("button", { name: "Claude Code sessions, show list" });
    fireEvent.click(cc);
    expect(screen.getByRole("group", { name: "Claude Code sessions" }).textContent).toContain("2 Claude Code sessions open");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close sessions list");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Claude Code sessions" })).toBeNull();
    expect(document.activeElement).toBe(cc);
  });

  it("0 Claude Code sessions: one quiet line, and the name still opens the list like every other place", async () => {
    const h = await home({ sessN: 0 });
    expect(h.el.querySelector('.genRow[style*="grid-area: cc"]')?.textContent).toBe("Claude CodeNo open sessions");
    fireEvent.click(screen.getByRole("button", { name: "Claude Code sessions, show list" }));
    expect(screen.getByRole("group", { name: "Claude Code sessions" }).textContent).toContain("0 Claude Code sessions open");
  });

  it("the approval in the Now box is not repeated in its plugin's box below; a second one still is", async () => {
    const one = await home({ surf: { ...EMPTY_SURFACES, approvals: [APPROVAL_LOW] } });
    expect(one.container.textContent!.match(/Awaiting approval/g)).toBeNull();
    cleanup();
    const two = await home({ surf: { ...EMPTY_SURFACES, approvals: [APPROVAL_LOW, { ...APPROVAL_HIGH, id: "second" }] } });
    expect(two.container.textContent!.match(/Awaiting approval/g)?.length).toBe(1);
  });

  it("privacy (locked / presenting / sharing): no track, approval or meeting text, no cover, no session tools", async () => {
    const h = await home({ generic: true, media: { ...SONG, art: "data:image/png;base64,AA" }, meeting: MEET, surf: { ...EMPTY_SURFACES, approvals: [APPROVAL_LOW] }, sessN: 1, sessList: [{ sid: "a1", tool: "Bash", at: Date.now(), agent: "claude", origin: null } as never] });
    const text = h.el.textContent!;
    expect(h.head).toBe("Waiting for your approval");
    for (const s of ["Night Train", "Ada", "api-server", "Design review", "3:30 PM"]) expect(text).not.toContain(s);
    expect(text).toContain("Music playing");
    expect(h.el.querySelector("img.genArt")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Claude Code sessions, show list" }));
    expect(h.el.textContent).not.toContain("Bash");
  });
});

describe("General home inside the island", () => {
  it("Escape in the sessions list closes only the list, the Modules card stays open", async () => {
    const { container } = render(<Island monitor="m1" init={{ view: "modules" }} />);
    await settle();
    act(() => fakeBridge.emit("cc_event", { kind: "session_start" })); // with 0 sessions the name is a plain label
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Claude Code sessions, show list" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await settle();
    expect(container.querySelector(".genSessions")).toBeNull();
    // the card's state, not its DOM: a closing card stays in the DOM while it animates out, so `.genHome` alone passed on a fast PC
    expect(container.querySelector(".islandCenter")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".genHome")).toBeTruthy();
  });
});

describe("General home: nothing shifts between states", () => {
  const css = readFileSync("src/components/cards.css", "utf8");
  it("fixed rows and height (92 + 8 + 230 = 330, the body cap: nothing scrolls), named spots, five glance rows", () => {
    const rule = css.match(/\.genHome \{[^}]*\}/)![0];
    expect(rule).toMatch(/grid-template-rows: 92px minmax\(0, 1fr\);/);
    expect(rule).toMatch(/height: 330px;/);
    expect(rule).toMatch(/grid-template-areas: "now music" "plug glance";/);
    expect(css).toMatch(/\.genGlance \{[^}]*grid-template-areas: "cc" "clip" "cal" "timer" "power";/);
  });
  it("a disabled module leaves its spot empty: the others keep their place", async () => {
    const order = (await bridge.call("modules_get")).map((m) => m.id);
    await bridge.call("modules_set", { order, off: ["music"] });
    const h = await home();
    expect(h.places).toEqual(PLACES.filter((p) => p !== "genMusic"));
  });
});
