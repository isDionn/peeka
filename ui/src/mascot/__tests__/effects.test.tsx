// Mascot behaviors: duration and value checks with fake timers (rAF and performance are fake too, 16 ms steps).
import { act, createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mascot, type MascotHandle } from "../Mascot";
import type { Mood } from "../moods";
import { resetMascotRegistry } from "../useSingleMascot";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetMascotRegistry(); });

const adv = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const mount = (size: number, mood: Mood = "idle", extra: Record<string, unknown> = {}) => {
  const ref = createRef<MascotHandle>();
  const ui = (m: Mood) => <Mascot ref={ref} size={size} mood={m} isMainAssistant single={false} {...extra} />;
  const r = render(ui(mood));
  return { ...r, ref, set: (m: Mood) => r.rerender(ui(m)), q: (s: string) => r.container.querySelector(s) as HTMLElement | null };
};
const scale = (el: HTMLElement) => (/scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(el.style.transform) ?? []).slice(1).map(Number) as [number, number];
const tx = (el: HTMLElement) => Number(/translate\(([-\d.e]+)px/.exec(el.style.transform)?.[1]);

describe("the idle loop stops", () => {
  it("rAF isn't called without motion; a hop wakes the loop, and it stops again when done", async () => {
    const m = mount(56, "idle");
    adv(200);
    expect(m.ref.current!.running()).toBe(false);
    const spy = vi.spyOn(window, "requestAnimationFrame");
    adv(5000);
    expect(spy).not.toHaveBeenCalled();
    m.ref.current!.hop();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(m.ref.current!.running()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });   // the hop sequence is async (await wait), so advance asynchronously for microtasks
    expect(m.ref.current!.running()).toBe(false);
  });
  it("the 24 px strip stops too; a talking mouth (speaking) doesn't", () => {
    const a = mount(24, "idle"); adv(300); expect(a.ref.current!.running()).toBe(false);
    const b = mount(56, "speaking"); adv(2000); expect(b.ref.current!.running()).toBe(true);
  });
  it("the gaze stops once it reaches the target", () => {
    const m = mount(56, "idle", { cursor: { x: 200, y: 0 } });
    adv(100); expect(m.ref.current!.running()).toBe(true);
    adv(3000); expect(m.ref.current!.running()).toBe(false);
  });
});

describe("permission badge", () => {
  it("56 px: the old badge is removed, comes back after 100 ms; removed when the mood ends", () => {
    const m = mount(56, "idle");
    expect(m.q(".g-badge")!.dataset.s).toBe("out");
    m.set("approval");
    adv(99); expect(m.q(".g-badge")!.dataset.s).toBe("out");
    adv(1); expect(m.q(".g-badge")!.dataset.s).toBe("in");
    expect(m.q(".g-light")!.style.opacity).toBe("0.45");   // the amber light strengthens
    m.set("idle"); expect(m.q(".g-badge")!.dataset.s).toBe("out");
  });
  it("the approval '!' badge is hidden below 56 (no badge at 24, 28; at 40 only labeled moods)", () => {
    for (const s of [24, 28]) { const m = mount(s, "approval"); adv(300); expect(m.q(".g-badge")).toBeNull(); m.unmount(); }
    const m = mount(40, "approval"); adv(300); expect(m.q(".g-badge")!.dataset.s).toBe("out"); m.unmount();
  });
  it("the keyboard hint slot only at ≥56 px and in the permission mood", () => {
    const a = mount(56, "approval", { badgeHint: <kbd>Y</kbd> }); expect(a.q(".mascot-hint kbd")).toBeTruthy(); a.set("idle"); expect(a.q(".mascot-hint")).toBeNull(); a.unmount();
    const b = mount(40, "approval", { badgeHint: <kbd>Y</kbd> }); expect(b.q(".mascot-hint")).toBeNull();
  });
});

describe("error jitter", () => {
  it("56 px: +4, -4, +2.5, 0 px; calm after 280 ms", () => {
    const m = mount(56, "idle"); adv(100);
    m.set("error");
    const sway = m.q(".g-sway")!;
    adv(48); expect(tx(sway)).toBeGreaterThan(3.3);
    adv(80); expect(tx(sway)).toBeLessThan(-3.3);       // t=128
    adv(64); expect(tx(sway)).toBeGreaterThan(1.8);     // t=192
    adv(300); expect(tx(sway)).toBe(0);
  });
  it("no jitter below 56", () => {
    const m = mount(40, "idle"); adv(100); m.set("error"); adv(48);
    expect(tx(m.q(".g-sway")!)).toBe(0);
  });
});

