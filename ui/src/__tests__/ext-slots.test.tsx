// Assistant slots (ext.ts) with a test-only sample extension: strip button, card (compact / full, Ctrl+Space, tuck),
// Ctrl+K rows and the privacy gate. Without an extension every slot stays empty (the other test files cover today's Peeka).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Brain, Maximize2 } from "lucide-react";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ExtStripKey } from "../components/ExtStripKey";
import { SearchPanel } from "../components/SearchPanel";
import { setExtForTest, type CardProps, type PeekaExtension } from "../ext";
import { request } from "../lib/assistant";
import { sendX } from "../lib/xwin";
import { EMPTY_SURFACES } from "../plugin.fixtures";

function Card({ size, setSize, target, surfaces, events }: CardProps) {
  return (
    <div data-testid="extcard" data-size={size} data-private={String(!!surfaces.private)}>
      <button onClick={() => setSize(size === "full" ? "compact" : "full")}>Toggle size</button>
      <span>target:{String(target ?? "")}</span>
      <span>events:{events.length}</span>
    </div>
  );
}
const sample = (takesAsk: boolean): PeekaExtension => ({
  id: "sample",
  label: "Sample",
  StripButton: ({ open, onOpen }) => <button aria-pressed={open} onClick={onOpen}>Sample key</button>,
  card: { Card, compactWidth: 520, full: { width: 1360, height: 760 }, takesAsk },
  search: {
    commands: [{ id: "full", label: "Full view", kind: "Sample", icon: Maximize2, go: { full: true } }],
    groups: [{ title: "Sample notes", method: "x.search", kind: "Note", icon: Brain, toRows: (r) => (r as { items: { id: string; title: string }[] }).items.map((i) => ({ id: i.id, title: i.title, go: { full: true, target: i.id } })) }],
  },
});

const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const card = () => screen.queryByTestId("extcard");
const layerWidth = () => (card()!.closest(".islandInner") as HTMLElement).style.width;

beforeEach(() => { fakeBridge.reset(); localStorage.clear(); });
afterEach(() => { setExtForTest(null); vi.restoreAllMocks(); });

describe("assistant slots: empty", () => {
  it("no extension: no strip button, Ctrl+Space keeps today's card, requests are invalid", async () => {
    const { container } = render(<ExtStripKey surfaces={EMPTY_SURFACES} />);
    expect(container.innerHTML).toBe("");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await settle();
    expect(card()).toBeNull();
    await expect(request("x.search", {})).rejects.toBe("invalid");
  });
});

