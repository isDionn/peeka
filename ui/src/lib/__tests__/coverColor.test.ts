import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverColors } from "../coverColor";

// jsdom görüntü çözmez ve tuval yok: Image ve getContext sahte, 32x32 piksel dizisini testin kendisi verir.
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

describe("coverColors (kapak rengi)", () => {
  it("kapak yok, görüntü okunmaz ya da tuval yoksa null: kart nötr kalır", async () => {
    expect(await coverColors(null)).toBeNull();
    fail = true; expect(await coverColors("data:image/png;base64,AA")).toBeNull();
    fail = false; noCtx = true; expect(await coverColors("data:image/png;base64,AA")).toBeNull();
  });

  it("tek renk kapak: ana renk doygun ve aydınlığı 0,52-0,68'e sıkıştırılır, ikinci renk 40° kayar", async () => {
    paint([255, 0, 0]);
    expect(await coverColors("x")).toEqual(["hsl(0 100% 52%)", "hsl(40 100% 52%)"]);
  });

  it("iki renkli kapak: baskın renk birinci, ondan 35°'den uzak ikinci gerçek renk ikinci olur", async () => {
    paint([255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 0, 255]);
    expect(await coverColors("x")).toEqual(["hsl(0 100% 52%)", "hsl(240 100% 52%)"]);
  });

  it("neredeyse siyah ve beyaz pikseller yok sayılır: renk kalmazsa nötr gri-kırmızı varsayılan", async () => {
    paint([5, 5, 5], [250, 250, 250]);
    expect(await coverColors("x")).toEqual(["hsl(0 60% 52%)", "hsl(40 60% 52%)"]);
  });

  it("çok açık renk 0,68'e, çok koyu renk 0,52'ye çekilir", async () => {
    paint([255, 160, 160]); // l ~0,81
    expect((await coverColors("x"))![0]).toMatch(/ 68%\)$/);
    paint([60, 0, 0]); // l ~0,12
    expect((await coverColors("x"))![0]).toMatch(/ 52%\)$/);
  });
});
