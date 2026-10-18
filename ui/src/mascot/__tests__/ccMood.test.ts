import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CC_HOLD_MS, ccMoodOf, createCcMood } from "../ccMood";
import type { Mood } from "../moods";

describe("Claude Code olayı -> hal", () => {
  const m = (kind: string, tool?: string, reason?: string) => ccMoodOf({ kind, tool, reason });
  it("tablo: düşünme, arama, soru, izin, hata, kota, bitti", () => {
    expect(m("prompt")).toBe("thinking");
    expect(m("post_tool")).toBe("thinking");
    expect(m("subagent_start")).toBe("thinking");
    expect(m("pre_tool", "Edit")).toBe("thinking");
    for (const t of ["WebSearch", "WebFetch", "Grep", "Glob", "mcp__x__web_search"]) expect(m("pre_tool", t)).toBe("searching");
    expect(m("pre_tool", "AskUserQuestion")).toBe("question");
    expect(m("permission")).toBe("approval");
    expect(m("notification", undefined, "permission_prompt")).toBe("approval");
    expect(m("notification", undefined, "elicitation_dialog")).toBe("question");
    expect(m("notification", undefined, "idle_prompt")).toBe("attention");
    expect(m("tool_failed")).toBe("error");
    expect(m("stop_failure", undefined, "rate_limit")).toBe("ratelimit");
    expect(m("stop_failure", undefined, "server_error")).toBe("error");
    expect(m("stop_failure")).toBe("error");
    expect(m("stop")).toBe("done");
    expect(m("session_end")).toBe("idle");
  });
  it("bilinmeyen olay ve değişmeyenler null (hal korunur)", () => {
    expect(m("subagent_stop")).toBeNull(); expect(m("nope")).toBeNull(); expect(m("notification")).toBeNull();
    expect(m("pre_tool", "Bash; rm -rf")).toBe("thinking");   // araç adı yalnız sınıflama için, çalıştırılmaz
  });
});

describe("hal sürücüsü (zamanlayıcı)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const mk = () => { const seen: (Mood | null)[] = []; const c = createCcMood((x) => seen.push(x)); return { c, seen }; };
  it("bitti 5 sn sonra idle'a (null) döner", () => {
    const { c, seen } = mk();
    c.feed({ kind: "stop" }); expect(seen).toEqual(["done"]);
    vi.advanceTimersByTime(4999); expect(seen).toEqual(["done"]);
    vi.advanceTimersByTime(2); expect(seen).toEqual(["done", null]);
    expect(CC_HOLD_MS.done).toBe(5000);
  });
  it("yeni olay eski sayacı iptal eder; bitti sonrası yeni istem bitti düşmesini bekletmez", () => {
    const { c, seen } = mk();
    c.feed({ kind: "stop" }); vi.advanceTimersByTime(3000);
    c.feed({ kind: "prompt" }); vi.advanceTimersByTime(3000);   // eski 5 sn dolsa bile thinking kalır
    expect(seen).toEqual(["done", "thinking"]);
  });
  it("kanca susarsa çalışma hali 2 dk sonra düşer; oturum bitince hemen", () => {
    const { c, seen } = mk();
    c.feed({ kind: "pre_tool", tool: "WebSearch" }); vi.advanceTimersByTime(119_000); expect(seen).toEqual(["searching"]);
    vi.advanceTimersByTime(2000); expect(seen).toEqual(["searching", null]);
    c.feed({ kind: "prompt" }); c.feed({ kind: "session_end" }); expect(seen.at(-1)).toBeNull();
    vi.advanceTimersByTime(300_000); expect(seen.filter((x) => x === null).length).toBe(2);
  });
  it("null dönen olay haline ve sayacına dokunmaz; dispose sayacı temizler", () => {
    const { c, seen } = mk();
    c.feed({ kind: "stop" }); c.feed({ kind: "subagent_stop" }); vi.advanceTimersByTime(5001);
    expect(seen).toEqual(["done", null]);
    c.feed({ kind: "prompt" }); c.dispose(); vi.advanceTimersByTime(500_000); expect(seen).toEqual(["done", null, "thinking"]);
  });
});
