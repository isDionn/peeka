import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";

// While locked the strip shows a generic label instead of content (decision 2026-10-17): track name, artist, cover and alert text
// appear neither in the text, nor in title/aria/alt attributes, nor in an img source.
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
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
const ATTRS = ["title", "aria-label", "aria-valuetext", "aria-description", "alt", "src", "placeholder"];
/** Text + every element's readable attributes in one string (leak scan). */
const surface = () => {
  // `[data-leaving]`: the old layer that lingers briefly during a transition, inert + aria-hidden (not clickable, not read); not counted.
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll("[data-leaving]").forEach((e) => e.remove());
  const parts = [root.textContent ?? ""];
  root.querySelectorAll("*").forEach((el) => ATTRS.forEach((a) => { const v = el.getAttribute(a); if (v) parts.push(v); }));
  return parts.join("\n");
};
const SONG = ["Night Train", "Lowtide"];

describe("locked strip: generic label instead of content", () => {
  it("music peek: no track, artist or cover; 'Music playing' shown; playback buttons work", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    expect(surface()).toContain("Night Train");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    const s = surface();
    SONG.forEach((w) => expect(s).not.toContain(w));
    expect(s).not.toContain("data:image");
    expect(s).toContain("Music playing");
    expect(document.querySelector("button.islandCenter")!.getAttribute("aria-label")).toContain("Music playing");
    expect(document.querySelector('[aria-label="Pause"]')).toBeTruthy();
    act(() => fakeBridge.setLocked(false));
    await settle();
    expect(surface()).toContain("Night Train");
  });

  it("the idle-center music row and the button name are generic too", async () => {
    fakeBridge.setPlugins([]); // without Compass the strip center is the clock + music row
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(surface()).toContain("Night Train");
    act(() => fakeBridge.setLocked(true, "windows"));
    await settle();
    const s = surface();
    SONG.forEach((w) => expect(s).not.toContain(w));
    expect(s).not.toContain("data:image");
    expect(s).toContain("Music playing");
  });

  it("alert peek: no title or subtitle, 'Alert' shown; Open and Later buttons work", async () => {
    fakeBridge.pushAlert({ id: "secret", title: "SECRET-TITLE", subtitle: "SECRET-SUB", action: "https://example.test/x", expand: true });
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    expect(surface()).toContain("SECRET-TITLE");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    const s = surface();
    expect(s).not.toContain("SECRET");
    expect(s).toContain("Alert");
    const names = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(["Open", "Later"]));
    act(() => fakeBridge.setLocked(false));
    await settle();
    expect(surface()).toContain("SECRET-TITLE");
  });

  it("locking turns an open music card into the lock card (the track name does not stay on the card)", async () => {
    render(<Island monitor="m1" init={{ view: "music-card", pin: true }} />);
    await settle();
    expect(surface()).toContain("Night Train");
    act(() => fakeBridge.setLocked(true, "manual"));
    await settle();
    SONG.forEach((w) => expect(surface()).not.toContain(w));
  });
});
