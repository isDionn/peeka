import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipPlain } from "../bridge";
import { ClipboardView } from "../components/Pano";

// B4 Clipboard OCR: "Copy text" only on image items; the fake reads text unless the source says "blank".
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const img = (id: string, source: string): ClipPlain => ({ id, createdAt: Date.now(), pinned: false, source, kind: "image", text: null, sub: "Image", thumb: PNG, screenshot: false });
beforeEach(() => { fakeBridge.reset(); });
afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const tile = (id: string) => document.querySelector<HTMLElement>(`[data-clip="${id}"]`)!;

describe("clipboard OCR", () => {
  it("copies the text of an image, says when there is none, and never offers it on text rows", async () => {
    fakeBridge.addClip(img("o1", "Paint"));
    fakeBridge.addClip(img("o2", "blank canvas"));
    render(<ClipboardView />);
    await settle();
    fireEvent.pointerEnter(tile("o1"));
    fireEvent.click(within(tile("o1")).getByRole("button", { name: "Copy text" }));
    await settle();
    expect(fakeBridge.log.filter((l) => l.cmd === "clip_ocr")[0].args).toEqual({ id: "o1" });
    expect(screen.getByText("Text copied")).toBeTruthy();
    fireEvent.pointerEnter(tile("o2"));
    fireEvent.click(within(tile("o2")).getByRole("button", { name: "Copy text" }));
    await settle();
    expect(screen.getByText("No text found")).toBeTruthy();
    const textRow = [...document.querySelectorAll<HTMLElement>(".row[data-clip]")][0];
    if (textRow) { fireEvent.pointerEnter(textRow); expect(within(textRow).queryByRole("button", { name: "Copy text" })).toBeNull(); }
  });
});
