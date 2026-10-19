import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mascot } from "../Mascot";
import { MOODS, pickScale, sizePlan, type Mood } from "../moods";
import { resetMascotRegistry } from "../useSingleMascot";
import { FADE_MS } from "../react";

afterEach(resetMascotRegistry);

describe("size rules", () => {
  it("24 px strip: silhouette, no blush/effects/eye tracking; 28 px and up: blush", () => {
    expect(sizePlan(24)).toMatchObject({ silhouette: true, blush: false, effects: false, eyeTracking: false });
    expect(sizePlan(27).silhouette).toBe(true);
    expect(sizePlan(20)).toMatchObject({ silhouette: true, blush: false, effects: false, eyeTracking: false });
    expect(sizePlan(22).blush).toBe(false);
    for (const s of [28, 56, 96]) expect(sizePlan(s)).toMatchObject({ silhouette: false, blush: true, eyeTracking: true });
    expect(sizePlan(28).sign).toBe(false);
    expect(sizePlan(56).sign).toBe(true);
  });
  it("DPI -> 1x/2x/3x", () => {
    expect([1, 1.25, 1.5, 2, 2.5, 3, 4].map(pickScale)).toEqual([1, 2, 2, 2, 3, 3, 3]);
  });
  it("every mood maps to a silhouette", () => {
    for (const m of Object.keys(MOODS) as Mood[]) expect(["open", "closed", "hands", "three-quarter"]).toContain(MOODS[m].sil);
  });
});

describe("<Mascot />", () => {
  it("24 px strip: sprite24 srcset, no blush, 24x32 box", () => {
    const { container } = render(<Mascot size={24} mood="idle" isMainAssistant still />);
    const im = container.querySelector("img.g-sil") as HTMLImageElement;
    expect(im).toBeTruthy();
    expect(im.srcset).toMatch(/sprite24\/open@1x\.webp 1x.*@2x\.webp 2x.*@3x\.webp 3x/);
    expect(container.querySelector(".g-blush")).toBeNull();
    expect(container.querySelector(".g-fx")).toBeNull();
    const box = container.querySelector(".mascot") as HTMLElement;
    expect([box.style.width, box.style.height]).toEqual(["24px", "32px"]);
  });
  it("56 and 96 px: layered, box ratio 4/3", () => {
    for (const [s, h] of [[56, 75], [96, 128]] as const) {
      const { container, unmount } = render(<Mascot size={s} mood="idle" isMainAssistant still single={false} />);
      expect(container.querySelector("img.g-sil")).toBeNull();
      expect(Math.round(parseFloat((container.querySelector(".mascot") as HTMLElement).style.height))).toBe(h);
      unmount();
    }
  });
  it("mood picks the silhouette: done -> hands, sleeping -> closed", () => {
    const a = render(<Mascot size={20} mood="done" isMainAssistant still single={false} />);
    expect((a.container.querySelector("img.g-sil") as HTMLImageElement).srcset).toContain("hands@1x");
    const b = render(<Mascot size={20} mood="sleeping" isMainAssistant still single={false} />);
    expect((b.container.querySelector("img.g-sil") as HTMLImageElement).srcset).toContain("closed@1x");
  });
  it("28 px: blush, no silhouette", () => {
    const { container } = render(<Mascot size={28} mood="listening" isMainAssistant still />);
    expect(container.querySelector("img.g-blush")).toBeTruthy();
    expect(container.querySelector("img.g-sil")).toBeNull();
  });
  it("if not the main assistant, no mascot is drawn, a neutral icon is", () => {
    for (const size of [20, 28, 56]) {
      const { container, unmount } = render(<Mascot size={size} mood="speaking" isMainAssistant={false} />);
      expect(container.querySelector(".mascot")).toBeNull();
      expect(container.querySelector(".g")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".mascot-neutral svg")).toBeTruthy();
      unmount();
    }
  });
  it("click: onPoke is called", () => {
    const onPoke = vi.fn();
    const { container } = render(<Mascot size={28} mood="idle" isMainAssistant onPoke={onPoke} still />);
    fireEvent.pointerDown(container.querySelector(".mascot")!);
    expect(onPoke).toHaveBeenCalledTimes(1);
  });
  it("single mascot: the strip one fades out when the card appears, then leaves", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<Mascot size={20} mood="idle" isMainAssistant still />);
      expect(container.querySelectorAll(".mascot")).toHaveLength(1);
      rerender(<><Mascot size={20} mood="idle" isMainAssistant still /><Mascot size={28} mood="approval" isMainAssistant still /></>);
      const shown = () => [...container.querySelectorAll<HTMLElement>(".mascot:not(.out)")].map((m) => m.dataset.size);
      expect(shown()).toEqual(["28"]);   // only one ghost is ever "in"; the old one is fading
      act(() => { vi.advanceTimersByTime(FADE_MS); });
      const all = container.querySelectorAll(".mascot");
      expect(all).toHaveLength(1);
      expect((all[0] as HTMLElement).dataset.size).toBe("28");
    } finally { vi.useRealTimers(); }
  });
});
