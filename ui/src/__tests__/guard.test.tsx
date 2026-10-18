import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ApprovalBump } from "../components/Plugin";
import { APPROVAL_LOW } from "../plugin.fixtures";

// R2-Y2: durağan imlecin altında beliren onay düğmesi, imleç çıkıp geri girene (ve yerleşim 600 ms durulana) dek tıklamayı yutar
let box = { left: 100, top: 0, width: 62, height: 26 };
const rect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) });
const answers = () => fakeBridge.log.filter((l) => l.cmd === "approval_answer");
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const move = (x: number, y = 10) => fireEvent(document, new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
const mouseClick = (el: Element) => fireEvent.click(el, { detail: 1 });
const allow = () => screen.getByRole("button", { name: "İzin ver" });

beforeEach(() => {
  box = { left: 100, top: 0, width: 62, height: 26 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect() as DOMRect);
  fakeBridge.reset();
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("onay düğmesi koruması", () => {
  it("imleç düğmenin altındayken beliren 'İzin ver': 450 ms ve 5 sn sonra bile fare tıklaması geçmez; çıkıp geri girince geçer", () => {
    move(130); // imleç duruyor, düğme tam altına gelecek
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(450);
    mouseClick(allow());
    advance(5000);
    mouseClick(allow());
    expect(answers()).toHaveLength(0);
    move(600); // düğmeden çıktı
    move(130); // geri girdi
    mouseClick(allow());
    expect(answers()).toEqual([expect.objectContaining({ args: expect.objectContaining({ decision: "allow", surface: "protrusion" }) })]);
  });
  it("imleç başka yerdeyse yalnız 600 ms beklenir", () => {
    move(600);
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(450);
    mouseClick(allow());
    expect(answers()).toHaveLength(0);
    advance(160);
    mouseClick(allow());
    expect(answers()).toHaveLength(1);
  });
  it("düğme yer değiştirirse sayaç yeniden başlar; durağan imlecin altına kayarsa yine bekler", () => {
    move(600);
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(1000);
    box = { ...box, left: 580 }; // kart yayı düğmeyi imlecin altına taşıdı (imleç 600de)
    advance(40);
    mouseClick(allow());
    expect(answers()).toHaveLength(0); // yerleşim yeni değişti
    advance(2000);
    mouseClick(allow());
    expect(answers()).toHaveLength(0); // imleç altında kaldı
    move(5); move(600);
    mouseClick(allow());
    expect(answers()).toHaveLength(1);
  });
  it("klavye (Enter) imleç kuralına takılmaz, yalnız 600 ms'ye", () => {
    move(130);
    render(<ApprovalBump a={APPROVAL_LOW} onDetail={() => undefined} />);
    advance(400);
    fireEvent.click(allow()); // detail 0: klavye
    expect(answers()).toHaveLength(0);
    advance(300);
    fireEvent.click(allow());
    expect(answers()).toHaveLength(1);
  });
  it("yüksek riskte çıkıntıda yalnız Ayrıntı vardır", () => {
    render(<ApprovalBump a={{ ...APPROVAL_LOW, risk: "high" }} onDetail={() => undefined} />);
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ayrıntı" })).toBeTruthy();
  });
});
