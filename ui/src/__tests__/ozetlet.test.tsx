import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { ClipItem, ClipPlain } from "../bridge";
import { Island } from "../components/Island";

// "Pusula'ya özetlet" (senaryo 5): yalnız bağlantı çıkıntısında, yalnız ana asistan bağlıyken, kilitliyken yok;
// tıklayınca bağlantı eki ve "özetle" cümlesiyle composer_submit gider (sayfa metni arayüzden hiç geçmez).
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const clip = (id: string, p: Partial<ClipPlain>): ClipPlain => ({ id, createdAt: Date.now(), pinned: false, source: "Edge", kind: "text", text: null, sub: null, thumb: null, screenshot: false, ...p });
const link = (id = "l1") => clip(id, { text: "https://ornek.com/yazi", hint: "link" });
const copy = async (c: ClipItem) => { act(() => fakeBridge.addClip(c)); await settle(); };
const btn = () => [...document.querySelectorAll<HTMLButtonElement>(".shotCik button")].find((b) => /özetlet/.test(b.textContent ?? ""));
const calls = (cmd: string) => fakeBridge.log.filter((l) => l.cmd === cmd);

describe("Pusula'ya özetlet", () => {
  it("yalnız bağlantıda görünür; dosya ve görselde yok", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(clip("f1", { kind: "file", text: "rapor.pdf", sub: "1 MB" }));
    expect(document.querySelector(".shotCik")).not.toBeNull();
    expect(btn()).toBeUndefined();
    await copy(link());
    await settle(300);
    expect(btn()).toBeDefined();
  });

  it("tıklayınca bağlantı eki ve özetle cümlesi gider", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await copy(link());
    fireEvent.click(btn()!);
    await settle();
    expect(calls("composer_submit")).toEqual([{ cmd: "composer_submit", args: { text: "Bu bağlantıyı özetle", attachments: [{ kind: "clipboard_link" }] } }]);
  });

  it("ana asistan bağlı değilken yok", async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.setPlugins([]));
    await settle();
    await copy(link());
    expect(document.querySelector(".shotCik")).not.toBeNull();
    expect(btn()).toBeUndefined();
  });
});
