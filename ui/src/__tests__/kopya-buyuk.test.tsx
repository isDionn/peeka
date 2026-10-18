import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipPlain } from "../bridge";
import { ShotBump } from "../components/Pano";

// Kopya şeridi: büyük önizleme `clip_preview` ile, Aç ve Rafa koy (görsel ve dosya); kilitliyken ret sessiz.
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const IMG: ClipPlain = { id: "k1", createdAt: 1, pinned: false, source: "Paint", kind: "image", text: null, sub: "Görsel", thumb: PNG, screenshot: false };
const FILE: ClipPlain = { id: "k2", createdAt: 1, pinned: false, source: "Gezgin", kind: "file", text: "rapor.xlsx", sub: "1 MB", thumb: null, screenshot: false };
beforeEach(() => { fakeBridge.reset(); });
afterEach(cleanup);
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("kopya şeridi (A)", () => {
  it("büyük önizleme clip_preview ister; Aç ve Rafa koy ilgili komutu çağırır", async () => {
    fakeBridge.addClip(IMG);
    const spy = vi.spyOn(fakeBridge, "call");
    render(<ShotBump item={IMG} main={null} big />);
    await settle();
    expect(spy).toHaveBeenCalledWith("clip_preview", { id: "k1" });
    expect(document.querySelector<HTMLImageElement>(".shotBuyukResim")?.src).toBe(PNG);
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    fireEvent.click(screen.getByRole("button", { name: "Rafa koy" }));
    expect(spy).toHaveBeenCalledWith("clip_open", { id: "k1" });
    expect(spy).toHaveBeenCalledWith("clip_to_shelf", { id: "k1" });
  });
  it("büyük değilken önizleme istenmez ve görselde Aç yok", async () => {
    fakeBridge.addClip(IMG);
    const spy = vi.spyOn(fakeBridge, "call");
    render(<ShotBump item={IMG} main={null} />);
    await settle();
    expect(spy).not.toHaveBeenCalledWith("clip_preview", expect.anything());
    expect(screen.queryByRole("button", { name: "Aç" })).toBeNull();
  });
  it("dosyada Aç ve Rafa koy her zaman var", async () => {
    fakeBridge.addClip(FILE);
    const spy = vi.spyOn(fakeBridge, "call");
    render(<ShotBump item={FILE} main={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Aç" }));
    expect(spy).toHaveBeenCalledWith("clip_open", { id: "k2" });
  });
  it("kilitliyken ret sessiz: hata atmaz, küçük resim kalır", async () => {
    fakeBridge.addClip(IMG);
    fakeBridge.setLocked(true);
    render(<ShotBump item={IMG} main={null} big />);
    await settle();
    expect(document.querySelector<HTMLImageElement>(".shotBuyukResim")?.src).toBe(PNG);
    fireEvent.click(screen.getByRole("button", { name: "Rafa koy" }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
