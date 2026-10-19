import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ cb: null as ((l: [number, number]) => void) | null, calls: [] as string[] }));
vi.mock("../bridge", () => ({
  bridge: {
    on: (_e: string, cb: (l: [number, number]) => void) => { h.cb = cb; return Promise.resolve(() => { h.cb = null; }); },
    call: (cmd: string) => { h.calls.push(cmd); return Promise.resolve(); },
  },
}));

import { Bars, follow, hold } from "../components/Bars";

afterEach(cleanup);

test("follow: fast attack, slow release, no overshoot", () => {
  // one time constant reaches ~63 %
  expect(follow(0, 1, 40, 40, 180)).toBeCloseTo(1 - Math.exp(-1), 5);
  expect(follow(1, 0, 180, 40, 180)).toBeCloseTo(Math.exp(-1), 5);
  // same 40 ms: rising moves much further than falling
  expect(follow(0, 1, 40, 40, 180)).toBeGreaterThan(1 - follow(1, 0, 40, 40, 180) + 0.3);
  let v = 0;
  for (let i = 0; i < 100; i++) v = follow(v, 0.7, 16, 40, 180);
  expect(v).toBeLessThanOrEqual(0.7);
  expect(v).toBeCloseTo(0.7, 3);
});

test("hold: jumps to a new peak, decays slowly, never below the floor", () => {
  expect(hold(0.2, [0.9, 0.4])).toBe(0.9);
  expect(hold(0.9, [0.1, 0.1])).toBeCloseTo(0.8955, 6);
  let v = 0.9;
  for (let i = 0; i < 135; i++) v = hold(v, [0, 0]); // ~4.5 s of silence
  expect(v).toBeCloseTo(0.45, 1);
  for (let i = 0; i < 3000; i++) v = hold(v, [0, 0]);
  expect(v).toBe(0.02);
});

test("Bars: CSS loop without levels, level-driven scaleY with them, back to the loop when they stop", async () => {
  const { container } = render(<Bars />);
  const root = container.querySelector(".seen") as HTMLElement;
  const bars = [...root.querySelectorAll("i")];
  expect(h.calls).toEqual(["audio_level_start"]);
  expect(root.classList.contains("live")).toBe(false);
  expect(bars.every((b) => b.style.transform === "")).toBe(true);

  const feed = setInterval(() => h.cb?.([0.9, 0.5]), 33);
  await vi.waitFor(() => expect(root.classList.contains("live")).toBe(true));
  const scale = (b: HTMLElement) => Number(/^scaleY\(([\d.]+)\)$/.exec(b.style.transform)?.[1] ?? NaN);
  // a loud peak lifts every bar well above the 0.3 rest point
  await vi.waitFor(() => expect(bars.every((b) => scale(b) > 0.5 && scale(b) <= 1)).toBe(true));
  // per-bar variation: not all the same
  expect(new Set(bars.map((b) => b.style.transform)).size).toBeGreaterThan(1);

  clearInterval(feed);
  await vi.waitFor(() => expect(root.classList.contains("live")).toBe(false), { timeout: 1500 });
  expect(bars.every((b) => b.style.transform === "")).toBe(true);

  cleanup();
  expect(h.calls).toEqual(["audio_level_start", "audio_level_stop"]);
});

test("Bars: still (island hidden / fullscreen) never asks for the level; going live starts it, going still stops it", () => {
  h.calls.length = 0;
  const { container, rerender } = render(<Bars still />);
  expect(h.calls).toEqual([]);
  expect(container.querySelector(".seen.still")).not.toBeNull();
  rerender(<Bars />);
  expect(h.calls).toEqual(["audio_level_start"]);
  rerender(<Bars still />);
  expect(h.calls).toEqual(["audio_level_start", "audio_level_stop"]);
  cleanup();
});
