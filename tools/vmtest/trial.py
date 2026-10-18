"""Run the automatable TRIAL.md probe tests (1, 2a, 2b, 3, 4, 6, 7) inside Windows Sandbox.

Writes out/results.json and out/results.md. Usage: .venv\\Scripts\\python trial.py [--keep]
Measurements are in-sandbox Win32 queries; the screenshots under out/shots are for a human look.
"""

from __future__ import annotations

import json
import re
import sys
import time

from sandbox import OUT, Sandbox

PROBE = r"C:\probe\notch-probe.exe"
STRIP_PX = 30  # tools/probe/src/lib.rs

# Text printed by notch-probe that these tests match on; keep in sync with tools/probe/src/win.rs.
GUARD_PID_RE = r"notch-probe\.exe with PID (\d+)"
GUARD_LOG_KEY = "Guard"
TRAY_LOG_KEY = "Tray mirror"
MIRROR_TITLE = "Tray mirror (trial): click a button = right-click that icon"


def start_probe(sb: Sandbox, args: str, tag: str) -> int:
    return int(sb.run(
        f"(Start-Process -FilePath '{PROBE}' -ArgumentList '{args}' -NoNewWindow -PassThru "
        rf"-RedirectStandardOutput 'C:\out\probe-{tag}.txt' -RedirectStandardError 'C:\out\probe-{tag}.err').Id"
    ).strip())


def wait_exit(sb: Sandbox, pid: int, timeout: int = 90) -> None:
    sb.run(f"Wait-Process -Id {pid} -Timeout {timeout} -ErrorAction SilentlyContinue", timeout + 10)


def restore(sb: Sandbox) -> str:
    return sb.run(f"& '{PROBE}' restore 2>&1", 60)


def testwin(sb: Sandbox) -> None:
    """Open (once) and re-maximise the VMTEST window; Windows lays out a new maximise against the work area."""
    sb.run(
        "if (-not [W]::ByTitle('VMTEST').ToInt64()) {"
        r" Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','C:\out\testwin.ps1';"
        " $i=0; while (-not [W]::ByTitle('VMTEST').ToInt64() -and $i -lt 50) { Start-Sleep -m 200; $i++ } }"
    )


def max_rect(sb: Sandbox) -> list[int]:
    testwin(sb)
    return sb.run_json(
        "$h=[W]::ByTitle('VMTEST'); [W]::ShowWindow($h,9)|Out-Null; [W]::ShowWindow($h,3)|Out-Null;"
        " Start-Sleep -m 400; [W]::Rect($h)"
    )


def snap(sb: Sandbox, name: str, with_max: bool = True) -> dict:
    d = sb.measure()
    if with_max:
        d["max_rect"] = max_rect(sb)
    d["shot"] = sb.screenshot(name).name
    return d


def poll(sb: Sandbox, seconds: float, step_ms: int = 200) -> list[dict]:
    """Sample work area + tray in the guest so timing is not skewed by the host round trip."""
    return sb.run_json(
        f"$s=[Diagnostics.Stopwatch]::StartNew(); $r=@(); while ($s.ElapsedMilliseconds -lt {int(seconds * 1000)}) {{"
        " $r += [ordered]@{ ms=$s.ElapsedMilliseconds; wa=[W]::WorkArea(); tray_exists=[W]::TrayExists();"
        f" tray_visible=[W]::TrayVisible() }}; Start-Sleep -m {step_ms} }}; $r",
        seconds + 30,
    )


def t1_appbar(sb: Sandbox) -> dict:
    before = snap(sb, "t1-0-before")
    pid = start_probe(sb, "appbar on", "t1")
    time.sleep(4)
    during = snap(sb, "t1-1-during")
    wait_exit(sb, pid)
    time.sleep(2)
    after = snap(sb, "t1-2-after")
    top_shift = during["work_area"][1] - before["work_area"][1]
    return {
        "before": before, "during": during, "after": after,
        "work_area_top_shift_px": top_shift,
        "pass": top_shift >= STRIP_PX and during["max_rect"][1] >= during["work_area"][1] - 8
        and after["work_area"] == before["work_area"],
    }


