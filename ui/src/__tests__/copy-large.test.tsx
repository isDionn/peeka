import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipPlain } from "../bridge";
import { ShotBump } from "../components/Pano";

// Copy strip: large preview via `clip_preview`, Open and Add to Shelf (image and file); a refusal while locked is silent.
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const IMG: ClipPlain = { id: "k1", createdAt: 1, pinned: false, source: "Paint", kind: "image", text: null, sub: "Image", thumb: PNG, screenshot: false };
const FILE: ClipPlain = { id: "k2", createdAt: 1, pinned: false, source: "File Explorer", kind: "file", text: "report.xlsx", sub: "1 MB", thumb: null, screenshot: false };
beforeEach(() => { fakeBridge.reset(); });
afterEach(cleanup);
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("copy strip (A)", () => {
  it("the large preview requests clip_preview; Open and Add to Shelf call their commands", async () => {
    fakeBridge.addClip(IMG);
    const spy = vi.spyOn(fakeBridge, "call");
    render(<ShotBump item={IMG} main={null} big />);
    await settle();
    expect(spy).toHaveBeenCalledWith("clip_preview", { id: "k1" });
    expect(document.querySelector<HTMLImageElement>(".shotLargeImage")?.src).toBe(PNG);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Shelf" }));
    expect(spy).toHaveBeenCalledWith("clip_open", { id: "k1" });
    expect(spy).toHaveBeenCalledWith("clip_to_shelf", { id: "k1" });
  });
  it("when not large no preview is requested and an image has no Open", async () => {
    fakeBridge.addClip(IMG);
    const spy = vi.spyOn(fakeBridge, "call");
    render(<ShotBump item={IMG} main={null} />);
    await settle();
    expect(spy).not.toHaveBeenCalledWith("clip_preview", expect.anything());
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });
  it("a file always has Open and Add to Shelf", async () => {
    fakeBridge.addClip(FILE);
    const spy = vi.spyOn(fakeBridge, "call");
    render(<ShotBump item={FILE} main={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(spy).toHaveBeenCalledWith("clip_open", { id: "k2" });
  });
  it("a refusal while locked is silent: no error, the thumbnail stays", async () => {
    fakeBridge.addClip(IMG);
    fakeBridge.setLocked(true);
    render(<ShotBump item={IMG} main={null} big />);
    await settle();
    expect(document.querySelector<HTMLImageElement>(".shotLargeImage")?.src).toBe(PNG);
    fireEvent.click(screen.getByRole("button", { name: "Add to Shelf" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
