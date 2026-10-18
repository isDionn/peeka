import { Spring, SpringGroup, SPRINGS, type SpringParams } from "./spring";

type Box = { left: number; top: number; height: number };
interface Fly { el: HTMLElement; x: Spring; y: Spring; s: Spring }

/**
 * Paylaşılan öğe uçuşu (FLIP): `data-paylas="anahtar"` taşıyan öğeler şeritten karta (ve geri) uçar.
 * Kullanım: `fl.capture()` → DOM'u değiştir → `fl.play()`. Uçuş kart yayıyla (0,44 / 0,78) sürülür;
 * yarıda yeniden çağrılırsa öğe o anki konumdan ve hızıyla yeni hedefe devam eder.
 */
export function createFlight(root: ParentNode = document, preset: SpringParams = SPRINGS.card) {
  const sel = "[data-paylas]";
  const live = new Map<HTMLElement, Fly>();
  let before = new Map<string, Box>();

  const sync = () => group.springs.splice(0, group.springs.length, ...[...live.values()].flatMap((g) => [g.x, g.y, g.s]));
  const group = new SpringGroup([], () => {
    for (const [el, f] of live) {
      if (!el.isConnected || (f.x.settled && f.y.settled && f.s.settled)) {
        el.style.transform = "";
        live.delete(el);
        continue;
      }
      el.style.transform = `translate(${f.x.x}px,${f.y.x}px) scale(${f.s.x})`;
    }
    sync();
  });
  const items = () => [...root.querySelectorAll<HTMLElement>(sel)].filter((e) => !e.closest("[data-eski]"));
  const box = (e: HTMLElement): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, height: r.height };
  };

  return {
    /** DOM değişmeden önce: her paylaşılan öğenin görünen (uçuştaysa dönüşümlü) konumunu al */
    capture() {
      before = new Map(items().map((e) => [e.dataset.paylas!, box(e)]));
    },
    /** DOM değiştikten sonra: aynı anahtarlı öğeleri eski konumdan yeni konuma uçur */
    play() {
      for (const el of items()) {
        const o = before.get(el.dataset.paylas!);
        if (!o) continue;
        const run = live.get(el);
        el.style.transform = "";
        el.style.transformOrigin = "0 0";
        const n = box(el);
        if (!n.height || (Math.abs(o.left - n.left) < 1 && Math.abs(o.top - n.top) < 1 && Math.abs(o.height - n.height) < 1)) {
          if (run) { live.delete(el); }
          continue;
        }
        const f = run ?? { el, x: new Spring(0, preset), y: new Spring(0, preset), s: new Spring(1, preset) };
        f.x.x = o.left - n.left; f.y.x = o.top - n.top; f.s.x = o.height / n.height; // hız korunur
        f.x.retarget(0); f.y.retarget(0); f.s.retarget(1);
        el.style.transform = `translate(${f.x.x}px,${f.y.x}px) scale(${f.s.x})`;
        live.set(el, f);
      }
      sync();
      if (live.size) group.kick();
    },
    advance: (dt: number) => group.advance(dt),
    destroy() { group.stop(); live.forEach((f) => (f.el.style.transform = "")); live.clear(); },
  };
}
