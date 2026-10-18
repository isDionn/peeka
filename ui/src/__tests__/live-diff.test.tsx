import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { editLabel } from "../lib/notes";

// F4 live diff: the edit ticker (cc_edit) and the on-demand diff card (cc_diff)
const proto = HTMLElement.prototype;
const saved = { h: Object.getOwnPropertyDescriptor(proto, "offsetHeight"), w: Object.getOwnPropertyDescriptor(proto, "offsetWidth") };
beforeEach(() => {
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 100 });
  fakeBridge.reset();
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  if (saved.h) Object.defineProperty(proto, "offsetHeight", saved.h); else Reflect.deleteProperty(proto, "offsetHeight");
  if (saved.w) Object.defineProperty(proto, "offsetWidth", saved.w); else Reflect.deleteProperty(proto, "offsetWidth");
});
const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const center = () => document.querySelector<HTMLElement>(".islandCenter")!;
const EDIT = { sid: "1a2b3c4d", file: "src/lib/notes.ts", add: 2, del: 1 };

describe("F4 live diff", () => {
  it("editLabel: base name and counts; generic without a name or while private", () => {
    expect(editLabel(EDIT, false)).toBe("notes.ts +2 −1");
    expect(editLabel(EDIT, true)).toBe("Claude Code is editing");
    expect(editLabel({ sid: null, file: null, add: null, del: null }, false)).toBe("Claude Code is editing");
  });

  it("the ticker shows the file and counts; clicking opens the diff fetched only then", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    act(() => fakeBridge.emit("cc_edit", EDIT));
    await settle(300);
    expect(center().textContent).toContain("notes.ts");
    expect(center().textContent).toContain("+2 −1");
    expect(center().textContent).not.toContain("src/lib"); // the strip shows the name only
    expect(document.querySelector(".diffLines")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show changes" }));
    await settle(300);
    const lines = [...document.querySelectorAll(".diffLines > div")];
    expect(lines.map((l) => l.className)).toEqual(["", "del", "add", "add"]);
    expect(document.body.textContent).toContain("src/lib/notes.ts");
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(fakeBridge.log.some((c) => c.cmd === "cc_diff_open")).toBe(true);
  });

  it("locked: generic label, no file name, no Show changes", { timeout: 20000 }, async () => {
    render(<Island monitor="m1" init={{ view: null }} />);
    await settle();
    await act(async () => { await fakeBridge.call("lock_now"); });
    act(() => fakeBridge.emit("cc_edit", EDIT));
    await settle(300);
    expect(document.body.textContent).not.toContain("notes.ts");
    expect(screen.queryByRole("button", { name: "Show changes" })).toBeNull();
  });
});
