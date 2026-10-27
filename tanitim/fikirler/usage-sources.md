# Local usage sources

This feature reads only local, non-secret session/status data. It does not read OAuth or credential files and it does not call provider APIs.

## Claude Code

Claude Code documents a `statusLine` command which receives JSON including `rate_limits.five_hour` and `rate_limits.seven_day`: `used_percentage` and `resets_at`. Peeka must only attach a statusline collector through its existing opt-in bridge preview/install/remove flow. If a user already has a statusline, Peeka must chain it and restore it on removal; this work does not install or replace it yet.

Official reference: <https://code.claude.com/docs/en/statusline>.

## Codex CLI

Codex rollout histories are local at `%USERPROFILE%\\.codex\\sessions\\**\\*.jsonl`. `event_msg` / `token_count` entries can contain `payload.rate_limits.primary` and `secondary`, with `used_percent`, `window_minutes`, and either `resets_at` (Unix seconds) or legacy `resets_in_seconds`. The reader takes the last usable snapshot from the newest file and never reads `%USERPROFILE%\\.codex\\auth.json`.

Source evidence: [Codex rate-limit protocol tests](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/rate_limits.rs) (Apache-2.0) and the [local rollout discussion](https://github.com/openai/codex/discussions/56932). Window duration identifies the label: 300 minutes is five-hour and 10080 minutes is weekly.

## Antigravity / Gemini

Google documents Antigravity's local configuration/artifact directory (`~/.gemini/antigravity-ide/`), but no documented local quota snapshot with used percentage and reset time. Its documented APIs require credentials/network access, which violates this feature's privacy rule. Gemini is intentionally omitted until Google supplies a safe local source.

Official reference: <https://antigravity.google/docs/settings?tab=ide>.
