# vmtest: Peeka inside Windows Sandbox

Runs `notch-probe.exe` tests in a throwaway Windows Sandbox with no network, so the real taskbar is never touched. The reasons for not using Cua are in `RESEARCH.md`.

## Once

1. Enable Windows Sandbox (the owner does this): *Windows Features › Windows Sandbox*, then restart. `C:\Windows\System32\WindowsSandbox.exe` must exist afterwards.
2. `cd notch\tools\vmtest; uv venv .venv --python 3.12; uv pip install --python .venv\Scripts\python.exe pytest==8.4.2`
3. Build the probe: `notch\tools\probe\target\release\notch-probe.exe`.

## Run

- Unit check, no sandbox needed: `.venv\Scripts\python -m pytest -q -p no:cacheprovider`
- Smoke run (start, ready, one screenshot, WebView2 check, shutdown): `.venv\Scripts\python sandbox.py`
- Probe tests 1, 2a, 2b, 3, 4, 6, 7: `.venv\Scripts\python trial.py`. Add `--keep` to leave the sandbox open afterwards. One full run takes about 6–8 minutes.

Results go to `out/results.md` (summary table) and `out/results.json` (all measurements). Screenshots go to `out/shots/`, the probe's own log to `out/probe.log`, and the probe's stdout to `out/probe-*.txt`.

## What gets mapped

| Host | Sandbox | Mode |
|---|---|---|
| `tools/probe/target/release` | `C:\probe` | read-only |
| `target/release` (if present) | `C:\notch` | read-only |
| `tools/vmtest/out` | `C:\out` | writable |

Nothing else is mapped. `sandbox.py` refuses the profile root and its parents. Networking, clipboard, audio, video and printer redirection are all disabled.

## Using it from code

```python
from sandbox import Sandbox
sb = Sandbox(); sb.start(); sb.wait_ready()
sb.screenshot("x"); sb.click(100, 200); sb.type("hi"); sb.key("win+a")
print(sb.run("Get-Process | Select -First 3 | Out-String")); print(sb.measure())
sb.shutdown()
```

## Notes

- Only one Windows Sandbox can run at a time. `start()` refuses if one is already running.
- `trial.py` checks things a script can measure: work area, maximised rect, taskbar visibility, click-through and focus. Tests 5 and 8–12 still need a human on the real machine (second monitor, radios, games, volume keys, screen share, Spotify).
- In test 4 the probe creates its own fake `Shell_TrayWnd`, so the taskbar visibility value read during that test is not meaningful.
