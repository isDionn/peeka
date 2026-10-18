import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipItem, ClipPlain } from "../bridge";
import { Island } from "../components/Island";
import { stripKind } from "../components/Pano";

// Copy strip (decision 2026-10-17, rows 1 and 6): every image, file and link opens a peek; plain text and passwords do not;
// on an image a large preview appears below while hovered (the top row stays put); nothing shows while locked.
const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
// With fake timers on (vi.useFakeTimers at the start of the test) there is no real waiting: same result under load; 16 ms step = one frame, React work (effects, timers) is flushed after each step
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 80) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const THUMB = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3"/></svg>');
const clip = (id: string, p: Partial<ClipPlain>): ClipPlain => ({ id, createdAt: Date.now(), pinned: false, source: "Paint", kind: "image", text: null, sub: null, thumb: THUMB, screenshot: false, ...p });
const copy = async (c: ClipItem) => { act(() => fakeBridge.addClip(c)); await settle(); };
const bump = () => document.querySelector(".shotOut");
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("stripKind", () => {
  it("image, file and link open a peek; plain text, color and password do not", () => {
    expect(stripKind(clip("a", {}))).toBe("image");
    expect(stripKind(clip("b", { kind: "file", text: "report.pdf", thumb: null }))).toBe("file");
    expect(stripKind(clip("c", { kind: "text", text: "https://example.com", hint: "link", thumb: null }))).toBe("link");
    expect(stripKind(clip("d", { kind: "text", text: "hello", thumb: null }))).toBeNull();
    expect(stripKind(clip("e", { kind: "text", text: "#ff0000", hint: "color", thumb: null }))).toBeNull();
    expect(stripKind({ id: "p", createdAt: 1, pinned: false, source: null, kind: "password", expiresAt: 9 })).toBeNull();
  });
});

describe("copy strip", () => {
  it("an image that is not a screenshot opens a peek too; the large preview only while hovered", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(bump()).toBeNull();
    await copy(clip("g1", {}));
    expect(bump()).not.toBeNull();
    expect(bump()!.querySelector(".snipSmall")).not.toBeNull();
    expect(document.querySelector(".shotLarge")).toBeNull();
    fireEvent.pointerEnter(document.querySelector("#island")!);
    await settle(250);
    expect(document.querySelector(".shotLarge")).not.toBeNull();
    // same nodes while the top row grows: Ask Compass/Edit keep their place (same .shotTop, not rebuilt)
    expect(bump()!.querySelectorAll(".shotTop").length).toBe(1);
    const names = [...document.querySelectorAll(".shotLarge button")].map((b) => b.textContent);
    expect(names).toEqual(["Copy", "Keep", "Open", "Add to Shelf"]);
    fireEvent.click(document.querySelector(".shotLarge button")!);
    expect(calls("clip_copy")).toHaveLength(1);
    fireEvent.pointerLeave(document.querySelector("#island")!);
    await settle(400);
    expect(document.querySelector(".shotLarge")).toBeNull();
  });

  it("file and link open a peek, plain text and password do not", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(clip("t1", { kind: "text", text: "an ordinary sentence", thumb: null }));
    expect(bump()).toBeNull();
    await copy({ id: "pw", createdAt: Date.now(), pinned: false, source: "Vault", kind: "password", expiresAt: Date.now() + 60_000 });
    expect(bump()).toBeNull();
    await copy(clip("f1", { kind: "file", text: "q3-report.xlsx", sub: "1.2 MB", thumb: null }));
    expect(bump()!.textContent).toContain("q3-report.xlsx");
    expect(bump()!.querySelector(".snipSmall")).toBeNull();
    fireEvent.pointerEnter(document.querySelector("#island")!);
    await settle(250);
    expect(document.querySelector(".shotLarge")).toBeNull(); // a file does not grow
    fireEvent.pointerLeave(document.querySelector("#island")!);
    await copy(clip("l1", { kind: "text", text: "https://example.com/q3", hint: "link", thumb: null }));
    await settle(300); // the old layer fades for 140 ms
    expect(bump()!.textContent).toContain("https://example.com/q3");
  });

  it("no copy opens a peek while locked", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    await copy(clip("g2", {}));
    expect(bump()).toBeNull();
  });

  it("closes by itself after a few seconds when not hovered", { timeout: 15000 }, async () => {
    vi.useFakeTimers();
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(clip("g3", {}));
    expect(bump()).not.toBeNull();
    await settle(4600);
    await settle(400);
    expect(bump()).toBeNull();
  });
});
