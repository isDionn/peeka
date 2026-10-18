import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { firstRunDone } from "../lib/firstRun";
import { onX, sendX, type XMsg } from "../lib/xwin";
import { APPROVAL_LOW } from "../plugin.fixtures";

// Şerit paneli (durum, Ayarlar...) açılınca ada kartı çekilir: ada penceresi şeridin üstünde, kart paneli örtmesin (çıkmaz sokak yok).
const settle = (ms = 150) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
beforeEach(() => { fakeBridge.reset(); localStorage.clear(); });

describe("şerit paneli açılınca ada kartı çekilir", () => {
  it("hoş geldin açıkken durum paneli açılırsa kart kapanır, 'Geç' sayılır ve geri gelmez", async () => {
    const got: XMsg[] = [];
    const off = onX((m) => got.push(m));
    render(<Island monitor="m1" />);
    await settle();
    expect(screen.getByRole("dialog", { name: /hoş geldin/ })).toBeTruthy();
    sendX({ t: "panel-open", panel: "status" });
    sendX({ t: "panel", panel: "status" });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(firstRunDone()).toBe(true);
    expect(got).toContainEqual({ t: "welcome", open: false });
    sendX({ t: "panel", panel: null }); // panel kapandı: kart kendiliğinden dönmez
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    off();
  });

  it("onay bekliyorsa panel açılıp kapanınca onay kaybolmaz", async () => {
    fakeBridge.setSurfaces({ approvals: [APPROVAL_LOW], approvalTop: APPROVAL_LOW.id });
    localStorage.setItem("notch.ilkAcilis", "1");
    render(<Island monitor="m1" />);
    await settle();
    sendX({ t: "panel-open", panel: "status" });
    sendX({ t: "panel", panel: "status" });
    await settle();
    sendX({ t: "panel", panel: null });
    await settle();
    expect(fakeBridge.log.some((c) => c.cmd === "approval_answer")).toBe(false);
    expect(screen.getAllByText(/api-sunucu izin istiyor/).length).toBeGreaterThan(0);
  });
});
