import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Shell } from "../components/Shell";

// Çoklu monitör (39/40): `fullscreen_screens {island, strips[]}` yalnız o şeridi gizler; `approval_badge` ikinci şeritte rozet.
beforeEach(() => { fakeBridge.reset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
// Sanal saat açıkken (testin başında vi.useFakeTimers) gerçek bekleme yok: yük altında da aynı sonuç; 16 ms adım = bir kare, her adım sonunda React işi (efektler, zamanlayıcılar) işlenir
const fakeSettle = async (ms: number) => { for (let t = 0; t < ms; t += 16) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(16, ms - t)); }); };
const settle = (ms = 60) => vi.isFakeTimers() ? fakeSettle(ms) : act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const bar = (c: HTMLElement) => c.querySelector<HTMLElement>(".cubuk")!;

describe("fullscreen_screens (F)", () => {
  it("yalnız listedeki monitörün şeridi yukarı kayar; öteki yerinde", async () => {
    vi.useFakeTimers();
    const a = render(<Shell monitor="m1" />);
    await settle();
    act(() => fakeBridge.emit("fullscreen_screens", { island: false, strips: ["m2"] }));
    await settle(600);
    expect(bar(a.container).style.transform).toBe("");
    act(() => fakeBridge.emit("fullscreen_screens", { island: true, strips: ["m1"] }));
    await settle(900);
    expect(bar(a.container).style.transform).toMatch(/translateY\(-/);
    act(() => fakeBridge.emit("fullscreen_screens", { island: false, strips: [] }));
    await settle(1800);
    expect(parseFloat(/-?[\d.]+/.exec(bar(a.container).style.transform || "0")![0])).toBeGreaterThan(-3); // yay oturuyor: geri indi
  });
});

describe("approval_badge (F)", () => {
  it("ikinci ekran şeridinde 'N onay' rozeti; null gelince kalkar; başka monitörünki görünmez; birincil şeritte yok", async () => {
    const a = render(<Shell monitor="m2" />);
    await settle();
    act(() => fakeBridge.emit("approval_badge", { monitor: "m3", count: 2 }));
    await settle();
    expect(a.container.querySelector(".onayRozet")).toBeNull();
    act(() => fakeBridge.emit("approval_badge", { monitor: "m2", count: 2 }));
    await settle();
    expect(a.container.querySelector(".onayRozet")?.textContent).toBe("2 onay");
    expect(a.container.querySelector(".onayRozet")?.getAttribute("aria-label")).toBe("2 onay bekliyor");
    act(() => fakeBridge.emit("approval_badge", null));
    await settle();
    expect(a.container.querySelector(".onayRozet")).toBeNull();
  });
});
