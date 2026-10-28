// Last measurement (2026-10-17) island and card findings: R1-2, R1-3, R1-4 (no shifting), card width classes.
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

describe("R1-2: the Why? text opens below the buttons", () => {
  it("the detail box comes after the button row", () => {
    render(<ErrorCard title="Error" detail="technical detail" onRetry={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    const note = screen.getByRole("note"), btns = screen.getByRole("button", { name: "Why?" }).parentElement!;
    expect(btns.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("R1-3: Write another answer does not move the buttons", () => {
  it("the text box opens after the button row; the button stays in place (disabled)", () => {
    render(<ApprovalCard a={APPROVAL_CHOICE} />);
    const btn = screen.getByRole("button", { name: "Write another answer" });
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(btn);
    const box = screen.getByRole("textbox"), row = btn.parentElement!;
    expect(screen.getByRole("button", { name: "Write another answer" })).toBe(btn);
    expect(row.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Deny/ })).toBeTruthy();
  });
});

describe("R1-4: an answered approval row stays as a placeholder", () => {
  it("after Allow the row shows 'Approved' for ~1.5 s, then withdraws", async () => {
    const surf = (approvals: SurfacesView["approvals"]) => ({ tabs: [], summary: [], approvals, protrusion: null, composer: null, approvalTop: null, dropStripMs: null }) as unknown as SurfacesView;
    const { rerender } = render(<SummaryBoxes surf={surf([APPROVAL_LOW])} onDetail={() => undefined} />);
    await tick(700); // button guard
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    rerender(<SummaryBoxes surf={surf([])} onDetail={() => undefined} />); // Core removed the approval
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    await tick(1400);
    expect(screen.getByText("Approved")).toBeTruthy();
    await tick(400);
    expect(screen.queryByText("Approved")).toBeNull();
  });
});

describe("generic mode: plugin summary shows no content", () => {
  it("locked / presenting / shared: rows say 'Activity', no titles, subs, values or approval titles", () => {
    const summary = [{ plugin: APPROVAL_LOW.plugin, rows: [{ title: "Moving invoices", sub: "step 3/5", value: "2 agents" }] }];
    const surf = { tabs: [], summary, approvals: [APPROVAL_LOW], protrusion: null, composer: null, approvalTop: null, dropStripMs: null } as unknown as SurfacesView;
    render(<SummaryBoxes surf={surf} onDetail={() => undefined} generic />);
    expect(screen.getByText("Activity")).toBeTruthy();
    for (const t of ["Moving invoices", "step 3/5", "2 agents", APPROVAL_LOW.title]) expect(screen.queryByText(t)).toBeNull();
  });
});
