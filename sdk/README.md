# Peeka plugin SDK examples

Tiny, dependency-free examples for the Peeka plugin API (`api = 1`, contract: `../docs/plugin-api.md`).

| Example | Language | What it is | Scopes |
|---|---|---|---|
| `python/notch_client.py` | Python | Minimal client: pairing, one island row, one card | `island.protrusion`, `card.module` |
| `node/notch-client.mjs` | Node | The same minimal client in Node | `island.protrusion`, `card.module` |
| `node/weather.mjs` | Node | Current weather on the modules card (uses the network) | `card.module` |
| `node/pomodoro.mjs` | Node | Focus timer on the island with end-of-phase alerts | `island.protrusion`, `alerts.post` |

Tests: `python -m unittest` inside `python/`, `node --test` inside `node/` (no Peeka, no network needed).

The minimal clients read `%LOCALAPPDATA%\notch\endpoint.json` (or `NOTCH_DATA_DIR`), connect to the named pipe, authenticate, send one `island.protrusion.set` (with a timer Peeka counts itself) and one `card.module.set`, and reconnect (5 s growing to 60 s) after a disconnect. Peeka not running just means waiting. `weather.mjs` and `pomodoro.mjs` share that connection loop in `node/plugin-runner.mjs`. Each plugin keeps its own token file in your home folder (`.peeka-<plugin id>-token`).

## Weather (`node/weather.mjs`)

Shows the current temperature and condition (from [Open-Meteo](https://open-meteo.com), no API key) as a card tab and a summary row, refreshed every 15 minutes.

```
set WEATHER_LAT=41.01
set WEATHER_LON=28.98
set WEATHER_UNITS=metric
node weather.mjs
```

`WEATHER_UNITS` is `metric` (default, Celsius) or `imperial` (Fahrenheit). Latitude and longitude default to 41.01 / 28.98; set your own.

- **Permissions:** `card.module` (low level). Nothing else.
- **Network:** this plugin makes its own HTTPS requests to `api.open-meteo.com`, and your coordinates are part of each request. Peeka itself makes no network request for it and cannot control or inspect it; the approval window says the same about every plugin.
- On any network or parse error it stays silent and keeps the last card; it tries again at the next refresh.

## Pomodoro (`node/pomodoro.mjs`)

A focus timer: 25 minutes of work, then a 5 minute break, repeating. The island row shows the phase and minutes left with a progress bar and the live elapsed timer. Two island buttons: Pause/Resume and Skip. When a phase ends, Peeka shows an alert.

```
set POMODORO_WORK_MIN=25
set POMODORO_BREAK_MIN=5
node pomodoro.mjs
```

- **Permissions:** `island.protrusion` and `alerts.post`, both low level. No network, no files.
- **API gap:** the contract's `timer` only counts up from `started_at`; there is no countdown. The example re-sends the row once a minute with the minutes left in the title, uses `progress` for the bar and keeps the elapsed `timer` alongside. A true ticking countdown would need a contract addition.
- The clock lives in the plugin. If Peeka is closed, the timer keeps running and the island row comes back when Peeka reconnects.

## Pairing and consent

1. First run: the plugin sends `hello` with its id, name, publisher, version and the scopes it wants (each with a short `why`).
2. Peeka draws its own approval window. The owner ticks the scopes to grant, or declines. No answer in 2 minutes means declined.
3. On approval the reply carries a one-time token. The plugin stores it (the examples use a file in your home folder). Peeka keeps only its SHA-256.
4. Later runs send `auth` with that token. Asking for a new scope later means a new approval.

The token is the plugin's identity; the process path shown in the approval window is informational only. The owner can disconnect or remove a plugin in Peeka settings at any time.

## What plugins cannot do

Plugins send data, Peeka draws it. No HTML, CSS or JS; no custom icons (Peeka's icon names or a single character only); no links (buttons come back to you as `action {id}`); no free colors (only `state` and button `style`). Peeka prefixes every title with the plugin's name. Messages you send are limited to 64 KB and rate-limited; lines Peeka sends you (a `composer.submit` with a clipped text) may be up to 512 KB.

The examples match contract v1 (`../docs/plugin-api.md` sections 11 and 12: `hello`/`auth`, `island.protrusion.set`, `card.module.set` with `tabs` and `summary`, `alerts.post`, the notifications Peeka sends back, error codes); not yet tested against a live pipe. The new examples were exercised against a fake pipe only. Only `-32001` (bad token) clears the stored token; `-32006` means the owner declined and `-32007` means another approval is open, so wait and retry.

Licence: the examples are MIT.
