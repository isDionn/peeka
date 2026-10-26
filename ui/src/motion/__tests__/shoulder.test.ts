import { afterEach, describe, expect, it } from "vitest";
import { mountShoulders } from "../shoulder";
import type { ShapeState } from "../shape";

const st = (o: Partial<ShapeState> = {}): ShapeState => ({ w: 200, h: 40, tw: 400, th: 80, offsetX: 100, r: 20, rt: 30, f: 12, go: 0.5, kt: 0.4, hidden: false, bw: 400, bh: 80, moving: true, ...o });
const mount = (sides?: "both" | "left" | "right") => { const c = document.createElement("div"); document.body.append(c); return { c, s: mountShoulders(c, { sides }) }; };
afterEach(() => { document.body.innerHTML = ""; });

describe("mountShoulders (liquid shoulder, shadow, halo)", () => {
  it("both: halo, shadow and two shoulders are set up; left/right only one shoulder", () => {
    expect(mount().c.children).toHaveLength(4);
    const l = mount("left").c, r = mount("right").c;
    expect([...l.children].map((e) => e.className)).toEqual(["nm-halo", "nm-shadow", "nm-shoulder l"]);
    expect([...r.children].map((e) => e.className)).toEqual(["nm-halo", "nm-shadow", "nm-shoulder r"]);
  });

  it("only transform per frame: the shadow is drawn at the target size and shrinks via scale; the shoulder overhangs the body by f", () => {
    const { c, s } = mount();
    s.layer(st());
    const q = (sel: string) => c.querySelector<HTMLElement>(sel)!;
    expect(q(".nm-shadow").style.width).toBe("400px");
    expect(q(".nm-shadow").style.borderRadius).toBe("0 0 30px 30px");
    expect(q(".nm-shadow").style.transform).toBe("translate(100px,0) scale(0.5,0.5)");
    expect(q(".nm-shadow").style.opacity).toBe("0.5");
    expect(parseFloat(q(".nm-halo").style.width)).toBeCloseTo(440); // 400 * 1.1
    expect(q(".nm-shoulder.l").style.transform).toBe("translate(88px,0) scale(1)"); // offsetX - f, f/12
    expect(q(".nm-shoulder.r").style.transform).toBe("translate(299px,0) scale(1)"); // offsetX + w, 1 px (scaled) into the body
    // only the measure (spring) changed: the size isn't rewritten, the scale is updated
    q(".nm-shadow").style.width = "1px";
    s.layer(st({ w: 400 }));
    expect(q(".nm-shadow").style.width).toBe("1px");
    expect(q(".nm-shadow").style.transform).toContain("scale(1,0.5)");
    // resized once when the target changes
    s.layer(st({ w: 400, tw: 500 }));
    expect(q(".nm-shadow").style.width).toBe("500px");
  });

  it("when hidden the shoulders are invisible and the shadow transparent; no division error when the target is 0", () => {
    const { c, s } = mount();
    s.layer(st({ hidden: true, tw: 0, th: 0, w: 0, h: 0 }));
    expect(c.querySelector<HTMLElement>(".nm-shoulder.l")!.style.visibility).toBe("hidden");
    expect(c.querySelector<HTMLElement>(".nm-shadow")!.style.opacity).toBe("0");
    expect(c.querySelector<HTMLElement>(".nm-shadow")!.style.transform).toContain("scale(0,0)");
    s.layer(st());
    expect(c.querySelector<HTMLElement>(".nm-shoulder.r")!.style.visibility).toBe("visible");
  });

  it("setAmbient: the cover color is written to the halo property, null extinguishes the halo; destroy removes everything", () => {
    const { c, s } = mount();
    const halo = c.querySelector<HTMLElement>(".nm-halo")!;
    s.setAmbient("hsl(10 80% 60%)");
    expect(halo.style.getPropertyValue("--nm-amb")).toBe("hsl(10 80% 60%)");
    expect(halo.style.opacity).toBe("0.42");
    s.setAmbient("hsl(10 80% 60%)", 0.7);
    expect(halo.style.opacity).toBe("0.7");
    s.setAmbient(null);
    expect(halo.style.opacity).toBe("0");
    s.destroy();
    expect(c.children).toHaveLength(0);
  });
});