def t2a_crash(sb: Sandbox) -> dict:
    base = sb.measure()["work_area"]
    pid = start_probe(sb, "appbar on", "t2a")
    time.sleep(4)
    during = snap(sb, "t2a-0-during", with_max=False)
    sb.run(f"Stop-Process -Id {pid} -Force")
    samples = poll(sb, 15, 500)
    after_kill = snap(sb, "t2a-1-after-kill")
    sb.run("Stop-Process -Name explorer -Force; Start-Sleep 5; if (-not (Get-Process explorer -EA 0)) { Start-Process explorer }; Start-Sleep 3")
    after_explorer = snap(sb, "t2a-2-after-explorer")
    r = restore(sb)
    stuck = [s["ms"] for s in samples if s["wa"] != base]
    return {
        "base_work_area": base, "during": during, "after_kill": after_kill, "after_explorer_restart": after_explorer,
        "stuck_ms_after_kill": max(stuck) if stuck else 0, "stuck_whole_15s": len(stuck) == len(samples),
        "explorer_restart_fixed": after_explorer["work_area"] == base, "restore": r.strip()[-400:],
        "pass": after_explorer["work_area"] == base,  # observational test; pass = Explorer restart cleans up
    }


def t2b_guard(sb: Sandbox) -> dict:
    base = sb.measure()["work_area"]
    start_probe(sb, "guard", "t2b")
    pid = None
    for _ in range(40):
        m = re.search(GUARD_PID_RE, sb.run(r"Get-Content C:\out\probe-t2b.txt -Raw -Encoding UTF8 -EA 0"))
        if m:
            pid = int(m.group(1))
            break
        time.sleep(0.5)
    if pid is None:
        return {"pass": False, "error": "guard never printed the PID line"}
    sb.run(f"Stop-Process -Id {pid} -Force")
    samples = poll(sb, 15, 250)
    shot = sb.screenshot("t2b-0-after-kill").name
    time.sleep(3)
    log = sb.run(rf"Get-Content $env:LOCALAPPDATA\PeekaProbe\probe.log -Encoding UTF8 -EA 0 | Select-String '{GUARD_LOG_KEY}' | Select-Object -Last 8 | Out-String")
    restore(sb)
    back = next((s["ms"] for s in samples if s["wa"] == base), None)
    return {"killed_pid": pid, "work_area_back_after_ms": back, "shot": shot, "guard_log": log.strip(), "pass": back is not None}


def t3_hide(sb: Sandbox) -> dict:
    pid = start_probe(sb, "hide on", "t3")
    time.sleep(3)
    hidden = snap(sb, "t3-0-hidden", with_max=False)
    out = {"hidden": hidden}
    for combo, tag in (("win", "start"), ("win+a", "quick"), ("win+n", "notif")):
        sb.key(combo)
        time.sleep(1.5)
        out[tag] = snap(sb, f"t3-{tag}", with_max=False)
        sb.key("esc")
        time.sleep(1)
    wait_exit(sb, pid)
    time.sleep(2)
    out["after"] = snap(sb, "t3-9-after", with_max=False)
    out["pass"] = not hidden["tray_visible"] and out["after"]["tray_visible"]
    return out


def t4_tray(sb: Sandbox) -> dict:
    pid = start_probe(sb, "tray", "t4")
    time.sleep(5)
    early = snap(sb, "t4-0-overflow", with_max=False)
    time.sleep(25)
    mirror = sb.run(f"[W]::ByTitle('{MIRROR_TITLE}').ToInt64()").strip()
    mirror_shot = sb.screenshot("t4-1-mirror").name
    wait_exit(sb, pid)
    log = sb.run(rf"Get-Content $env:LOCALAPPDATA\PeekaProbe\probe.log -Encoding UTF8 -EA 0 | Select-String '{TRAY_LOG_KEY}' | Select-Object -Last 10 | Out-String")
    restore(sb)
    return {"early": early, "mirror_window_found": mirror not in ("", "0"), "mirror_shot": mirror_shot,
            "log": log.strip(), "pass": mirror not in ("", "0")}


def t6_explorer(sb: Sandbox) -> dict:
    pid = start_probe(sb, "hide on", "t6")
    time.sleep(3)
    sb.run("Stop-Process -Name explorer -Force")
    samples = poll(sb, 15, 100)
    shot = sb.screenshot("t6-0-after").name
    alive = sb.run("[bool](Get-Process explorer -EA 0)").strip() == "True"
    wait_exit(sb, pid)
    restore(sb)
    shown = next((s["ms"] for s in samples if s["tray_visible"]), None)
    rehidden = next((s["ms"] for s in samples if shown is not None and s["ms"] > shown and not s["tray_visible"]), None)
    gap = None if shown is None or rehidden is None else rehidden - shown
    if shown is None:
        return {"explorer_alive": alive, "shot": shot, "pass": False, "error": "tray never seen after explorer restart"}
    return {"explorer_alive": alive, "tray_shown_at_ms": shown, "tray_hidden_again_at_ms": rehidden, "visible_for_ms": gap, "shot": shot,
            "pass": alive and gap is not None and gap <= 1000}


