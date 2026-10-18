import { describe, expect, it } from "vitest";
import { fmtTime, timeSlot, trackTitle } from "../media";
import { initial, plain } from "../plugin";
import { parseTimer } from "../search";

// 100 senaryo turu (docs/tasks/ada-yeni/notch-100-kullanim-senaryosu.md): sınır değerler.
describe("süre yazısı", () => {
  it("bir saati aşınca saat:dk:sn yazar", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(3599)).toBe("59:59");
    expect(fmtTime(3600)).toBe("1:00:00");
    expect(fmtTime(3805)).toBe("1:03:25");
    expect(fmtTime(-5)).toBe("0:00");
  });
  it("yuva genişliği parçanın en uzun yazısı kadar, süre yoksa 4", () => {
    expect(timeSlot(null)).toBe(4);
    expect(timeSlot(200)).toBe(4);
    expect(timeSlot(700)).toBe(5);
    expect(timeSlot(7200)).toBe(7);
  });
});

describe("boş parça adı", () => {
  it("ad boşsa Bilinmeyen parça yazılır", () => {
    expect(trackTitle({ title: "" })).toBe("Bilinmeyen parça");
    expect(trackTitle({ title: "   " })).toBe("Bilinmeyen parça");
    expect(trackTitle({ title: "Gece Treni" })).toBe("Gece Treni");
  });
});

describe("emoji ve Türkçe harf", () => {
  it("plain kesimde emojiyi yarım bırakmaz", () => {
    expect(plain("ab😀cd", 3)).toBe("ab");
    expect(plain("ab😀cd", 4)).toBe("ab😀");
    expect(plain(null, 5)).toBe("");
  });
  it("baş harf emoji bölmez, Türkçe i büyük İ olur", () => {
    expect(initial("😀 Teams")).toBe("😀");
    expect(initial("ışık")).toBe("I");
    expect(initial("iş")).toBe("İ");
    expect(initial("")).toBe("");
  });
  it("zamanlayıcı adı 24 karakteri emoji bölmeden keser", () => {
    const t = parseTimer("5 dk " + "😀".repeat(40));
    expect(Array.from(t!.label)).toHaveLength(24);
  });
});
