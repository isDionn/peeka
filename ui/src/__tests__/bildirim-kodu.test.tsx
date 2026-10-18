import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import type { Notice } from "../bridge";
import { MirrorCard, NoticeToast } from "../components/Notifications";

// Bildirimde doğrulama kodu (`hasCode`): "Kodu kopyala" notif_copy_code çağırır; rakamlar arayüzde hiç yok; kilitliyken düğme yok.
const N: Notice = { id: "c1", app: "Banka", title: "Giriş kodunuz geldi", body: "Kodu kimseyle paylaşmayın", tile: "", tileMono: true, ripple: false, openLabel: "Uygulamayı aç", canOpen: true, at: 1, hasCode: true };
beforeEach(() => { fakeBridge.reset(); fakeBridge.pushNotice({ ...N }); });
afterEach(cleanup);
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("Kodu kopyala (E)", () => {
  it.each([["satır", () => <MirrorCard n={N} />], ["kart", () => <NoticeToast n={N} />]])("%s: düğme komutu çağırır, kısa onay yazar", async (_ad, ui) => {
    const spy = vi.spyOn(fakeBridge, "call");
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Kodu kopyala" }));
    await settle();
    expect(spy).toHaveBeenCalledWith("notif_copy_code", { id: "c1" });
    expect(screen.getByRole("status").textContent).toBe("Kopyalandı · 60 sn sonra silinecek");
    expect(document.body.textContent).not.toMatch(/\d{4,}/); // kod rakamı arayüze hiç gelmez
  });
  it("hasCode yoksa düğme yok", () => {
    render(<MirrorCard n={{ ...N, hasCode: false }} />);
    expect(screen.queryByRole("button", { name: "Kodu kopyala" })).toBeNull();
  });
  it("kilitliyken düğme gizli", async () => {
    fakeBridge.setLocked(true);
    render(<MirrorCard n={N} />);
    await settle();
    expect(screen.queryByRole("button", { name: "Kodu kopyala" })).toBeNull();
  });
  it("Rust reddederse (kilit yarışı) sessiz kalır, onay yazmaz", async () => {
    render(<MirrorCard n={N} />);
    const btn = await screen.findByRole("button", { name: "Kodu kopyala" });
    act(() => fakeBridge.setLocked(true));
    fireEvent.click(btn);
    await settle();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
