import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBridge } from "../bridge.fake";
import { Island } from "../components/Island";
import { ProtrusionBump } from "../components/Plugin";
import { useMeetingReminder } from "../hooks";
import { meetingReminder, openJoinLink, REMINDER_GENERIC, setOpenJoinLink } from "../lib/meetingReminder";
import { pickPrimary } from "../lib/priority";

// Plan item 22: from the Compass calendar, 5 min before a meeting "In 5 min: <title>" + "Join" (if there is a link); at 1 min it moves to the main strip in the "meeting" slot.
const T0 = Date.parse("2026-10-18T12:00:00+03:00");
const LINK = "https://teams.microsoft.com/l/meetup-join/x";
const cal = (startMs: number, link?: string) => ({ detail: null, next: [{ time: "12:30", title: "Weekly planning", source: "Calendar", start: new Date(startMs).toISOString(), ...(link ? { link } : {}) }] });
const saved = openJoinLink;
afterEach(() => { setOpenJoinLink(saved); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("meetingReminder (pure)", () => {
  it("5 min window: nothing at 6 min; 'In N min' at 5 min; the 'meeting' slot at 1 min; 'Started' for 1 min after it begins; nothing after", () => {
    const at = (leftS: number) => meetingReminder(cal(T0 + leftS * 1000, LINK), T0, false);
    expect(at(360)).toBeNull();
    expect(at(300)).toMatchObject({ title: "In 5 min: Weekly planning", icon: "clock", link: LINK, actions: [{ id: "join" }] });
    expect(at(121)?.title).toBe("In 3 min: Weekly planning");
    expect(at(61)?.icon).toBe("clock");
    expect(at(60)).toMatchObject({ title: "In 1 min: Weekly planning", icon: "calendar" });
    expect(at(-30)?.title).toBe("Started: Weekly planning");
    expect(at(-61)).toBeNull();
  });
  it("locked or presenting: generic text, no title, link or button", () => {
    const r = meetingReminder(cal(T0 + 200_000, LINK), T0, true)!;
    expect(r.title).toBe(REMINDER_GENERIC);
    expect(JSON.stringify(r)).not.toMatch(/Weekly|teams/);
    expect(r.actions).toEqual([]);
  });
  it("no link means no button; a row with a broken start or all-day (no start) does not count down", () => {
    expect(meetingReminder(cal(T0 + 200_000), T0, false)?.actions).toEqual([]);
    expect(meetingReminder({ detail: null, next: [{ time: "all day", title: "x", source: "" }, { time: "1", title: "y", source: "", start: "tomorrow" }] }, T0, false)).toBeNull();
  });
  it("the 'meeting' slot at 1 min sits below a live task but above a notification; at 5 min it is an ordinary peek and drops to the bottom", () => {
    expect(pickPrimary([{ kind: "music" }, { kind: "meeting" }, { kind: "alert" }]).primary?.kind).toBe("meeting");
    expect(pickPrimary([{ kind: "music" }, { kind: "other" }]).primary?.kind).toBe("music");
  });
});

describe("useMeetingReminder (fake clock)", () => {
  beforeEach(() => { fakeBridge.reset(); vi.useFakeTimers({ now: T0 }); });
  it("over time it appears at 5 min, rises at 1 min, fades 1 min after the start; refreshes when the calendar changes", async () => {
    fakeBridge.setCalendar(cal(T0 + 330_000, LINK)); // 5 min 30 s from now
    const { result } = renderHook(() => useMeetingReminder(false));
    const run = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await run(0);
    expect(result.current).toBeNull();
    await run(45_000);
    expect(result.current?.title).toBe("In 5 min: Weekly planning");
    await run(240_000); // 45 s left
    expect(result.current).toMatchObject({ title: "In 1 min: Weekly planning", icon: "calendar" });
    await run(120_000); // 75 s since the start
    expect(result.current).toBeNull();
    fakeBridge.setCalendar(cal(Date.now() + 200_000)); // Compass sent a new calendar
    await run(60_000);
    expect(result.current?.title).toMatch(/^In [23] min/);
  });
  it("when the lock/presentation flag changes it returns to the generic text", async () => {
    fakeBridge.setCalendar(cal(T0 + 200_000, LINK));
    const { result, rerender } = renderHook(({ g }) => useMeetingReminder(g), { initialProps: { g: false } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.title).toContain("Weekly planning");
    rerender({ g: true });
    expect(result.current?.title).toBe(REMINDER_GENERIC);
  });
});

describe("Join button", () => {
  const item = () => meetingReminder(cal(T0 + 200_000, LINK), T0, false)!;
  beforeEach(() => { fakeBridge.reset(); vi.useFakeTimers({ now: T0 }); });
  it("opens the link; no plugin_action goes to the plugin", async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    setOpenJoinLink(open);
    render(<ProtrusionBump item={item()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(open).toHaveBeenCalledWith(LINK);
    expect(fakeBridge.log.filter((l) => l.cmd === "plugin_action")).toHaveLength(0);
  });
  it("if there is no open command or it rejects, the button says 'Couldn't open'", async () => {
    render(<ProtrusionBump item={item()} />); // default: no command
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Join" })); });
    expect(screen.getByRole("button", { name: "Couldn't open" })).toBeTruthy();
  });
  it("with no link the button never shows", () => {
    render(<ProtrusionBump item={meetingReminder(cal(T0 + 200_000), T0, false)!} />);
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });
});

describe("on the island", () => {
  const rectOf = (el: HTMLElement) => ({ left: 10, top: 5, width: parseFloat(el.style.width) || (el.dataset.hit !== undefined ? 100 : 0), height: parseFloat(el.style.height) || 30 }) as DOMRect;
  const settle = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const all = () => { const r = document.body.cloneNode(true) as HTMLElement; r.querySelectorAll("[data-leaving]").forEach((e) => e.remove()); return [r.textContent ?? "", ...[...r.querySelectorAll("[aria-label],[title]")].map((e) => `${e.getAttribute("aria-label")} ${e.getAttribute("title")}`)].join(" "); };
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return rectOf(this); });
    fakeBridge.reset(); localStorage.clear();
  });
  const center = () => document.body.querySelector(".islandCenter")?.textContent ?? "";
  it("at 5 min it stays in the side bubble behind the music", async () => {
    fakeBridge.setCalendar(cal(Date.now() + 240_000, LINK));
    render(<Island monitor="m1" init={{ view: null, pin: true, autoMusic: true }} />);
    await settle();
    expect(all()).toContain("In 4 min: Weekly planning");
    expect(center()).not.toContain("Weekly planning");
  });
  it("at 1 min, with the 'meeting' slot, it overtakes the music and moves to the main strip", async () => {
    fakeBridge.setCalendar(cal(Date.now() + 40_000, LINK));
    render(<Island monitor="m1" init={{ view: null, pin: true, autoMusic: true }} />);
    await settle();
    expect(center()).toContain("In 1 min: Weekly planning");
  });
  it("presentation: only the generic text on the main strip, the title nowhere", async () => {
    fakeBridge.setCalendar(cal(Date.now() + 40_000, LINK));
    render(<Island monitor="m1" init={{ view: null, pin: true }} />);
    await settle();
    act(() => fakeBridge.emit("input_tick", { lastInputAgoMs: 0, cursor: null, presentation: true }));
    await settle(200);
    expect(center()).toContain(REMINDER_GENERIC);
    expect(all()).not.toContain("Weekly planning");
  });
});
