// Akan vurgu: seçim kapsülü etkin öğenin kutusuna oturur ve etkin öğe değişince yayla ona kayar (Strip.tsx SelectionPill).
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
// Vite bu sunucuda ilk sayfayı soğuk derler (bağımlılık önişleme, 15 sn'yi aşabiliyor): ısınma sayfası testin süresine girmez
before(async () => { env = await start(); const w = await open(env, "/index.html"); await w.waitForTimeout(800); await w.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });

const read = (page) => page.evaluate(() => {
  const pil = document.querySelector(".sekmePil"), a = document.querySelector(".sabit.aktif, .sekmeA.aktif");
  if (!pil || !a) return null;
  const p = pil.getBoundingClientRect(), r = a.getBoundingClientRect();
  return { key: a.getAttribute("aria-label"), op: getComputedStyle(pil).opacity, dx: Math.round(p.left - r.left), dw: Math.round(p.width - r.width) };
});

it("kapsül etkin öğenin kutusuna oturur; başka öğeye tıklayınca ona kayar", { timeout: 120000 }, async () => {
  const page = await open(env, "/index.html");
  try {
    await until(() => read(page), "etkin öğe ya da kapsül yok", 8000);
    const first = await stable(() => read(page));
    assert.deepEqual([first.op, first.dx, first.dw], ["1", 0, 0], "kapsül etkin öğenin üstüne oturmadı");
    const other = page.locator('.sabit:not(.aktif)').first();
    await other.click();
    await until(async () => (await read(page))?.key !== first.key, "etkin öğe değişmedi");
    const next = await stable(() => read(page));
    assert.deepEqual([next.dx, next.dw], [0, 0], "kapsül yeni etkin öğeye kaymadı");
    assert.deepEqual(page.errors, []);
  } finally { await page.close2(); }
});
