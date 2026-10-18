import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { Shell } from "../components/Shell";

// Download done (Rust `download_done {id, name, size}`): "Downloaded: name", Open, Show in folder; generic text while locked and in presentations.
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
});
afterEach(() => {
  cleanup();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const center = () => document.querySelector<HTMLElement>(".islandCenter")!;

describe("download_done (C)", () => {
  it("'Downloaded: name'; Open and Show in folder send their commands; after Open the peek clears with Esc", { timeout: 20000 }, async () => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushDownload({ id: "d1", name: "report-q3.pdf", size: 1234 }));
    await settle(300);
    expect(center().textContent).toContain("Downloaded: report-q3.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in folder" }));
    expect(spy).toHaveBeenCalledWith("download_open", { id: "d1" });
    expect(spy).toHaveBeenCalledWith("download_show_in_folder", { id: "d1" });
    fireEvent.keyDown(document, { key: "Escape" });
    await settle(300);
    expect(center().textContent).not.toContain("Downloaded:");
  });
  it("a long name is truncated (40 characters)", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushDownload({ id: "d2", name: "x".repeat(200) + ".zip", size: 1 }));
    await settle(300);
    expect(center().textContent!.length).toBeLessThan(80);
  });
  it("while locked there is no name or button, just the generic 'Download complete'", { timeout: 20000 }, async () => {
    fakeBridge.setLocked(true);
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.pushDownload({ id: "d3", name: "secret-document.pdf", size: 1 }));
    await settle(300);
    expect(center().textContent).toContain("Download complete");
    expect(document.body.textContent).not.toContain("secret-document");
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
  });
  it("no name in presentations", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }));
    act(() => fakeBridge.pushDownload({ id: "d4", name: "secret-document.pdf", size: 1 }));
    await settle(300);
    expect(document.body.textContent).not.toContain("secret-document");
  });
  it("Settings: the download switch writes watchDownloads", { timeout: 20000 }, async () => {
    render(<Shell monitor="m1" init={{ panel: "appearance" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "More settings" }));
    const sw = await screen.findByRole("switch", { name: "Download complete alert" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await settle();
    expect((await fakeBridge.call("get_settings")).watchDownloads).toBe(false);
  });
});
