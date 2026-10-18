import { describe, expect, it } from "vitest";
import { awayLabel, createAway } from "../away";

describe("createAway", () => {
  it("başlangıçta var olanlar sayılmaz; yokluk boyunca yeni gelenler biter bitmez özet olur", () => {
    const a = createAway();
    expect(a.sync(true, ["n1"], [])).toBeNull();
    expect(a.sync(true, ["n1", "n2", "n3"], ["o1"])).toBeNull();
    a.done(); a.done();
    expect(a.sync(true, ["n1", "n2", "n3"], ["o1"])).toBeNull(); // aynı kimlik iki kez sayılmaz
    expect(a.sync(false, ["n1", "n2", "n3"], ["o1"])).toEqual({ notif: 2, approval: 1, done: 2 });
    expect(a.sync(false, [], [])).toBeNull(); // bir kez döner
  });
  it("hiçbir şey gelmediyse özet yok; yokluk dışında biten iş sayılmaz", () => {
    const a = createAway();
    a.done();
    a.sync(true, [], []);
    expect(a.sync(false, [], [])).toBeNull();
    a.done();
    a.sync(true, [], []);
    expect(a.sync(false, [], [])).toBeNull();
  });
});

describe("awayLabel", () => {
  it("sıfırlar yazılmaz; genel etiket sayı vermez", () => {
    expect(awayLabel({ notif: 3, approval: 1, done: 2 })).toBe("Sen yokken: 3 bildirim, 1 onay, 2 iş bitti");
    expect(awayLabel({ notif: 0, approval: 0, done: 1 })).toBe("Sen yokken: 1 iş bitti");
    expect(awayLabel({ notif: 3, approval: 1, done: 2 }, true)).not.toMatch(/\d/);
  });
});