describe("assistant slots: card", () => {
  it("the strip button opens the card; it says open back to the strip", async () => {
    setExtForTest(sample(false));
    render(<><ExtStripKey surfaces={EMPTY_SURFACES} /><Island monitor="m1" init={{ view: null }} /></>);
    await settle();
    expect(screen.getByRole("button", { name: "Sample key" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Sample key" }));
    await vi.waitFor(() => expect(card()).not.toBeNull());
    expect(card()!.dataset.size).toBe("compact");
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Sample key" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("Ctrl+Space opens the card only when it takes the ask", async () => {
    setExtForTest(sample(false));
    const a = render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await settle();
    expect(card()).toBeNull();
    a.unmount();
    setExtForTest(sample(true));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await vi.waitFor(() => expect(card()).not.toBeNull());
    await act(async () => { fakeBridge.emit("shortcut", { name: "ask", monitor: "m1" }); });
    await vi.waitFor(() => expect(card()).toBeNull()); // pressed again: closes
  });

  it("compact -> full -> compact; ext-go {full} opens full with its target; closing resets to compact", async () => {
    setExtForTest(sample(true));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => sendX({ t: "ext-go" }));
    await vi.waitFor(() => expect(card()).not.toBeNull());
    expect(layerWidth()).toBe("520px");
    fireEvent.click(screen.getByRole("button", { name: "Toggle size" }));
    await vi.waitFor(() => expect(card()!.dataset.size).toBe("full"));
    expect(layerWidth()).toBe(`${Math.min(1360, innerWidth - 144)}px`);
    fireEvent.click(screen.getByRole("button", { name: "Toggle size" }));
    await vi.waitFor(() => expect(card()!.dataset.size).toBe("compact"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(card()).toBeNull());
    act(() => sendX({ t: "ext-go", full: true, target: "n7" }));
    await vi.waitFor(() => expect(card()?.dataset.size).toBe("full"));
    expect(screen.getByText("target:n7")).toBeTruthy();
  });

  it("music or clipboard over the card tucks it: Back to Sample brings it back at the same size", async () => {
    setExtForTest(sample(true));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => sendX({ t: "ext-go", full: true }));
    await vi.waitFor(() => expect(card()?.dataset.size).toBe("full"));
    act(() => sendX({ t: "card", view: "clipboard" }));
    const backBtn = await screen.findByRole("button", { name: "Back to Sample" });
    await vi.waitFor(() => expect(card()).toBeNull()); // the old card's leave animation ends
    fireEvent.click(backBtn);
    await vi.waitFor(() => expect(card()?.dataset.size).toBe("full"));
  });

  it("while locked the lock card stands in", async () => {
    setExtForTest(sample(true));
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => sendX({ t: "ext-go" }));
    await settle(200);
    expect(card()).toBeNull();
    expect(screen.getByRole("dialog", { name: "Peeka locked" })).toBeTruthy();
  });
});

describe("assistant slots: Ctrl+K", () => {
  const type = (v: string) => fireEvent.change(screen.getByRole("combobox"), { target: { value: v } });

  it("a local command row and a request-backed group, at most 5 rows", async () => {
    setExtForTest(sample(true));
    fakeBridge.setAnswer((method, params) => ({ items: Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, title: `${method} ${String(params.query)} ${i}` })) }));
    const onClose = vi.fn();
    render(<SearchPanel onClose={onClose} />);
    await settle();
    type("full");
    expect(await screen.findByText("Full view")).toBeTruthy();
    type("notes");
    await vi.waitFor(() => expect(screen.getAllByText(/^x\.search notes \d$/)).toHaveLength(5), { timeout: 2000 });
    expect(screen.getByRole("group", { name: "Sample notes" })).toBeTruthy();
    fireEvent.click(screen.getByText("x.search notes 0"));
    expect(onClose).toHaveBeenCalled();
  });

  it("nothing is asked while the privacy gate is closed", async () => {
    setExtForTest(sample(true));
    fakeBridge.setAnswer(() => ({ items: [{ id: "a", title: "never" }] }));
    fakeBridge.setSurfaces({ private: true });
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    type("notes");
    expect(await screen.findByText("Search is off while the screen is locked, shared or presenting.")).toBeTruthy();
    await settle(400);
    expect(fakeBridge.log.some((l) => l.cmd === "assistant_request")).toBe(false);
  });
});

describe("assistant slots: data path helper", () => {
  it("request resolves with the result and rejects with the error code", async () => {
    fakeBridge.setAnswer((m) => { if (m === "x.bad") throw -32050; return { ok: m }; });
    await expect(request("x.get", {})).resolves.toEqual({ ok: "x.get" });
    await expect(request("x.bad", {})).rejects.toBe(-32050);
    fakeBridge.setLocked(true);
    await expect(request("x.get", {})).rejects.toBe("denied");
  });

  it("events reach an open card", async () => {
    setExtForTest(sample(true));
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => sendX({ t: "ext-go" }));
    await vi.waitFor(() => expect(card()).not.toBeNull());
    act(() => { fakeBridge.emit("assistant_event", { type: "step", data: {} }); fakeBridge.emit("assistant_event", { type: "step", data: {} }); });
    expect(screen.getByText("events:2")).toBeTruthy();
  });
});
