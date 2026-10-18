import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { NotificationList } from "../components/Notifications";

// Presentation (item 37): no automatic peeks, contents hidden behind the same generic label as the lock; the count stays.
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
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

const present = (on: boolean) => act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: on }));
// the old inert + aria-hidden layer that lingers briefly during a transition does not count (same as in the lock strip test)
const live = () => { const r = document.body.cloneNode(true) as HTMLElement; r.querySelectorAll("[data-leaving]").forEach((e) => e.remove()); return r; };
const text = () => live().querySelector(".islandCenter")!.textContent ?? "";
const all = () => { const r = live(); return [r.textContent ?? "", ...[...r.querySelectorAll("[aria-label],[title],[alt]")].map((e) => `${e.getAttribute("aria-label")} ${e.getAttribute("title")} ${e.getAttribute("alt")}`)].join(" "); };

describe("presentation mode", () => {
  it("music: no track name, 'Music playing' shown; comes back when the presentation ends", async () => {
    render(<Island monitor="m1" init={{ view: null, autoMusic: true, pin: true }} />);
    await settle();
    expect(all()).toContain("Night Train");
    await present(true);
    await settle();
    expect(all()).not.toContain("Night Train");
        await present(false);
    await settle();
    expect(all()).toContain("Night Train");
  });
  it("an alert opens no peek; the count stays on the strip as 'N notifications' (Compass connected)", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await present(true);
    act(() => fakeBridge.pushAlert({ id: "hidden", title: "Concealed Title 123", subtitle: "Concealed Sub" }));
    await settle();
    expect(all()).not.toContain("Concealed");
    expect(text()).toMatch(/\d+ notifications/);
    await present(false);
    await settle(300);
    expect(all()).toContain("Concealed Title 123"); // the peek comes back when the presentation ends
  });
  it("the copy strip and plugin peeks do not show", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await present(true);
    act(() => fakeBridge.addClip({ id: "s1", createdAt: Date.now(), pinned: false, source: null, kind: "file", text: "secret-report.pdf", sub: null, thumb: null, screenshot: false }));
    act(() => fakeBridge.setSurfaces({ protrusion: { plugin: { id: "compass", name: "Compass", main: true }, title: "Customer meeting", icon: "calendar", state: "info", mascot: "serious" } as never }));
    await settle(300);
    expect(all()).not.toContain("secret-report");
    expect(all()).not.toContain("Customer");
  });
});

describe("notification list", () => {
  it("during a presentation a Windows notification shows only the app name; no title or body", async () => {
    fakeBridge.pushNotice({ id: "w1", app: "Teams", title: "Salary Raise", body: "Secret body" });
    render(<NotificationList onReview={() => undefined} />);
    await settle();
    expect(all()).toContain("Salary Raise");
    await present(true);
    await settle();
    expect(all()).not.toContain("Salary Raise");
    expect(all()).not.toContain("Secret body");
    expect(all()).toContain("Teams");
    expect(all()).toContain("Presenting");
  });
});
