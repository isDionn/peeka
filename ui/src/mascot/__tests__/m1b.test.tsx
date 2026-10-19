// M1b: reactions from the previously unused parts (CPU hot, shy at presentation start, hands, tuft flick, sly face, ground light, sparkle-2).
import { act, createRef } from "react";
// @ts-expect-error node types are not installed; vitest runs on Node (cwd = ui/)
import { existsSync } from "node:fs";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdlePrank, FIDGET_GAP, type PrankEnv } from "../idlePrank";
import { Mascot, type MascotHandle } from "../Mascot";
import { MOODS, type Mood } from "../moods";
import { eventMood, REACT_MS, withReaction } from "../react";
import { resetMascotRegistry } from "../useSingleMascot";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] }));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetMascotRegistry(); });

const mount = (size: number, mood: Mood = "idle") => {
  const ref = createRef<MascotHandle>();
  const r = render(<Mascot ref={ref} size={size} mood={mood} isMainAssistant single={false} />);
  const src = (s: string) => (r.container.querySelector(s) as HTMLImageElement | null)?.getAttribute("src") ?? "";
  return { ...r, ref, src };
};
const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const shown = (c: HTMLElement) => [...c.querySelectorAll(".g-fx.shown")].map((e) => e.getAttribute("src")?.split("/").pop());

describe("M1b mood selection", () => {
  it("CPU busy overheats the strip ghost; neutral while locked or presenting", () => {
    expect(eventMood("cpu", false)).toBe("hot");
    expect(eventMood("cpu", true)).toBe("idle");
    expect(MOODS.hot.fx).toEqual(expect.arrayContaining(["redLeft", "redRight", "sweat"]));
  });
  it("shy is the only reaction allowed while private, and only over a calm base", () => {
    expect(withReaction("idle", "shy", true)).toBe("shy");
    expect(withReaction("idle", "hello", true)).toBe("idle");
    expect(withReaction("approval", "shy", true)).toBe("approval");
  });
  it("fidgets share the prank blockers and come every 3-6 min", () => {
    let now = 0, presenting = false;
    const env: PrankEnv = { now: () => now, random: () => 0, enabled: () => true, lastInputAgoMs: () => 60_000, fullscreen: () => false, dnd: () => false, presentation: () => presenting, meeting: () => false, cardOpen: () => false, musicPlaying: () => false };
    const fired = vi.fn();
    const f = createIdlePrank(env, fired, FIDGET_GAP);
    expect(f.poll()).toBe("wait");
    now = FIDGET_GAP.min; presenting = true;
    expect(f.poll()).toBe("presentation");
    presenting = false;
    expect(f.poll()).toBe("fired");
    for (let i = 0; i < 10; i++) { now += FIDGET_GAP.min; expect(f.poll()).toBe("fired"); }   // no daily cap
    expect(fired).toHaveBeenCalledTimes(11);
  });
});

describe("M1b parts on the ghost", () => {
  it("hands: searching points and question holds the sign on cards only; shy covers the eyes from 28 px", () => {
    expect(shown(mount(56, "searching").container)).toContain("hand-point.webp");
    expect(shown(mount(40, "searching").container)).not.toContain("hand-point.webp");
    expect(shown(mount(96, "question").container)).toContain("hand-question-sign.webp");
    expect(shown(mount(40, "shy").container)).toContain("hand-flat.webp");
  });
  it("the 96 px ghost stands on the ground-light art; smaller ghosts keep the drawn disc", () => {
    expect(existsSync("public/mascot/parts/fx-ground-light.webp")).toBe(true);
    expect((mount(96).container.querySelector(".g-ground") as HTMLElement).style.background).toContain("fx-ground-light.webp");
    expect((mount(56).container.querySelector(".g-ground") as HTMLElement).style.background).not.toContain("fx-ground-light");
  });
  it("the done sparkle alternates the two sparkle arts", async () => {
    const m = mount(56, "idle");
    m.rerender(<Mascot ref={m.ref} size={56} mood="done" isMainAssistant single={false} />);
    await run(1200);
    const arts = new Set([...m.container.querySelectorAll(".g-spark")].map((e) => e.getAttribute("src")?.split("/").pop()));
    expect(arts).toEqual(new Set(["fx-sparkle-token.webp", "fx-sparkle-2-token.webp"]));
  });
  it("sly fidget: sly eyes + side tongue, back within REACT_MS, then the loop sleeps", async () => {
    const m = mount(56);
    await run(200);
    act(() => m.ref.current!.fidget("sly"));
    await run(100);
    expect(m.src(".g-eye")).toContain("eye-sly");
    expect(m.src(".g-mouth")).toContain("mouth-tongue-side");
    await run(REACT_MS);
    expect(m.src(".g-eye")).toContain("eye-open");
    expect(m.src(".g-mouth")).toContain("mouth-smile");
    await run(3000);
    expect(m.ref.current!.running()).toBe(false);
  });
  it("tuft fidget: the baked tuft is masked while tuft parts stand in, all undone within REACT_MS", async () => {
    const m = mount(96);
    await run(200);
    act(() => m.ref.current!.fidget("tuft"));
    await run(300);
    const body = () => m.container.querySelector(".g-body:not(.hidden)")!;
    expect(body().classList.contains("cut-top")).toBe(true);
    expect(m.container.querySelectorAll(".g-extra.shown").length).toBe(1);
    await run(REACT_MS);
    expect(m.container.querySelector(".cut-top")).toBeNull();
    expect(m.container.querySelectorAll(".g-extra.shown").length).toBe(0);
    await run(3000);
    expect(m.ref.current!.running()).toBe(false);
  });
  it("no fidget unless idle, and never at the 24 px silhouette", async () => {
    const busy = mount(56, "thinking");
    act(() => busy.ref.current!.fidget("sly"));
    await run(100);
    expect(busy.src(".g-eye")).not.toContain("eye-sly");
    const sil = mount(24);
    act(() => sil.ref.current!.fidget("tuft"));
    expect(sil.container.querySelector(".g-extra")).toBeNull();
  });
  it("the idle prank's stretch shows the sly face", async () => {
    const m = mount(56);
    await run(200);
    act(() => m.ref.current!.prank());
    await run(1500);
    expect(m.src(".g-eye")).toContain("eye-sly");
    await run(1000);
    expect(m.src(".g-eye")).toContain("eye-open");
  });
});
