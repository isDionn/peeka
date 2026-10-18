import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { claimMascot, mascotOwner, resetMascotRegistry, useSingleMascot } from "../useSingleMascot";

afterEach(resetMascotRegistry);

describe("single-mascot registry", () => {
  it("higher priority wins, the first to arrive on a tie", () => {
    claimMascot("strip", 20);
    expect(mascotOwner()).toBe("strip");
    const off = claimMascot("card", 28);
    expect(mascotOwner()).toBe("card");
    claimMascot("other-strip", 20);
    off();
    expect(mascotOwner()).toBe("strip");
  });
  it("no owner once all have left", () => {
    const off = claimMascot("a", 20); off();
    expect(mascotOwner()).toBeNull();
  });
  it("hook: only one is visible at a time, the strip hides when the card appears", () => {
    const seen: Record<string, boolean> = {};
    const Probe = ({ id, p }: { id: string; p: number }) => { seen[id] = useSingleMascot(p); return null; };
    const { rerender } = render(<Probe id="strip" p={20} />);
    expect(seen.strip).toBe(true);
    rerender(<><Probe id="strip" p={20} /><Probe id="card" p={28} /></>);
    expect(seen).toMatchObject({ strip: false, card: true });
    rerender(<Probe id="strip" p={20} />);
    expect(seen.strip).toBe(true);
  });
  it("want=false doesn't register", () => {
    const seen: Record<string, boolean> = {};
    const Probe = () => { seen.x = useSingleMascot(20, false); return null; };
    render(<Probe />);
    expect(seen.x).toBe(false);
    expect(mascotOwner()).toBeNull();
  });
});
