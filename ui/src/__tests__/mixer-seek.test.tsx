// RC7 owner: per-app volume in the Status panel; seeking in the music card (drag, click, arrow keys ±5 s).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bridge, type Media } from "../bridge";
import { fakeBridge } from "../bridge.fake";
import { MusicCard } from "../components/IslandCards";
import { AppMixer, StatusCard } from "../components/StatusCard";

beforeEach(() => { fakeBridge.reset(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("music card seek", () => {
  const media = (patch: Partial<Media> = {}): Media => ({ title: "Song", artist: "Band", album: "", app: "Spotify", art: null, playing: false, positionMs: 86_000, positionAt: Date.now(), durationMs: 232_000, canNext: true, canPrevious: true, canSeek: true, ...patch } as Media);
  const track = () => screen.getByRole("slider", { name: "Track position" }) as HTMLInputElement;
  const times = () => [...document.querySelectorAll(".player .progress span")].map((s) => s.textContent);
  const seeks = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => c[0] === "media_control").map((c) => c[1]);

  it("dragging moves the time labels, release sends one seek, and the new time stays (no snap back)", async () => {
    const spy = vi.spyOn(bridge, "call");
    render(<MusicCard media={media()} pos={86} />);
    fireEvent.change(track(), { target: { value: "150" } });
    expect(times()).toEqual(["2:30", "-1:22"]);
    expect(document.querySelector(".player")!.hasAttribute("data-scrub")).toBe(true); // the row stays open while dragging
    expect(seeks(spy)).toEqual([]);
    fireEvent.pointerUp(track());
    fireEvent.blur(track());
    expect(seeks(spy)).toEqual([{ action: "seek", positionMs: 150_000 }]); // once, not again on blur
    await settle();
    expect(track().value).toBe("150");
  });

  it("arrow keys step 5 s and commit on release, clamped to the track", () => {
    const spy = vi.spyOn(bridge, "call");
    render(<MusicCard media={media({ positionMs: 2_000 })} pos={2} />);
    fireEvent.keyDown(track(), { key: "ArrowRight" });
    fireEvent.keyDown(track(), { key: "ArrowRight" });
    expect(track().value).toBe("12");
    fireEvent.keyUp(track(), { key: "ArrowRight" });
    expect(seeks(spy)).toEqual([{ action: "seek", positionMs: 12_000 }]);
    cleanup();
    render(<MusicCard media={media({ positionMs: 2_000 })} pos={2} />);
    fireEvent.keyDown(track(), { key: "ArrowLeft" });
    expect(track().value).toBe("0");
  });

  it("the track is disabled when the player doesn't allow seeking or has no length", () => {
    render(<MusicCard media={media({ canSeek: false })} pos={86} />);
    expect(track().disabled).toBe(true);
    cleanup();
    render(<MusicCard media={media({ durationMs: 0 })} pos={86} />);
    expect(track().disabled).toBe(true);
  });
});

describe("per-app mixer", () => {
  const apps = () => screen.getByRole("button", { name: "Apps" });

  it("closed at first; open lists each app with a slider and mute, and the choice is remembered", async () => {
    render(<AppMixer />);
    expect(apps().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(apps());
    await settle();
    expect(screen.getAllByRole("slider").map((s) => s.getAttribute("aria-label"))).toEqual(["Spotify volume", "Google Chrome volume", "Discord volume", "System sounds volume"]);
    expect((screen.getByRole("slider", { name: "Google Chrome volume" }) as HTMLInputElement).value).toBe("45");
    expect(screen.getByRole("button", { name: "Mute Discord" }).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    render(<AppMixer />);
    await settle();
    expect(apps().getAttribute("aria-expanded")).toBe("true");
  });

  it("a slider sets that app's volume 0..1; mute toggles it", async () => {
    render(<AppMixer />);
    fireEvent.click(apps());
    await settle();
    fireEvent.change(screen.getByRole("slider", { name: "Spotify volume" }), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Mute Discord" }));
    expect(fakeBridge.log.filter((l) => l.cmd === "audio_session_set").map((l) => l.args)).toEqual([{ id: "a1", volume: 0.3, muted: undefined }, { id: "a3", volume: undefined, muted: false }]);
    expect((screen.getByRole("slider", { name: "Spotify volume" }) as HTMLInputElement).value).toBe("30");
    expect(screen.getByRole("button", { name: "Mute Discord" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("not drawn while Peeka is locked or the screen is shared", async () => {
    const [monitor, status] = [await fakeBridge.call("get_monitor", { monitor: "m1" }), await fakeBridge.call("get_status")];
    render(<StatusCard monitor={monitor} status={status} setStatus={() => undefined} />);
    await settle();
    expect(screen.getByRole("button", { name: "Apps" })).toBeTruthy();
    cleanup();
    fakeBridge.setLocked(true, "manual");
    render(<StatusCard monitor={monitor} status={status} setStatus={() => undefined} />);
    await settle();
    expect(screen.queryByRole("button", { name: "Apps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quit Peeka" })).toBeNull(); // Quit moved to Settings > About
    cleanup();
    fakeBridge.setLocked(false);
    fakeBridge.setPrivacy({ mic: [], camera: [], screen: true });
    render(<StatusCard monitor={monitor} status={status} setStatus={() => undefined} />);
    await settle();
    expect(screen.queryByRole("button", { name: "Apps" })).toBeNull(); // sharing the screen: no app names
  });
});
