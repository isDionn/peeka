import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { Notice } from "../bridge";
import { MirrorCard, NoticeToast } from "../components/Notifications";

// Verification code in a notification (`hasCode`): "Copy code" calls notif_copy_code; the digits never appear in the UI; no button while locked.
const N: Notice = { id: "c1", app: "Bank", title: "Your sign-in code has arrived", body: "Do not share the code with anyone", tile: "", tileMono: true, ripple: false, openLabel: "Open app", canOpen: true, at: 1, hasCode: true };
beforeEach(() => { fakeBridge.reset(); fakeBridge.pushNotice({ ...N }); });
afterEach(cleanup);
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("Copy code (E)", () => {
  it.each([["row", () => <MirrorCard n={N} />], ["card", () => <NoticeToast n={N} />]])("%s: the button calls the command and shows a short confirmation", async (_name, ui) => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Copy code" }));
    await settle();
    expect(spy).toHaveBeenCalledWith("notif_copy_code", { id: "c1" });
    expect(screen.getByRole("status").textContent).toBe("Copied · clears in 60s");
    expect(document.body.textContent).not.toMatch(/\d{4,}/); // the code digits never reach the UI
  });
  it("no button without hasCode", () => {
    render(<MirrorCard n={{ ...N, hasCode: false }} />);
    expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
  });
  it("button hidden while locked", async () => {
    fakeBridge.setLocked(true);
    render(<MirrorCard n={N} />);
    await settle();
    expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
  });
  it("if Rust refuses (lock race) it stays silent and shows no confirmation", async () => {
    render(<MirrorCard n={N} />);
    const btn = await screen.findByRole("button", { name: "Copy code" });
    act(() => fakeBridge.setLocked(true));
    fireEvent.click(btn);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
