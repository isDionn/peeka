// Panel surface (friction 2 R2-O1, O4, O5, O6; consistency T-1): timer phrases, Clipboard filter and feedback.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ClipboardView } from "../components/Pano";
import { SearchPanel } from "../components/SearchPanel";
import { parseTimer } from "../lib/search";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset(); localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
const logged = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("parseTimer: timer phrases", () => {
  it.each([
    ["5m", 300], ["5min", 300], ["5 minutes", 300], ["timer 10 minutes", 600], ["Timer 10", 600], ["timer 7", 420],
    ["countdown 90 sec", 90], ["25 min focus", 1500], ["1 hour", 3600], ["2h", 7200], ["10 min timer", 600],
  ])("%s", (q, s) => expect(parseTimer(q)?.seconds).toBe(s));
  it("label: the trailing word", () => expect(parseTimer("25 min focus")?.label).toBe("Focus"));
  it.each(["2026", "5", "hello", "min 5", "999 h", "0 min"])("not a timer: %s", (q) => expect(parseTimer(q)).toBeNull());
});

describe("Ctrl+K timer action", () => {
  it("'5m' shows a 'Start timer: 5 min' row on top and Enter calls timer_start; it does not go to Compass", async () => {
    const close = vi.fn();
    render(<SearchPanel onClose={close} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5m" } });
    await settle();
    const first = document.querySelector('[role="option"]')!;
    expect(first.textContent).toContain("Start timer: 5 min");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(logged("timer_start")[0].args).toEqual({ label: "Timer", seconds: 300 });
    expect(logged("search_ask")).toHaveLength(0);
    expect(close).toHaveBeenCalled();
  });
  it("plain text still goes to Compass as before", async () => {
    render(<SearchPanel onClose={() => undefined} />);
    await settle();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "hello world" } });
    await settle();
    expect(screen.queryByText(/Start timer/)).toBeNull();
    fireEvent.click(document.querySelector(".assistantAsk")!);
    expect(logged("search_ask")).toHaveLength(1);
  });
});

describe("Clipboard filter", () => {
  it("filters as you type, 'No matches' when nothing matches, Esc clears", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    const box = screen.getByRole("textbox", { name: "Search clipboard" });
    fireEvent.change(box, { target: { value: "screen-rec" } });
    expect(screen.getByText("screen-recording.mp4")).toBeTruthy();
    expect(document.querySelectorAll("[data-clip]").length).toBe(1);
    fireEvent.change(box, { target: { value: "nomatchhere" } });
    expect(screen.getByText("No matches")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    expect((box as HTMLInputElement).value).toBe("");
    expect(document.querySelectorAll("[data-clip]").length).toBeGreaterThan(1);
  });
  it("a password row is found only by its source name", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    const box = screen.getByRole("textbox", { name: "Search clipboard" });
    fireEvent.change(box, { target: { value: "bitwarden" } });
    expect(document.querySelectorAll(".row.hidden").length).toBe(1);
    fireEvent.change(box, { target: { value: "Kd9!mPq2" } });
    expect(document.querySelectorAll(".row.hidden").length).toBe(0);
  });
});

describe("Clipboard feedback", () => {
  it("clicking the row body copies and says 'Copied'", async () => {
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    fireEvent.click(document.querySelector('[data-clip="c9"]')!);
    await settle();
    expect(logged("clip_copy").some((l) => (l.args as { id: string }).id === "c9")).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Copied");
  });
  it("when Compass is not connected, 'Ask Compass' is disabled and says why", async () => {
    fakeBridge.setPlugins([]);
    render(<ClipboardView />);
    await screen.findByText("screen-recording.mp4");
    fireEvent.pointerEnter(document.querySelector('[data-clip="c9"]')!);
    const b = screen.getByRole("button", { name: "Assistant not connected" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });
});
