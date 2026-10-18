# Cua + Windows Sandbox: research (2026-10-16)

Sources read: trycua/cua `main` via opensrc (cached 2026-10-16), the `cua-computer` 0.5.19 wheel from PyPI, `pywinsandbox` 1.4.0 via opensrc, one DeepWiki question on trycua/cua.

## Verdict

**Cua is not suitable here. The harness uses a plain `.wsb` file instead.** This is the minimal alternative the brief described, and it is the same pattern Cua's own CI uses.

## What Cua offers for Windows Sandbox today

| Package | Version | Licence | Windows Sandbox? |
|---|---|---|---|
| `cua-sandbox` (current SDK, repo `main`) | 0.9.0 | MIT | **No.** `provider="winsandbox"` now resolves to `Image.windows()` (`libs/python/agent/cua_agent/computers/sandbox.py`), which is a full Windows Server 2022 VM from `ghcr.io/trycua/windows:2022` under Hyper-V or QEMU (`runtime/compat.py`). It downloads a multi-GB disk image and never touches Windows Sandbox. DeepWiki confirms the pywinsandbox provider "has been removed and replaced". |
| `cua-computer` (legacy) | 0.5.19 | MIT (repo root licence; the wheel metadata has no licence field) | Yes: `computer/providers/winsandbox/provider.py`, built on `pywinsandbox`. |
| `pywinsandbox` | 1.4.0 | MIT | Generates the `.wsb` and runs an RPyC server inside the sandbox. |
| `cua-core` (telemetry) | 0.3.2 | MIT | Pulled in by both of the above. |

Licence note: the Cua repo is MIT by default. Cua Spaces and Cua Driver Bench are FSL-1.1-MIT, but this harness uses neither.

## How the legacy winsandbox provider works (cua-computer 0.5.19 + pywinsandbox 1.4.0)

1. **Start:** `winsandbox.new_sandbox(networking=True, folder_mappers=[...])` writes a `.wsb` file and launches it. `launch.py` calls `verify_sandbox_feature_is_enabled()` (WMI, `Containers-DisposableClientVM`) **at import time**, so on this machine even `import winsandbox` raises an error.
2. **Folder mapping:** pywinsandbox always adds `PythonMapper()` (the host `sys.prefix`) and `PythonUserSitePackagesMapper()` (`%APPDATA%\Python\...`, inside the user profile). On top of that, the Cua provider maps `~/.cua/wsb_cache` read-write, and pywinsandbox maps `%TEMP%\shared_windows_sandbox_dir` read-write. All of these are inside the user profile.
3. **Getting the server inside:** the sandbox runs the host's mapped Python, which starts an **RPyC `ClassicService`** (`target.py`). That is unauthenticated, arbitrary code execution, listening on the sandbox's network IP, and it adds a firewall allow rule. The host then writes `setup_script.ps1` into the guest over RPyC. That script runs `irm https://astral.sh/uv/install.ps1 | iex`, followed by an **unpinned** `uv pip install cua-computer-server` from PyPI. It then starts `computer_server.main`, a websocket server.
4. **Screenshots and input:** handled by `cua-computer-server` inside the guest, over its websocket.
5. **Network:** required. RPyC refuses `networking=False` (`assert config.networking`), and the setup script downloads from the internet. The provider also sleeps 120 s on the first run and waits forever for an IP.
6. **Telemetry:** `cua-core` sends PostHog/OTel telemetry. Turn it off with `CUA_TELEMETRY=0` (`cua_core/telemetry/_config.py`). `CUA_TELEMETRY_DISABLED` is the legacy name and still works, but now logs a deprecation warning. There is also a machine setting that `cua telemetry off` writes.

This breaks three constraints in the brief: it maps folders inside the user profile, it needs the network and installs unpinned code from the internet, and it runs an unauthenticated remote Python shell. The current SDK has no Windows Sandbox path at all.

## What the harness does instead

Cua's own CI uses exactly this pattern (`libs/cua-driver/tests/runners/windows-sandbox/run-tests-in-sandbox.ps1` + `sandbox-runner.ps1`): `.wsb` + mapped folders + `LogonCommand` + polling a file in the output folder.

- **`.wsb`:** `Networking=Disable`. Clipboard, audio, video and printer redirection are off. Memory is 4096 MB. Three mapped folders: `tools/probe/target/release` → `C:\probe` (read-only), `target/release` → `C:\notch` (read-only, only if it exists), `tools/vmtest/out` → `C:\out` (writable). `sandbox.py` refuses the profile root and its parents.
- **Inside the sandbox:** only Windows PowerShell 5.1 runs (`agent.ps1`, the LogonCommand), plus a tiny WinForms test window (`testwin.ps1`). No Python and no downloads. The agent waits for `Shell_TrayWnd`, then polls `C:\out\cmd\*.ps1` and writes `C:\out\res\*.json`.
- **Screenshots:** `System.Drawing` `CopyFromScreen` → `C:\out\shots\*.png`. **Input:** P/Invoke `SetCursorPos`/`mouse_event`/`keybd_event`, plus `SendKeys` for typing. **Measurements:** `SystemParametersInfo(SPI_GETWORKAREA)`, `FindWindow`/`IsWindowVisible("Shell_TrayWnd")`, `GetWindowRect` of a re-maximised test window.
- **VC runtime:** `notch-probe.exe` imports `VCRUNTIME140.dll`. A clean sandbox may not have it, and with the network off nothing can be installed. So `sandbox.py` copies the host's own `C:\Windows\System32\vcruntime140*.dll` into `out\runtime`, and the agent copies them into the guest's System32 only if they are missing.
- **Installed packages (`.venv`):** `pytest==8.4.2` only, for the unit test. The harness itself uses only the Python standard library. Cua was **not** installed, so there is no Cua telemetry to disable.

## Open points

- On Windows 11 24H2+, the new Sandbox app ships a `wsb.exe` CLI (`wsb exec`) that could replace the file queue. I have not verified this, because the feature is off on this machine.
- WebView2 inside the sandbox is unknown until the feature is on. If it is missing, it cannot be installed while networking is disabled. That matters later for `notch.exe`, not for the probe.
