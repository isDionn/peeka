import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverColors } from "../coverColor";

// jsdom doesn't decode images and has no canvas: Image and getContext are fakes, and the test supplies the 32x32 pixel array itself.
let pixels: number[][] = [];
let fail = false;
let noCtx = false;
class FakeImage {
  onload: () => void = () => {}; onerror: () => void = () => {};
  set src(_: string) { queueMicrotask(() => (fail ? this.onerror() : this.onload())); }
}
const paint = (...rows: number[][]) => { pixels = rows; };
const data = () => { const d = new Uint8ClampedArray(32 * 32 * 4); for (let i = 0; i < 1024; i++) d.set([...pixels[i % pixels.length], 255], i * 4); return { data: d }; };

beforeEach(() => {
  fail = false; noCtx = false;
  vi.stubGlobal("Image", FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => (noCtx ? null : { drawImage: () => {}, getImageData: data })) as never);
});
afterEach(() => vi.restoreAllMocks());

describe("coverColors (cover color)", () => {
  it("null when there is no cover, the image can't be read or there is no canvas: the card stays neutral", async () => {
    expect(await coverColors(null)).toBeNull();
    fail = true; expect(await coverColors("data:image/png;base64,AA")).toBeNull();
    fail = false; noCtx = true; expect(await coverColors("data:image/png;base64,AA")).toBeNull();
  });

  it("single-color cover: the main color is saturated and its lightness clamped to 0.52-0.68, the second color is shifted 40°", async () => {
    paint([255, 0, 0]);
    expect(await coverColors("x")).toEqual(["hsl(0 100% 52%)", "hsl(40 100% 52%)"]);
  });

  it("two-color cover: the dominant color comes first, a real second color more than 35° away from it comes second", async () => {
    paint([255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 0, 255]);
    expect(await coverColors("x")).toEqual(["hsl(0 100% 52%)", "hsl(240 100% 52%)"]);
  });

  it("near-black and near-white pixels are ignored: with no color left, a neutral gray-red default", async () => {
    paint([5, 5, 5], [250, 250, 250]);
    expect(await coverColors("x")).toEqual(["hsl(0 60% 52%)", "hsl(40 60% 52%)"]);
  });

  it("a very light color is pulled to 0.68, a very dark one to 0.52", async () => {
    paint([255, 160, 160]); // l ~0.81
    expect((await coverColors("x"))![0]).toMatch(/ 68%\)$/);
    paint([60, 0, 0]); // l ~0.12
    expect((await coverColors("x"))![0]).toMatch(/ 52%\)$/);
  });
});
