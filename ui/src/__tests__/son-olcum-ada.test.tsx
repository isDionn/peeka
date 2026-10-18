// Son ölçüm (2026-10-17) ada ve kart bulguları: R1-2, R1-3, R1-4 (kayma yok), kart genişliği sınıfları.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { ErrorCard } from "../components/CardsExtra";
import { ApprovalCard, SummaryBoxes } from "../components/Plugin";
import { APPROVAL_CHOICE, APPROVAL_LOW } from "../plugin.fixtures";
import type { SurfacesView } from "../bridge";

beforeEach(() => { fakeBridge.reset(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("R1-2: Neden? düğmesinin metni düğmelerin altında açılır", () => {
  it("ayrıntı kutusu düğme satırından sonra gelir", () => {
    render(<ErrorCard title="Hata" detail="teknik ayrıntı" onRetry={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Neden?" }));
    const note = screen.getByRole("note"), btns = screen.getByRole("button", { name: "Neden?" }).parentElement!;
    expect(btns.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("R1-3: Başka cevap yaz düğmeleri oynatmaz", () => {
  it("yazı kutusu düğme satırından sonra açılır; düğme yerinde kalır (devre dışı)", () => {
    render(<ApprovalCard a={APPROVAL_CHOICE} />);
    const btn = screen.getByRole("button", { name: "Başka cevap yaz" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(btn);
    const box = screen.getByRole("textbox"), row = btn.parentElement!;
    expect(screen.getByRole("button", { name: "Başka cevap yaz" })).toBe(btn);
    expect(row.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reddet/ })).toBeTruthy();
  });
});

describe("R1-4: cevaplanan onay satırı yer tutucuyla kalır", () => {
  it("İzin ver sonrası satır ~1,5 sn 'Onaylandı' olur, sonra çekilir", async () => {
    const surf = (approvals: SurfacesView["approvals"]) => ({ tabs: [], summary: [], approvals, protrusion: null, composer: null, approvalTop: null, dropStripMs: null }) as unknown as SurfacesView;
    const { rerender } = render(<SummaryBoxes surf={surf([APPROVAL_LOW])} onDetail={() => undefined} />);
    await tick(700); // düğme koruması
    fireEvent.click(screen.getByRole("button", { name: "İzin ver" }));
    rerender(<SummaryBoxes surf={surf([])} onDetail={() => undefined} />); // Core onayı kaldırdı
    expect(screen.getByText("Onaylandı")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "İzin ver" })).toBeNull();
    await tick(1400);
    expect(screen.getByText("Onaylandı")).toBeTruthy();
    await tick(400);
    expect(screen.queryByText("Onaylandı")).toBeNull();
  });
});
