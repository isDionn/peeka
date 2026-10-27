import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ConsentBody, ConsentWindow } from "../components/Consent";
import { Island } from "../components/Island";
import { ApprovalBump, ApprovalCard, ComposerCard, ProtrusionBump, ProtrusionCenter, TabBlocks } from "../components/Plugin";
import { useComposer } from "../hooks";
import { mascotOf, prefixed, riskOf, safeImage } from "../lib/plugin";
import { APPROVAL_CHOICE, APPROVAL_HIGH, APPROVAL_LOW, COMPASS, CONSENT, OTHER, PROTRUSION } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const answers = () => fakeBridge.log.filter((l) => l.cmd === "approval_answer").map((l) => l.args as { decision: string });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("approval risk", () => {
  it("only exactly 'low' is low; a missing field or an unrecognized value is high", () => {
    expect(riskOf("low")).toBe("low");
    for (const v of [undefined, null, "", "LOW", "medium", "high", 0, {}, ["low"]]) expect(riskOf(v)).toBe("high");
  });
  it("with an unknown risk the peek shows only 'Details'", () => {
    render(<ApprovalBump a={{ ...APPROVAL_LOW, risk: "maybe" }} onDetail={() => undefined} />);
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });
  it("on high risk the peek has no 'Allow'; on low risk it does", () => {
    const { unmount } = render(<ApprovalBump a={APPROVAL_HIGH} onDetail={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    unmount();
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
  });
  it("on the strip that drops down over a fullscreen app, even low risk shows only 'Details'", () => {
    render(<ApprovalBump a={APPROVAL_LOW} onlyDetail onDetail={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  });
  it("high risk on the card: no 'Always', Deny has default focus, Allow is press-and-hold", () => {
    const { container } = render(<ApprovalCard a={APPROVAL_HIGH} />);
    expect(screen.queryByText("Always allow")).toBeNull();
    expect(container.querySelector("[data-autofocus]")?.textContent).toContain("Deny");
    expect(screen.getByRole("button", { name: "Allow: press and hold" })).toBeTruthy();
    expect(container.querySelector(".code")?.textContent).toContain("git push --force origin main");
  });
  it("low risk on the card: 'Always allow' is there", () => {
    render(<ApprovalCard a={APPROVAL_LOW} />);
    expect(screen.getByText("Always allow")).toBeTruthy();
  });
  it("'Always allow' shows its exact rule and answers 'always' from the card; same button class as Deny", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_LOW} />);
    advance(600);
    expect(screen.getByText("Always allow: Bash(npm run test:*)")).toBeTruthy();
    const always = screen.getByRole("button", { name: "Always allow" });
    expect(always.className).toBe(screen.getByRole("button", { name: "Deny" }).className.replace(" destructive", ""));
    fireEvent.click(always);
    expect(fakeBridge.log.filter((l) => l.cmd === "approval_answer").at(-1)?.args).toMatchObject({ id: APPROVAL_LOW.id, decision: "always", surface: "card" });
  });
  it("locked or presenting: no command, no rule text, no 'Always'; Allow / Deny stay", () => {
    const { container } = render(<ApprovalCard a={APPROVAL_LOW} generic />);
    expect(container.textContent).not.toContain("npm run test");
    expect(container.querySelector(".code")).toBeNull();
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Allow" }) && screen.getByRole("button", { name: "Deny" })).toBeTruthy();
    const bump = render(<ApprovalBump a={APPROVAL_LOW} generic onDetail={() => undefined} />);
    expect(bump.container.querySelector(".codeRow")).toBeNull();
  });
  it("with an unknown risk the card behaves like high risk", () => {
    render(<ApprovalCard a={{ ...APPROVAL_LOW, risk: undefined }} />);
    expect(screen.queryByText("Always allow")).toBeNull();
  });
  it("Claude's question: option list and text box; the answer goes with the selection", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_CHOICE} />);
    advance(600);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /new component/ }));
    fireEvent.click(screen.getByRole("button", { name: "Write another answer" })); // the text box opens with the button (mockup c3)
    fireEvent.change(screen.getByLabelText("Write another answer"), { target: { value: "file name Title.tsx" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "choice", choiceId: "new", text: "file name Title.tsx" });
  });
});

