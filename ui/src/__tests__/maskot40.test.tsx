import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ApprovalCard, TabBlocks } from "../components/Plugin";
import { collectHitRects } from "../lib/hitRects";
import { resetMascotRegistry } from "../mascot/useSingleMascot";
import { APPROVAL_HIGH, APPROVAL_LOW, PUSULA } from "../plugin.fixtures";

const proto = HTMLElement.prototype;
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => { cleanup(); resetMascotRegistry(); vi.useRealTimers(); vi.restoreAllMocks(); });
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const answers = () => fakeBridge.log.filter((l) => l.cmd === "approval_answer").map((l) => l.args as { decision: string });
const tab = { plugin: PUSULA, id: "cc", title: "Claude Code", blocks: [{ type: "list" as const, rows: [{ title: "proje", state: "running", session: "s-1" }, { title: "Eski", session: "yok" }, { title: "Düz" }] }] };

describe("şerit maskotu 40 px", () => {
  it("40 px asılı poz, tıklama soru kutusunu açar; üstüne gelince sayılar balonda", async () => {
    fakeBridge.setSurfaces({ composer: { ...PUSULA, voice: true } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const m = document.querySelector<HTMLElement>(".adaMerkez .mascot")!;
    expect(m.dataset.size).toBe("40");
    const hit = m.querySelector<HTMLElement>(".mascot-hit")!;
    fireEvent.pointerOver(hit);
    await settle();
    expect(document.querySelector(".mkBalon")!.textContent).toBe("2 iş çalışıyor · 1 onay bekliyor");
    fireEvent.pointerLeave(document.querySelector(".adaMerkez")!);
    expect(document.querySelector(".mkBalon")).toBeNull();
    fireEvent.pointerDown(hit);
    fireEvent.click(hit);
    await settle(200);
    expect(document.querySelector("[data-composer]")).not.toBeNull(); // Modüller değil, soru kutusu
  });
  it("maskotun tıklanabilir dikdörtgeni raporlanan kutulara girer", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    const hit = document.querySelector<HTMLElement>(".mascot-hit")!;
    vi.spyOn(hit, "getBoundingClientRect").mockReturnValue({ left: 10, top: 5, width: 30, height: 37, right: 40, bottom: 42, x: 10, y: 5, toJSON: () => ({}) });
    expect(collectHitRects()).toContainEqual({ x: 10, y: 5, w: 30, h: 37 });
  });
  it("demo: Demo rozeti; unsupported dönen komut 'Demo kipinde yok' der", async () => {
    await fakeBridge.call("set_settings", { patch: { demo: true } });
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    expect(screen.getByText("Demo")).toBeTruthy();
    const { bridge } = await import("../bridge");
    await bridge.call("cc_focus_terminal", { sessionId: "s-1" }).catch(() => undefined);
    await settle(20);
    expect(screen.getByText("Demo kipinde yok")).toBeTruthy();
  });
});

describe("Terminali aç", () => {
  it("yalnız oturum alanı olan satırda düğme; hata Türkçe yazılır", async () => {
    render(<TabBlocks tab={tab} />);
    expect(screen.getAllByRole("button", { name: "Terminali aç" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Terminali aç" })[0]);
    await settle(20);
    expect(fakeBridge.log.at(-1)).toMatchObject({ cmd: "cc_focus_terminal", args: { sessionId: "s-1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Terminali aç" })[1]);
    await settle(20);
    expect(screen.getByText("Bu oturum artık yok")).toBeTruthy();
  });
});

describe("onay kartı N / Y", () => {
  it("600 ms dolmadan N ve Y yok sayılır; sonra N reddeder, Y izin verir", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_LOW} />);
    fireEvent.keyDown(document, { key: "y" });
    advance(300);
    fireEvent.keyDown(document, { key: "n" });
    expect(answers()).toHaveLength(0);
    advance(400);
    fireEvent.keyDown(document, { key: "N" });
    expect(answers()).toEqual([expect.objectContaining({ decision: "deny" })]);
    fireEvent.keyDown(document, { key: "y" });
    expect(answers().at(-1)).toMatchObject({ decision: "allow" });
  });
  it("yüksek riskte Y izin vermez, basılı tutulan düğmeye odaklanır; N reddeder", () => {
    vi.useFakeTimers();
    render(<ApprovalCard a={APPROVAL_HIGH} />);
    advance(700);
    fireEvent.keyDown(document, { key: "y" });
    expect(answers()).toHaveLength(0);
    expect(document.activeElement?.textContent).toContain("İzin ver");
    fireEvent.keyDown(document, { key: "n" });
    expect(answers()).toEqual([expect.objectContaining({ decision: "deny" })]);
  });
});
