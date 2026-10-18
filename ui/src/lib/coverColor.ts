// Kapaktan 32x32 örnekleyip iki renk çıkarır (maketteki renkCikar). Yalnız kartın içinde kullanılır (§0i madde 1).
const hsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
const css = ([h, s, l]: [number, number, number]) => `hsl(${Math.round(h)} ${Math.round(Math.max(s, 0.6) * 100)}% ${Math.round(Math.min(0.68, Math.max(0.52, l)) * 100)}%)`;

/** Okunamazsa (kapak yok, tuval yok) null: kart nötr kalır. */
export function coverColors(src: string | null): Promise<[string, string] | null> {
  if (!src || typeof document === "undefined") return Promise.resolve(null);
  return new Promise((res) => {
    const im = new Image();
    im.onerror = () => res(null);
    im.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 32;
        const x = c.getContext("2d", { willReadFrequently: true });
        if (!x) return res(null);
        x.drawImage(im, 0, 0, 32, 32);
        const d = x.getImageData(0, 0, 32, 32).data, kova = new Map<number, { w: number; r: number; g: number; b: number }>();
        for (let i = 0; i < d.length; i += 4) {
          const [, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
          if (l < 0.1 || l > 0.95) continue;
          const k = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5), w = 0.1 + s * s * (1 - Math.abs(l - 0.55));
          const o = kova.get(k) ?? { w: 0, r: 0, g: 0, b: 0 };
          o.w += w; o.r += d[i] * w; o.g += d[i + 1] * w; o.b += d[i + 2] * w; kova.set(k, o);
        }
        const list = [...kova.values()].sort((a, b) => b.w - a.w).map((o) => hsl(o.r / o.w, o.g / o.w, o.b / o.w));
        const a = list[0] ?? ([0, 0, 0.5] as [number, number, number]);
        const b = list.find((c2) => Math.min(Math.abs(c2[0] - a[0]), 360 - Math.abs(c2[0] - a[0])) > 35) ?? ([(a[0] + 40) % 360, a[1], a[2]] as [number, number, number]);
        res([css(a), css(b)]);
      } catch { res(null); }
    };
    im.src = src;
  });
}
