import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipItem, ClipPlain } from "../bridge";
import { Island } from "../components/Island";

// "Summarize with Compass" (scenario 5): only on a link peek, only while the main assistant is connected, never while locked;
// clicking sends composer_submit with a link attachment and a "summarize" sentence (the page text never passes through the UI).
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clip = (id: string, p: Partial<ClipPlain>): ClipPlain => ({ id, createdAt: Date.now(), pinned: false, source: "Edge", kind: "text", text: null, sub: null, thumb: null, screenshot: false, ...p });
const link = (id = "l1") => clip(id, { text: "https://example.com/article", hint: "link" });
const copy = async (c: ClipItem) => { act(() => fakeBridge.addClip(c)); await settle(); };
const btn = () => [...document.querySelectorAll<HTMLButtonElement>(".shotOut button")].find((b) => /Summarize with/.test(b.textContent ?? ""));
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("Summarize with Compass", () => {
  it("shows only on a link; not on a file or an image", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(clip("f1", { kind: "file", text: "report.pdf", sub: "1 MB" }));
    expect(document.querySelector(".shotOut")).not.toBeNull();
    expect(btn()).toBeUndefined();
    await copy(link());
    await settle(300);
    expect(btn()).toBeDefined();
  });

  it("clicking sends the link attachment and the summarize sentence", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(link());
    fireEvent.click(btn()!);
    await settle();
    expect(calls("composer_submit")).toEqual([{ cmd: "composer_submit", args: { text: "Summarize this link", attachments: [{ kind: "clipboard_link" }] } }]);
  });

  it("absent while the main assistant is not connected", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setPlugins([]));
    await settle();
    await copy(link());
    expect(document.querySelector(".shotOut")).not.toBeNull();
    expect(btn()).toBeUndefined();
  });
});
