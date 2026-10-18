import { describe, expect, it } from "vitest";
import { pickPrimary, RANK, timerKind, type ActivityKind } from "../priority";

const A = (...k: ActivityKind[]) => k.map((kind) => ({ kind }));
const kinds = (l: { kind: ActivityKind }[]) => l.map((a) => a.kind);
/** Karar sırası, yukarıdan aşağı. */
const ORDER: ActivityKind[] = ["approval", "clip", "batteryCrit", "live", "meeting", "net", "alert", "burst", "rateLimit", "battery", "cpu", "timerEnd", "done", "summary", "musicStopped", "download", "music", "timer", "other"];

describe("pickPrimary: sıra", () => {
  it("boş liste: ana yok, yan yok", () => {
    expect(pickPrimary([])).toEqual({ primary: null, secondary: [] });
  });
  it("tek iş ana olur, baloncuk yok", () => {
    const p = pickPrimary(A("music"));
    expect(p.primary?.kind).toBe("music");
    expect(p.secondary).toEqual([]);
  });
  it("RANK sahip sırasıyla birebir aynı", () => {
    expect(Object.keys(RANK).sort((a, b) => RANK[a as ActivityKind] - RANK[b as ActivityKind])).toEqual(ORDER);
  });
  it("her komşu çift: üsttekini ana, alttakini baloncuk yapar (iki yönde girişten bağımsız)", () => {
    for (let i = 0; i < ORDER.length - 1; i++) {
      const hi = ORDER[i], lo = ORDER[i + 1];
      for (const input of [A(hi, lo), A(lo, hi)]) {
        const p = pickPrimary(input);
        expect(p.primary?.kind, `${hi} > ${lo}`).toBe(hi);
        expect(kinds(p.secondary)).toEqual([lo]);
      }
    }
  });
  it("hepsi bir arada: tam sıra, ilki ana, kalanı sıralı", () => {
    const p = pickPrimary(A(...[...ORDER].reverse()));
    expect(p.primary?.kind).toBe("approval");
    expect(kinds(p.secondary)).toEqual(ORDER.slice(1));
  });
  it("sahibin örnekleri: Claude + müzik; Claude + müzik + zamanlayıcı; onay Claude'u baloncuğa indirir", () => {
    expect(pickPrimary(A("music", "live")).primary?.kind).toBe("live");
    const p = pickPrimary(A("timer", "music", "live"));
    expect([p.primary?.kind, ...kinds(p.secondary)]).toEqual(["live", "music", "timer"]);
    const q = pickPrimary(A("live", "approval"));
    expect([q.primary?.kind, ...kinds(q.secondary)]).toEqual(["approval", "live"]);
  });
  it("düz uyarı Claude'un önüne geçmez, müziğin ve zamanlayıcının önüne geçer", () => {
    expect(pickPrimary(A("alert", "live")).primary?.kind).toBe("live");
    expect(pickPrimary(A("music", "alert")).primary?.kind).toBe("alert");
    expect(pickPrimary(A("timer", "alert")).primary?.kind).toBe("alert");
  });
  it("girdiyi değiştirmez", () => {
    const l = A("other", "approval");
    pickPrimary(l, "other");
    expect(kinds(l)).toEqual(["other", "approval"]);
  });
});

describe("timerKind: son 60 sn", () => {
  it("59, 60, 61 sn", () => {
    expect(timerKind(true, 59)).toBe("timerEnd");
    expect(timerKind(true, 60)).toBe("timerEnd");
    expect(timerKind(true, 61)).toBe("timer");
  });
  it("duraklatılmış zamanlayıcı 60 sn altında bile öne geçmez; süresi dolmuşsa (0) geçer", () => {
    expect(timerKind(false, 30)).toBe("timer");
    expect(timerKind(false, 0)).toBe("timerEnd");
  });
  it("müzikle: 61 sn müziğin altında, 60 sn üstünde", () => {
    expect(pickPrimary(A(timerKind(true, 61), "music")).primary?.kind).toBe("music");
    expect(pickPrimary(A(timerKind(true, 60), "music")).primary?.kind).toBe("timerEnd");
  });
});

describe("pickPrimary: kullanıcı öne alınca (pinned)", () => {
  it("baloncuktaki iş ana olur, eski ana baloncuğa iner", () => {
    const p = pickPrimary(A("live", "music", "timer"), "music");
    expect([p.primary?.kind, ...kinds(p.secondary)]).toEqual(["music", "live", "timer"]);
  });
  it("öne alınan tür yoksa ya da zaten ana ise sıra değişmez", () => {
    expect(kinds(pickPrimary(A("live", "music"), "timer").secondary)).toEqual(["music"]);
    expect(pickPrimary(A("live", "music"), "live").primary?.kind).toBe("live");
  });
  it("onay varken öne alma yok sayılır: onay hep ana", () => {
    const p = pickPrimary(A("approval", "live", "music"), "music");
    expect([p.primary?.kind, ...kinds(p.secondary)]).toEqual(["approval", "live", "music"]);
  });
});
