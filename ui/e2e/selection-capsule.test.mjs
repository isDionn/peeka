// Flowing highlight: the selection capsule sits on the active item's box and springs to the new one when the active item changes (Strip.tsx SelectionPill).
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { open, start, stable, until } from "./lib.mjs";

let env;
// Vite compiles the first page cold on this server (dependency pre-bundling can exceed 15 s): the warm-up page doesn't count toward the test time
before(async () => { env = await start(); const w = await open(env, "/index.html"); await w.waitForTimeout(800); await w.close2(); }, { timeout: 90000 });
after(async () => { await env?.stop(); });

const read = (page) => page.evaluate(() => {
  const pill = document.querySelector(".tabPill"), a = document.querySelector(".pin.active, .tabA.active");
  if (!pill || !a) return null;
  const p = pill.getBoundingClientRect(), r = a.getBoundingClientRect();
  return { key: a.getAttribute("aria-label"), op: getComputedStyle(pill).opacity, dx: Math.round(p.left - r.left), dw: Math.round(p.width - r.width) };
});

it("the capsule sits on the active item's box and slides to another item when it is clicked", { timeout: 120000 }, async () => {
  const page = await open(env, "/index.html");
  try {
    await until(() => read(page), "no active item or capsule", 8000);
    const first = await stable(() => read(page));
    assert.deepEqual([first.op, first.dx, first.dw], ["1", 0, 0], "the capsule did not sit on the active item");
    const other = page.locator('.pin:not(.active)').first();
    await other.click();
    await until(async () => (await read(page))?.key !== first.key, "the active item did not change");
    const next = await stable(() => read(page));
    assert.deepEqual([next.dx, next.dw], [0, 0], "the capsule did not slide to the new active item");
    assert.deepEqual(page.errors, []);
  } finally { await page.close2(); }
});
