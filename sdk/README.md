# Peeka plugin SDK examples

Two tiny, dependency-free clients for the Peeka plugin API (`api = 1`, contract: `../docs/eklenti-api.md`):

- `python/notch_client.py` (test: `python -m unittest` inside `python/`)
- `node/notch-client.mjs` (test: `node --test` inside `node/`)

Each one reads `%LOCALAPPDATA%\notch\endpoint.json` (or `NOTCH_DATA_DIR`), connects to the named pipe, authenticates, sends one `island.protrusion.set` (with a timer Peeka counts itself) and one `card.module.set`, and reconnects (5 s growing to 60 s) after a disconnect. Peeka not running just means waiting.

## Pairing and consent

1. First run: the plugin sends `hello` with its id, name, publisher, version and the scopes it wants (each with a short `why`).
2. Peeka draws its own approval window. The owner ticks the scopes to grant, or declines. No answer in 2 minutes means declined.
3. On approval the reply carries a one-time token. The plugin stores it (the examples use a file in your home folder). Peeka keeps only its SHA-256.
4. Later runs send `auth` with that token. Asking for a new scope later means a new approval.

The token is the plugin's identity; the process path shown in the approval window is informational only. The owner can disconnect or remove a plugin in Peeka settings at any time.

## What plugins cannot do

Plugins send data, Peeka draws it. No HTML, CSS or JS; no custom icons (Lucide icon names only); no links (buttons come back to you as `action {id}`); no free colors (only `state` and button `style`). Peeka prefixes every title with the plugin's name. Messages you send are limited to 64 KB and rate-limited; lines Peeka sends you (a `composer.submit` with a clipped text) may be up to 512 KB.

The examples match contract v1 (`../docs/eklenti-api.md` 11 and 12: `hello`/`auth`, `island.protrusion.set`, `card.module.set` with `tabs` and `summary`, the notifications Peeka sends back, error codes); not yet tested against a live pipe. Only `-32001` (bad token) clears the stored token; `-32006` means the owner declined and `-32007` means another approval is open, so wait and retry.

Licence: the examples are MIT.