describe("300 ms guard", () => {
  it("'Allow' on the peek is ignored for the first 300 ms", () => {
    vi.useFakeTimers();
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(answers()).toHaveLength(0);
    advance(599);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(answers()).toHaveLength(0);
    advance(2);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(answers()).toEqual([expect.objectContaining({ decision: "allow" })]);
  });
  it("a card.module button and a peek button are also ignored for the first 300 ms", () => {
    vi.useFakeTimers();
    render(<><TabBlocks tab={{ plugin: COMPASS, id: "t", title: "Compass", blocks: [{ type: "buttons", buttons: [{ id: "stop", label: "Stop", style: "destructive" }] }] }} /><ProtrusionBump item={PROTRUSION} /></>);
    const calls = () => fakeBridge.log.filter((l) => l.cmd === "plugin_action").length;
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(calls()).toBe(0);
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(calls()).toBe(2);
  });
  it("on high risk, press-and-hold does not count for the first 300 ms either", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_HIGH} />);
    const b = screen.getByRole("button", { name: "Allow: press and hold" });
    fireEvent.pointerDown(b, { button: 0 });
    advance(1300);
    expect(answers()).toHaveLength(0);
    fireEvent.pointerUp(b);
    fireEvent.pointerDown(b, { button: 0 });
    advance(1250);
    expect(answers()).toEqual([expect.objectContaining({ decision: "allow" })]);
  });
});

describe("identity: name prefix and mascot", () => {
  it("the prefix is always first; a plugin title cannot remove or imitate it", () => {
    expect(prefixed(OTHER, "Peeka › System")).toBe("Sample Assistant › Peeka - System");
    expect(prefixed(OTHER, "")).toBe("Sample Assistant");
    expect(prefixed({ name: "Fake › Compass" }, "x")).toBe("Fake - Compass › x");
    expect(prefixed(OTHER, "a‮​b")).toBe("Sample Assistant › ab");
  });
  it("the name prefix is drawn in the peek title and in the approval source", () => {
    const { container } = render(<ProtrusionCenter item={{ ...PROTRUSION, plugin: OTHER, title: "Fake › Compass › Approval" }} />);
    expect(container.textContent).toContain("Sample Assistant › Fake - Compass - Approval");
    render(<ApprovalCard a={{ ...APPROVAL_LOW, plugin: OTHER, source: "Compass" }} />);
    expect(screen.getByText(/Sample Assistant › Compass/)).toBeTruthy();
  });
  it("mascot is accepted only for the main assistant and only for a state in the table", () => {
    expect(mascotOf(OTHER, "listening")).toBeNull();
    expect(mascotOf(COMPASS, "listening")).toBe("listening");
    expect(mascotOf(COMPASS, "<script>")).toBeNull();
    const other = render(<ProtrusionCenter item={{ ...PROTRUSION, plugin: OTHER, mascot: "listening" }} />);
    expect(other.container.querySelector("[data-mk]")).toBeNull();
    expect(other.container.querySelector(".initials")?.textContent).toBe("S");
    other.unmount();
    const main = render(<ProtrusionCenter item={{ ...PROTRUSION, mascot: "listening" }} />);
    expect(main.container.querySelector("[data-mk='listening']")).not.toBeNull();
  });
});

describe("no HTML injection", () => {
  const evil = '<img src=x onerror="window.pwned=1"><a href="javascript:1">click</a>';
  it("peek, approval and tab texts are drawn as plain text", () => {
    const { container } = render(<>
      <ProtrusionCenter item={{ ...PROTRUSION, title: evil, subtitle: evil, icon: evil }} />
      <ProtrusionBump item={{ ...PROTRUSION, subtitle: evil, actions: [{ id: "a", label: evil }] }} />
      <ApprovalCard a={{ ...APPROVAL_LOW, title: evil, command: evil, cwd: evil, detail: evil, alwaysLabel: evil }} />
      <TabBlocks tab={{ plugin: COMPASS, id: "t", title: evil, blocks: [{ type: "heading", text: evil }, { type: "text", text: evil }, { type: "list", rows: [{ title: evil, sub: evil, value: evil }] }, { type: "kv", rows: [{ k: evil, v: evil }] }] }} />
    </>);
    expect(container.querySelector("img:not(.mascot img)")).toBeNull(); // except the mascot's own images
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });
  it("the image block accepts only small PNG/JPEG data: URLs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(safeImage(png)).toBe(png);
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "https://x/y.png", 'data:image/png;base64,AA" onerror="x', "data:image/png;base64," + "A".repeat(400_000)]) expect(safeImage(bad)).toBeNull();
    const { container } = render(<TabBlocks tab={{ plugin: COMPASS, id: "t", title: "Compass", blocks: [{ type: "image", src: "data:image/svg+xml;base64,PHN2Zz4=" }, { type: "image", src: png }] }} />);
    expect(container.querySelectorAll("img.blockImage")).toHaveLength(1);
  });
});