def t7_island(sb: Sandbox) -> dict:
    testwin(sb)
    sb.run("$h=[W]::ByTitle('VMTEST'); [W]::ShowWindow($h,3)|Out-Null; [W]::SetForegroundWindow($h)|Out-Null")
    sb.run(r"Remove-Item C:\out\testwin-clicks.txt -EA 0")
    t0 = time.monotonic()
    pid = start_probe(sb, "island", "t7")
    time.sleep(2)
    rect = sb.run_json("[W]::Rect([W]::ByClass('NotchProbeIsland'))")
    if rect == [0, 0, 0, 0]:
        raise RuntimeError("NotchProbeIsland window not found")
    s = (rect[2] - rect[0]) / 480 or 1  # island is 480 logical px wide
    grey = (rect[0] + int(20 * s), rect[1] + int(20 * s))
    box = (rect[0] + int(240 * s), rect[1] + int(120 * s))

    def clicks() -> int:
        return int(sb.run(r"@(Get-Content C:\out\testwin-clicks.txt -EA 0).Count").strip() or 0)

    res = {"island_rect": rect}
    for mode, at in (("mode1", 3), ("mode2", 34)):
        while time.monotonic() - t0 < at:
            time.sleep(0.5)
        n0 = clicks()
        sb.click(*grey)
        time.sleep(0.6)
        through = clicks() > n0
        sb.run("$h=[W]::ByTitle('VMTEST'); [W]::SetForegroundWindow($h)|Out-Null")
        sb.click(*box)
        time.sleep(0.6)
        fg = sb.measure()["foreground"]
        res[mode] = {"grey_click_passed_through": through, "foreground_after_box_click": fg,
                     "focus_kept": fg == "VMTEST", "shot": sb.screenshot(f"t7-{mode}").name}
    wait_exit(sb, pid)
    restore(sb)
    res["pass"] = all(res[m]["grey_click_passed_through"] and res[m]["focus_kept"] for m in ("mode1", "mode2"))
    return res


TESTS = {"1": t1_appbar, "2a": t2a_crash, "2b": t2b_guard, "3": t3_hide, "4": t4_tray, "6": t6_explorer, "7": t7_island}


def write_md(results: dict) -> None:
    lines = ["# Notch probe: Windows Sandbox results", "", f"Date: {results['date']}", "",
             f"WebView2: {results.get('webview2')}", "", "| Trial | Result | Note |", "|---|---|---|"]
    for k, r in results["tests"].items():
        verdict = "ERROR" if "error" in r else ("PASSED" if r.get("pass") else "FAILED")
        note = r.get("error") or ", ".join(f"{a}={r[a]}" for a in r if a.endswith(("_ms", "_px", "found", "fixed", "whole_15s")))
        lines.append(f"| {k} | {verdict} | {note} |")
    lines += ["", "Screenshots: `out/shots/`. Details: `out/results.json`. Probe log: `out/probe.log`."]
    (OUT / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    keep = "--keep" in sys.argv
    sb = Sandbox()
    sb.start()
    results = {"date": time.strftime("%Y-%m-%d %H:%M"), "ready": sb.wait_ready(), "tests": {}}
    try:
        sb.screenshot("00-ready")
        results["webview2"] = sb.webview2()
        results["vc_runtime"] = sb.run(r"Test-Path C:\Windows\System32\vcruntime140.dll").strip()
        for name, fn in TESTS.items():
            print(f"trial {name} ...", flush=True)
            try:
                results["tests"][name] = fn(sb)
            except Exception as e:  # one broken test must not lose the others' results
                results["tests"][name] = {"pass": False, "error": f"{type(e).__name__}: {e}"}
                try:
                    restore(sb)
                except Exception:
                    pass
            (OUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        sb.run(r"Copy-Item $env:LOCALAPPDATA\PeekaProbe\probe.log C:\out\probe.log -EA 0")
    finally:
        (OUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        write_md(results)
        if not keep:
            sb.shutdown()
    print((OUT / "results.md").read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
