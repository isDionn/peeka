"""Drive a Windows Sandbox from the host through one mapped folder (see ARASTIRMA.md for why not Cua).

Host -> guest: out/cmd/NNN.ps1. Guest -> host: out/res/NNN.json, out/shots/*.png.
Only three folders are ever mapped: the probe build (RO), the notch build (RO, if present), out/ (RW).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
NOTCH = HERE.parents[1]  # repo root
PROBE_DIR = NOTCH / "tools" / "probe" / "target" / "release"
NOTCH_DIR = NOTCH / "target" / "release"
OUT = HERE / "out"
SANDBOX_EXE = Path(r"C:\Windows\System32\WindowsSandbox.exe")
SANDBOX_PROCS = ("WindowsSandbox.exe", "WindowsSandboxClient.exe", "WindowsSandboxRemoteSession.exe")
RUNTIME_DLLS = ("vcruntime140.dll", "vcruntime140_1.dll")
GUEST_OUT = r"C:\out"

VK = {"win": 0x5B, "ctrl": 0x11, "alt": 0x12, "shift": 0x10, "enter": 0x0D, "esc": 0x1B, "tab": 0x09, "space": 0x20}


def _check_host_path(p: Path) -> None:
    """Trust boundary: never map the profile root or any of its parents."""
    p = p.resolve()
    home = Path.home().resolve()
    if p == home or p in home.parents:
        raise ValueError(f"refusing to map {p}")


def mappings(probe_dir: Path = PROBE_DIR, notch_dir: Path = NOTCH_DIR, out: Path = OUT) -> list[tuple[Path, str, bool]]:
    m = [(probe_dir, r"C:\probe", True)]
    if notch_dir.is_dir():
        m.append((notch_dir, r"C:\notch", True))
    m.append((out, GUEST_OUT, False))
    for host, _, _ in m:
        _check_host_path(host)
    return m


def wsb_xml(maps: list[tuple[Path, str, bool]]) -> str:
    cfg = ET.Element("Configuration")
    for tag, val in (("Networking", "Disable"), ("MemoryInMB", "4096"), ("ClipboardRedirection", "Disable"),
                     ("AudioInput", "Disable"), ("VideoInput", "Disable"), ("PrinterRedirection", "Disable")):
        ET.SubElement(cfg, tag).text = val
    mf = ET.SubElement(cfg, "MappedFolders")
    for host, guest, ro in maps:
        e = ET.SubElement(mf, "MappedFolder")
        ET.SubElement(e, "HostFolder").text = str(host)
        ET.SubElement(e, "SandboxFolder").text = guest
        ET.SubElement(e, "ReadOnly").text = "true" if ro else "false"
    lc = ET.SubElement(cfg, "LogonCommand")
    ET.SubElement(lc, "Command").text = (
        rf"powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File {GUEST_OUT}\agent.ps1"
    )
    return ET.tostring(cfg, encoding="unicode")


def sandbox_running() -> bool:
    r = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, check=False)
    return any(f'"{n.lower()}"' in r.stdout.lower() for n in SANDBOX_PROCS)


class Sandbox:
    def __init__(self, out: Path = OUT):
        self.out = out
        self._n = 0

    # shortcut: file queue polled every 300 ms; on 24H2+ `wsb exec` (if `Get-Command wsb` exists) could replace it.
    def start(self) -> None:
        if not SANDBOX_EXE.exists():
            raise RuntimeError("Windows Sandbox is not enabled (WindowsSandbox.exe missing)")
        if sandbox_running():
            raise RuntimeError("a Windows Sandbox is already running (only one instance is allowed)")
        for sub in ("cmd", "res", "shots", "runtime"):
            shutil.rmtree(self.out / sub, ignore_errors=True)
        (self.out / "runtime").mkdir(parents=True)
        for f in ("ready.txt", "testwin-clicks.txt", "agent-error.txt"):
            (self.out / f).unlink(missing_ok=True)
        for name in ("agent.ps1", "testwin.ps1"):
            # BOM so Windows PowerShell 5.1 reads the Turkish strings as UTF-8.
            (self.out / name).write_text((HERE / name).read_text(encoding="utf-8"), encoding="utf-8-sig")
        for dll in RUNTIME_DLLS:
            src = Path(r"C:\Windows\System32") / dll
            if src.exists():
                shutil.copy2(src, self.out / "runtime" / dll)
        wsb = self.out / "peeka-vmtest.wsb"
        wsb.write_text(wsb_xml(mappings(out=self.out)), encoding="utf-8")
        subprocess.Popen([str(SANDBOX_EXE), str(wsb)])

    def wait_ready(self, timeout: float = 300) -> str:
        ready = self.out / "ready.txt"
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if ready.exists():
                return ready.read_text(encoding="utf-8-sig").strip()
            time.sleep(1)
        err = self.out / "agent-error.txt"
        detail = err.read_text(encoding="utf-8-sig") if err.exists() else "no agent-error.txt"
        raise TimeoutError(f"sandbox agent did not report ready: {detail}")

    def run(self, ps: str, timeout: float = 60) -> str:
        """Run PowerShell inside the sandbox; return its output text. Raises on a script error or timeout."""
        self._n += 1
        jid = f"{self._n:05d}"
        (self.out / "cmd").mkdir(parents=True, exist_ok=True)
        tmp = self.out / "cmd" / f"{jid}.tmp"
        tmp.write_text(ps, encoding="utf-8-sig")
        tmp.replace(self.out / "cmd" / f"{jid}.ps1")
        res = self.out / "res" / f"{jid}.json"
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if res.exists():
                d = json.loads(res.read_text(encoding="utf-8-sig"))
                if not d["ok"]:
                    raise RuntimeError(f"sandbox job {jid} failed: {d['output']}")
                return d["output"] or ""
            time.sleep(0.2)
        raise TimeoutError(f"sandbox job {jid} timed out")

    def run_json(self, ps: str, timeout: float = 60):
        return json.loads(self.run(f"ConvertTo-Json -Compress -Depth 5 -InputObject $({ps})", timeout))

    def screenshot(self, name: str) -> Path:
        self.run(f"Shot '{name}'")
        return self.out / "shots" / f"{name}.png"

    def click(self, x: int, y: int) -> None:
        self.run(f"[W]::Click({int(x)}, {int(y)})")

    def type(self, text: str) -> None:
        esc = "".join("{" + c + "}" if c in "+^%~(){}[]" else c for c in text).replace("'", "''")
        self.run(f"[System.Windows.Forms.SendKeys]::SendWait('{esc}')")

    def key(self, combo: str) -> None:
        """'win', 'win+a', 'esc', 'ctrl+shift+t' ... pressed together, released in reverse."""
        vks = [VK[k] if k in VK else ord(k.upper()) for k in combo.lower().split("+")]
        self.run("[W]::Keys([byte[]](" + ",".join(str(v) for v in vks) + "))")

    def measure(self) -> dict:
        return self.run_json("Measure-Desk")

    def webview2(self) -> dict:
        return self.run_json(
            "$k='HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';"
            "[ordered]@{ registry_version = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv;"
            " exe = @(Get-ChildItem 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application\\*\\msedgewebview2.exe',"
            "'C:\\Windows\\SystemApps\\*\\msedgewebview2.exe' -ErrorAction SilentlyContinue | ForEach-Object FullName) }"
        )

    def shutdown(self, timeout: float = 60) -> None:
        (self.out / "cmd").mkdir(parents=True, exist_ok=True)
        (self.out / "cmd" / "99999.ps1").write_text("shutdown /s /t 0", encoding="utf-8-sig")
        end = time.monotonic() + timeout
        while time.monotonic() < end and sandbox_running():
            time.sleep(1)
        for n in SANDBOX_PROCS:  # fallback, like Cua's own runner
            subprocess.run(["taskkill", "/F", "/IM", n], capture_output=True, check=False)


if __name__ == "__main__":
    sb = Sandbox()
    sb.start()
    print(sb.wait_ready())
    print(sb.screenshot("smoke"))
    print(sb.webview2())
    sb.shutdown()