describe("island: plugin surfaces", () => {
  it("a high-risk approval peek shows only 'Details'; Details opens the card, Esc returns to the peek", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_HIGH], approvalTop: "ap-2" });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Details" })).toBeTruthy();
  });
  it("Ctrl+Space opens the chat box if there is a main assistant, otherwise the 'Compass isn't connected' card", async () => {
    const r = render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    act(() => fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }));
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    expect(screen.getByRole("dialog", { name: "Compass isn't connected" })).toBeTruthy();
    r.unmount();
    fakeBridge.setSurfaces({ composer: { ...COMPASS, voice: false } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    act(() => fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }));
    await act(async () => { await new Promise((x) => setTimeout(x, 40)); });
    expect(screen.getByRole("dialog", { name: "Ask" })).toBeTruthy();
  });
});

function Harness() {
  const c = useComposer();
  const [, force] = useState(0);
  void force;
  return <ComposerCard owner={{ ...COMPASS, voice: false }} turns={c.turns} send={c.send} />;
}
describe("Ctrl+Space flow", () => {
  it("the chip is attached only when clicked; the answer streams in pieces, then source chips and the end arrive", async () => {
    vi.useFakeTimers();
    fakeBridge.addClip({ id: "k1", createdAt: Date.now(), pinned: false, source: "Chrome", kind: "text", text: "https://example.com/x", hint: "link", sub: null, thumb: null, screenshot: false });
    render(<Harness />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByLabelText(/Ask/), { target: { value: "What is on tomorrow?" } });
    fireEvent.click(screen.getByRole("button", { name: /Link on clipboard/ }));
    fireEvent.keyDown(screen.getByLabelText(/Ask/), { key: "Enter" });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "composer_submit", args: { text: "What is on tomorrow?", attachments: [{ kind: "clipboard_link" }] } });
    expect(screen.getByText("What is on tomorrow?")).toBeTruthy();
    expect(screen.getByText(/9:30 AM design review\s*$/)).toBeTruthy(); // first chunk
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText(/at 9:15\./)).toBeTruthy();
    expect(screen.getByText("Read 3 notes")).toBeTruthy();
    expect(screen.getByText("Reminder 9:15 AM")).toBeTruthy();
  });
  it("sending without clicking attaches nothing", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/Ask/), { target: { value: "Hello" } });
    fireEvent.keyDown(screen.getByLabelText(/Ask/), { key: "Enter" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fakeBridge.log.at(-1)).toMatchObject({ args: { attachments: [] } });
  });
  it("an error is shown on the card", async () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/Ask/), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByLabelText(/Ask/), { key: "Enter" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    act(() => fakeBridge.emit("composer_event", { turn: 1, kind: "error", message: "Compass is not responding" }));
    expect(screen.getByRole("alert").textContent).toContain("Compass is not responding");
  });
});