describe("done sparkle", () => {
  it("56 px: starts at 500 ms, 5 sparkles 140 ms apart; then all disappear", () => {
    const m = mount(56, "idle"); adv(100);
    m.set("done");
    const n = () => m.container.querySelectorAll(".g-spark").length;
    adv(499); expect(n()).toBe(0);
    adv(1); expect(n()).toBe(1);
    adv(140); expect(n()).toBe(2);
    adv(140); expect(n()).toBe(3);
    adv(140); expect(n()).toBe(4);
    adv(140); expect(n()).toBe(5);
    adv(2000); expect(n()).toBe(0);
  });
  it("40 px: no sparkle", () => {
    const m = mount(40, "idle"); adv(100); m.set("done"); adv(1500);
    expect(m.container.querySelectorAll(".g-spark").length).toBe(0);
  });
});

describe("gaze", () => {
  it("40 px: the eye target moves with tanh and exponential smoothing", () => {
    const m = mount(40, "idle", { cursor: { x: 260, y: 200 } });
    const track = m.q(".g-eyes-track")!;
    adv(16);
    const first = Number(/translate\(([-\d.e]+)%/.exec(track.style.transform)![1]);
    expect(first).toBeGreaterThan(0.1); expect(first).toBeLessThan(0.6);   // 2.59 is ~9% of the target
    adv(1000);
    expect(track.style.transform).toBe(`translate(${Math.tanh(1) * 3.4}%, ${Math.tanh(1) * 2.6}%)`);
  });
  it("24 px: no eye tracking", () => {
    const m = mount(24, "idle", { cursor: { x: 260, y: 0 } }); adv(500);
    expect(m.q(".g-eyes-track")).toBeNull();
  });
});

describe("file swallow", () => {
  it("swallow: sy 0.78 -> 1.18 -> 1; mouth open 460 ms", () => {
    const m = mount(56, "idle"); adv(100);
    const sq = m.q(".g-squash")!, mouth = m.q(".g-mouth")!;
    m.ref.current!.swallow();
    adv(80); expect(scale(sq)[1]).toBeCloseTo(.78, 1); expect(mouth.dataset.d).toBe("mouth-open");
    adv(128); expect(scale(sq)[1]).toBeCloseTo(1.18, 1);
    adv(224); expect(scale(sq)[1]).toBeCloseTo(1, 1);
    adv(120); expect(mouth.dataset.d).toBe("mouth-smile");   // 552 > 460
  });
  it("swallow: a file icon appears and shrinks into the mouth; when the mouth closes, 3 chews, then the mouth returns to normal", () => {
    const m = mount(56, "idle"); adv(100);
    const mouth = m.q(".g-mouth")!;
    m.ref.current!.swallow(); adv(50);
    expect(m.container.querySelectorAll(".g-file").length).toBe(1);
    adv(330); expect(m.container.querySelectorAll(".g-file").length).toBe(0); expect(mouth.dataset.d).toBe("mouth-open");   // 380 ms: icon gone, mouth still open (chewing starts at 460)
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) { adv(60); seen.add(mouth.dataset.d!); }
    expect(seen.has("mouth-o") && seen.has("mouth-smile")).toBe(true);   // chewing: o <-> smile
    adv(600); expect(mouth.dataset.d).toBe("mouth-smile");
    expect(m.q(".g-eye")!.dataset.d).toBe("eye-open");
  });
  it("24 px: squash only, no mouth", () => {
    const m = mount(24, "idle"); adv(100);
    m.ref.current!.swallow(); adv(80);
    expect(scale(m.q(".g-squash")!)[1]).toBeCloseTo(.78, 1);
  });
  it("onFileDrop: swallows and is called when a file is dropped; a drag without files is ignored", () => {
    const onFileDrop = vi.fn();
    const m = mount(56, "idle", { onFileDrop }); adv(100);
    const f = new File(["x"], "a.txt");
    fireEvent.drop(m.q(".mascot")!, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(onFileDrop).not.toHaveBeenCalled();
    fireEvent.drop(m.q(".mascot")!, { dataTransfer: { types: ["Files"], files: [f] } });
    expect(onFileDrop).toHaveBeenCalledWith([f]);
    expect(m.q(".g-mouth")!.dataset.d).toBe("mouth-open");
  });
});

describe("daze on click (96 px only)", () => {
  const eyes = (m: ReturnType<typeof mount>) => m.q(".g-eye")!.dataset.d;
  it("1 click: dizzy for 800 ms", () => {
    const m = mount(96, "sleeping"); adv(100);
    const base = eyes(m);
    fireEvent.pointerDown(m.q(".mascot")!);
    adv(799); expect(eyes(m)).toBe("eye-dizzy");
    adv(2); expect(eyes(m)).toBe(base);
  });
  it("3 clicks within 1.7 s: 3.3 s", () => {
    const m = mount(96, "idle"); adv(100);
    const el = m.q(".mascot")!;
    fireEvent.pointerDown(el); adv(500); fireEvent.pointerDown(el); adv(500); fireEvent.pointerDown(el);
    adv(3299); expect(eyes(m)).toBe("eye-dizzy");
    adv(2); expect(eyes(m)).toBe("eye-open");
  });
  it("the long daze from 3 clicks isn't shortened by a later 4th click", () => {
    const m = mount(96, "idle"); adv(100);
    const el = m.q(".mascot")!;
    for (let i = 0; i < 3; i++) { fireEvent.pointerDown(el); adv(200); }
    fireEvent.pointerDown(el);                       // 4th click: the single-click duration (800) doesn't shorten the longer one
    adv(2500); expect(eyes(m)).toBe("eye-dizzy");   // still dizzy ~3.1 s after the 3rd click
    adv(800); expect(eyes(m)).toBe("eye-open");
  });
  it("56 and 40 px: no daze", () => {
    for (const s of [56, 40]) {
      const m = mount(s, "idle"); adv(100);
      fireEvent.pointerDown(m.q(s === 40 ? ".mascot-hit" : ".mascot")!); adv(50);
      expect(eyes(m)).toBe("eye-line"); m.unmount();   // not dizzy: slap (squinting eyes)
    }
  });
});

describe("40 px hanging pose", () => {
  it("box 40x30, hit box on the body; clicks only via the hit box", () => {
    const onPoke = vi.fn();
    const m = mount(40, "idle", { onPoke }); adv(100);
    const host = m.q(".mascot")!, hit = m.q(".mascot-hit")!;
    expect([host.style.width, host.style.height, host.dataset.hang]).toEqual(["40px", "30px", "1"]);
    expect([hit.style.left, hit.style.top, hit.style.width, hit.style.height]).toEqual(["5px", "5px", "30px", "37px"]);
    expect(m.q(".g")!.classList.contains("hung")).toBe(true);
    fireEvent.pointerDown(host); expect(onPoke).not.toHaveBeenCalled();
    fireEvent.pointerDown(hit); expect(onPoke).toHaveBeenCalledTimes(1);
    expect(m.ref.current!.hitRect()).toEqual({ x: 0, y: 0, width: 0, height: 0 });   // jsdom has no layout; the real value is measured in a browser frame
  });
  it("mood effects at 40 px: permission = hand wave, error = star ring, listening = ear waves", () => {
    const on = (m: ReturnType<typeof mount>, cls: string) => m.q(`.${cls}`)!.classList.contains("shown");
    const m = mount(40, "approval"); expect(on(m, "fx-wave")).toBe(true); expect(on(m, "fx-sign")).toBe(false);
    m.set("error"); expect(on(m, "fx-ring")).toBe(true);
    m.set("listening"); expect(on(m, "fx-mintLeft")).toBe(true);
    m.set("thinking"); expect(on(m, "fx-dots")).toBe(true);
    m.set("done"); expect(on(m, "fx-sparkle")).toBe(true);
  });
});

describe("touch reactions", () => {
  const hitOf = (m: ReturnType<typeof mount>) => m.q(".mascot-hit")!;
  const eyes = (m: ReturnType<typeof mount>) => m.q(".g-eye")!.dataset.d;
  it("slap: eyes squint, return to the previous look after ~600 ms; the mood doesn't change", () => {
    const onPoke = vi.fn();
    const m = mount(40, "idle", { onPoke }); adv(100);
    fireEvent.pointerDown(hitOf(m)); adv(100);
    expect(eyes(m)).toBe("eye-line"); expect(m.q(".mascot")!.dataset.mood).toBe("idle");
    adv(700); expect(eyes(m)).toBe("eye-open");
    expect(onPoke).toHaveBeenCalledTimes(1);
  });
  it("click flood: the real action (onPoke) runs on every click; the 5th click makes it dizzy, it returns to the real mood when the time is up, no loop", () => {
    const onPoke = vi.fn();
    const m = mount(40, "idle", { onPoke }); adv(100);
    for (let i = 0; i < 8; i++) { fireEvent.pointerDown(hitOf(m)); adv(50); }   // 8 clicks in 400 ms
    expect(onPoke).toHaveBeenCalledTimes(8);
    expect(m.q(".mascot")!.dataset.mood).toBe("dizzy"); expect(eyes(m)).toBe("eye-dizzy");
    adv(3000); expect(m.q(".mascot")!.dataset.mood).toBe("idle"); expect(eyes(m)).toBe("eye-open");
    fireEvent.pointerDown(hitOf(m)); adv(60); expect(eyes(m)).toBe("eye-line");   // the slap works again after the daze
  });
  it("affection: hovering for over 1.9 s brings hearts and softens the eyes; nothing if left early", () => {
    const m = mount(40, "idle"); adv(100);
    fireEvent.pointerEnter(hitOf(m)); adv(1000); fireEvent.pointerLeave(hitOf(m)); adv(2000);
    expect(m.container.querySelectorAll(".g-heart").length).toBe(0);
    fireEvent.pointerEnter(hitOf(m)); adv(2000);
    expect(eyes(m)).toBe("eye-calm");
    adv(600); expect(m.container.querySelectorAll(".g-heart").length).toBeGreaterThan(0);
    adv(3500); expect(m.container.querySelectorAll(".g-heart").length).toBe(0); expect(eyes(m)).toBe("eye-open");
  });
  it("affection: not in moods like approval; not a second time within 8 s", () => {
    const a = mount(40, "approval"); adv(100);
    fireEvent.pointerEnter(hitOf(a)); adv(2500);
    expect(a.container.querySelectorAll(".g-heart").length).toBe(0); a.unmount();
    const m = mount(40, "idle"); adv(100);
    fireEvent.pointerEnter(hitOf(m)); adv(2000); adv(4000); fireEvent.pointerLeave(hitOf(m));
    fireEvent.pointerEnter(hitOf(m)); adv(2500);
    expect(eyes(m)).toBe("eye-open");
  });
});

describe("new moods: searching, question, quota, dizzy", () => {
  const tag = (m: ReturnType<typeof mount>) => m.q(".g-badge");
  it("searching: the eyes scan (scan mark), open eyes, blue light", () => {
    const m = mount(56, "searching"); adv(300);
    expect(m.q(".g")!.dataset.scan).toBe("1"); expect(m.q(".g-eye")!.dataset.d).toBe("eye-open");
    m.set("idle"); expect(m.q(".g")!.dataset.scan).toBe("");
  });
  it("question: '?' badge at 40 px and up, none at 24; the head tilts", () => {
    for (const s of [40, 56]) { const m = mount(s, "question"); adv(300); expect(tag(m)!.textContent).toBe("?"); expect(tag(m)!.dataset.s).toBe("in"); expect(m.q(".g-eye")!.dataset.d).toBe("eye-up"); m.unmount(); }
    const a = mount(24, "question"); adv(300); expect(tag(a)).toBeNull();
  });
  it("quota: orange dot badge, tired eyes, sweat drops on; they turn off on switching to another mood", () => {
    const m = mount(56, "ratelimit"); adv(300);
    expect(tag(m)!.dataset.k).toBe("dot"); expect(tag(m)!.textContent).toBe(""); expect(m.q(".g-eye")!.dataset.d).toBe("eye-sad");
    expect(m.q(".g-sweat")!.classList.contains("shown")).toBe(true);
    m.set("idle"); expect(m.q(".g-sweat")!.classList.contains("shown")).toBe(false); expect(tag(m)!.dataset.s).toBe("out");
  });
  it("dizzy: spiral eyes, tongue, star ring; rolls on entry (the daze track goes to 360)", () => {
    const m = mount(56, "idle"); adv(300); m.set("dizzy"); adv(450);
    expect(m.q(".g-eye")!.dataset.d).toBe("eye-dizzy"); expect(m.q(".g-mouth")!.dataset.d).toBe("mouth-tongue"); expect(m.q("div.fx-ring")!.classList.contains("shown")).toBe(true);
    const deg = Number(/rotate\(([-\d.e]+)deg\)/.exec(m.q(".g-sway")!.style.transform)?.[1]);
    expect(deg).toBeGreaterThan(30);   // mid-turn at 450 ms
  });
});
