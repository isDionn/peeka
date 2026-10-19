// M1c: the rest of the extra parts. Hand variants only ever fill the three-quarter body's one free hand; near-duplicates are wiggle frames.
import { act, createRef } from "react";
// @ts-expect-error node types are not installed; vitest runs on Node (cwd = ui/)
import { readdirSync, readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WIGGLE_STEP_MS, WIGGLE_STEPS } from "../ghost";
import { Mascot, type MascotHandle } from "../Mascot";
import { MOODS, type Fx, type Mood } from "../moods";
import { REACT_MS } from "../react";
import { resetMascotRegistry } from "../useSingleMascot";

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] }));
afterEach(() => { vi.useRealTimers(); resetMascotRegistry(); });

const mount = (size: number, mood: Mood, still = false) => {
  const ref = createRef<MascotHandle>();
  const r = render(<Mascot ref={ref} size={size} mood={mood} isMainAssistant single={false} still={still} />);
  return { ...r, ref };
};
const hand = (c: HTMLElement) => [...c.querySelectorAll(".g-fx.shown")].map((e) => e.getAttribute("src")!.split("/").pop()!).find((s) => s.startsWith("hand-"));

const FREE_HAND: Fx[] = ["point", "qsign", "cover", "fist", "reach", "hi"];

it("every free-hand pose is on the three-quarter body, one hand at most", () => {
  for (const [mood, m] of Object.entries(MOODS)) {
    const hands = m.fx.filter((f) => FREE_HAND.includes(f));
    expect(hands.length, mood).toBeLessThanOrEqual(1);
    if (hands.length) expect(m.body, mood).toBe("three-quarter");
  }
  expect(MOODS.serious.fx).toContain("fist");
  expect(MOODS.message.fx).toContain("reach");
  expect(MOODS.hello.fx).toEqual(["hi"]);   // the old raised hand-wave on hello was a third hand
});

it("a hand wiggles through its frames once, ends on frame 0 within REACT_MS, and the draw loop stops", async () => {
  expect(WIGGLE_STEP_MS * WIGGLE_STEPS).toBeLessThanOrEqual(REACT_MS);
  const m = mount(56, "hello");
  const seen = new Set<string>();
  for (let t = 0; t < REACT_MS + 200; t += 30) { await act(async () => { await vi.advanceTimersByTimeAsync(30); }); seen.add(hand(m.container)!); }
  expect([...seen].sort()).toEqual(["hand-paw-2.webp", "hand-paw-3.webp", "hand-paw.webp"]);
  expect(hand(m.container)).toBe("hand-paw.webp");
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(hand(m.container)).toBe("hand-paw.webp");
  expect(m.ref.current!.running()).toBe(false);
});

it("a mood change stops the old wiggle; a still ghost never wiggles", async () => {
  const m = mount(56, "searching");
  await act(async () => { await vi.advanceTimersByTimeAsync(WIGGLE_STEP_MS + 20); });
  expect(hand(m.container)).toBe("hand-point-2.webp");
  m.rerender(<Mascot ref={m.ref} size={56} mood="idle" isMainAssistant single={false} />);
  m.rerender(<Mascot ref={m.ref} size={56} mood="searching" isMainAssistant single={false} />);
  expect(hand(m.container)).toBe("hand-point.webp");   // back to frame 0 on re-entry
  const s = mount(96, "question", true);
  await act(async () => { await vi.advanceTimersByTimeAsync(REACT_MS); });
  expect(hand(s.container)).toBe("hand-question-sign.webp");
});

it("index.json's unused block lists exactly the parts the code never names", () => {
  const src = ["src/mascot/ghost.ts", "src/mascot/moods.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
  const used = (n: string) => src.includes(`"${n}"`) || src.includes(`${n}.webp`) || (n.startsWith("body-") && src.includes(`"${n.slice(5)}"`));
  const parts = (readdirSync("public/mascot/parts") as string[]).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5));
  const { unused } = JSON.parse(readFileSync("public/mascot/parts/index.json", "utf8"));
  expect(parts.filter((n) => !used(n)).sort()).toEqual(Object.keys(unused).filter((k) => k !== "note").sort());
});