describe("plugin consent window", () => {
  const req = () => ({ ...CONSENT, expiresAt: Date.now() + 120_000 });
  it("content of the nine items: identity, program, similar name, three tiers, risk sentence, what is never granted, network sentence", () => {
    const { container } = render(<ConsentBody req={req()} onClose={() => undefined} />);
    const t = container.textContent ?? "";
    for (const s of ["A new plugin wants to connect", "Publisher: Example · not verified", "Unsigned", "This name looks like a plugin that's already connected.", "Low", "Medium", "High",
      "The plugin states its own risk level. Peeka can't verify it.", "Make it the main assistant?", "No plugin can see your passwords", "may use its own internet connection", "Don't ask again for this plugin", "2.1 · dev.example.compass"]) expect(t).toContain(s);
    const boxes = screen.getAllByRole("checkbox").map((b) => b.getAttribute("aria-checked"));
    expect(boxes).toEqual(["true", "true", "true", "false", "false"]); // low, medium, medium, main assistant, high
  });
  it("asking for both composer.handler and voice.line shows 'Make it the main assistant?' once", () => {
    render(<ConsentBody req={{ ...req(), scopes: [...CONSENT.scopes, "voice.line"] }} onClose={() => undefined} />);
    expect(screen.getAllByRole("checkbox", { name: "Make it the main assistant?" })).toHaveLength(1);
  });
  it("default focus is on 'Deny'; Esc denies", async () => {
    render(<ConsentWindow req={req()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.activeElement?.textContent).toContain("Deny");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "consent_answer", args: { allow: false, scopes: [] } });
  });
  it("'Allow' is ignored for the first 600 ms (useGuard), then goes out with only the checked scopes", () => {
    vi.useFakeTimers();
    render(<ConsentBody req={req()} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(fakeBridge.log).toHaveLength(0);
    advance(400);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(fakeBridge.log).toHaveLength(0);
    advance(300);
    fireEvent.click(screen.getByRole("checkbox", { name: "Make it the main assistant?" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "consent_answer", args: { allow: true, mainAssistant: true, never: false, scopes: ["island.protrusion", "approvals.prompt", "composer.handler"] } });
  });
  it("with no answer in 2 minutes it is denied automatically; the countdown is visible", () => {
    vi.useFakeTimers();
    render(<ConsentBody req={req()} onClose={() => undefined} />);
    expect(screen.getByRole("timer").textContent).toBe("Denies in 2:00");
    advance(60_000);
    expect(screen.getByRole("timer").textContent).toBe("Denies in 1:00");
    advance(60_500);
    expect(fakeBridge.log.filter((l) => l.cmd === "consent_answer")).toHaveLength(1);
    expect(fakeBridge.log.at(-1)).toMatchObject({ args: { allow: false, scopes: [] } });
  });
  it("'Don't ask again' writes to the blocklist", () => {
    render(<ConsentBody req={req()} onClose={() => undefined} />);
    fireEvent.click(screen.getByText("Don't ask again for this plugin"));
    expect(fakeBridge.log.at(-1)).toMatchObject({ args: { allow: false, never: true } });
  });
  it("plugin name and reasons are drawn as plain text", () => {
    const evil = '<img src=x onerror="1">';
    const { container } = render(<ConsentBody req={{ ...req(), plugin: { ...CONSENT.plugin, name: evil, publisher: evil }, why: { "island.protrusion": evil } }} onClose={() => undefined} />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("approval surface and countdown", () => {
  it("an answer given from the peek sends surface: 'protrusion', from the card 'card'", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "allow", surface: "protrusion" });
    unmount();
    render(<ApprovalCard a={APPROVAL_LOW} />);
    advance(600);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(fakeBridge.log.at(-1)?.args).toMatchObject({ decision: "allow", surface: "card" });
  });
  it("the countdown counts from the first time the item was seen; it does not restart on a surface update (re-render)", () => {
    vi.useFakeTimers();
    const a = { ...APPROVAL_LOW, id: "counter-1", expiresS: 100 };
    const { rerender } = render(<ApprovalCard a={a} />);
    advance(40_000);
    rerender(<ApprovalCard a={{ ...a }} />); // Rust resends the same expiresS on every update
    expect(screen.getByRole("timer").textContent).toBe("1:00");
  });
});

describe("Rust security fields", () => {
  it("freeTextWarning: a warning naming the plugin above the text box, linked to the box via aria-describedby; no warning without the field", () => {
    const a = { ...APPROVAL_CHOICE, plugin: OTHER, freeTextWarning: true };
    const { unmount } = render(<ApprovalCard a={a} />);
    fireEvent.click(screen.getByRole("button", { name: "Write another answer" }));
    const warn = screen.getByText(/This question is from Sample Assistant. Don't type passwords here/);
    expect(screen.getByRole("textbox", { name: "Write another answer" }).getAttribute("aria-describedby")).toBe(warn.id);
    expect(warn.compareDocumentPosition(screen.getByRole("textbox")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<ApprovalCard a={{ ...APPROVAL_CHOICE, plugin: OTHER }} />);
    fireEvent.click(screen.getByRole("button", { name: "Write another answer" }));
    expect(screen.queryByText(/Don't type passwords here/)).toBeNull();
    expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBeNull();
  });
  it("when the scan returns denied, the notch://notice text shows, otherwise the default reason", async () => {
    render(<Harness />);
    fakeBridge.setScanDenied(true);
    const btn = await screen.findByRole("button", { name: "Attach screenshot" });
    const scan = () => fireEvent.click(btn);
    scan();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByRole("status").textContent).toBe("This window belongs to a sensitive app, so it wasn't scanned");
    act(() => fakeBridge.emit("notch://notice", "Password manager is open; scan skipped"));
    scan();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByRole("status").textContent).toBe("Password manager is open; scan skipped");
  });
  it("a plugin name cannot carry the separator: the prefix is printed with a single '›'", () => {
    const { container } = render(<ApprovalCard a={{ ...APPROVAL_LOW, plugin: { ...OTHER, name: "Fake › Compass" } }} />);
    expect(container.textContent).toContain("Fake - Compass ›");
    expect(container.textContent).not.toContain("Fake ›");
  });
});
