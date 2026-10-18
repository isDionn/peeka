# Peeka plugin API (contract, api = 1)

This document is the single source of truth for the Peeka plugin API. The implementation lives in `crates/notch-core/src/plugins/` and `crates/notch-app/src/plugins.rs`. The code name is `notch` (written `<code>` below); the product name does not appear in paths or in the pipe name.

## 1. Transport

- **JSON-RPC 2.0 over a named pipe.** Pipe name: `\\.\pipe\<code>-<user SID>`.
- The pipe is created with a DACL that allows only this user's SID; `NT AUTHORITY\NETWORK` is denied, remote clients are rejected (`reject_remote_clients(true)`), and `first_pipe_instance(true)` guards against name squatting: if the name is already taken, Peeka does not start and tells the user "another program is holding this name".
- Framing: newline-delimited JSON (NDJSON), UTF-8. At most **64 KB** per message; **256 KB** for a `card.module` that carries an image.
- Large attachments (images, screenshots) do not travel over the pipe: Peeka writes the file to `%LOCALAPPDATA%\<code>\share\<random>.png` and gives the plugin only the path. Peeka deletes the file when the plugin sends `share.done {id}`, or after 10 minutes at the latest. No file outside `share\` in the Peeka folder is ever opened to a plugin.
- Honest limit: any program running under the same user account can connect to the pipe. The identity of the connecting process cannot be verified reliably (`GetNamedPipeClientProcessId` can be spoofed). **Identity = the plugin token issued at approval.** The process path is shown in the approval window for information only, labelled "unverified".

## 2. Discovery

While Peeka is running it writes `%LOCALAPPDATA%\<code>\endpoint.json`, and deletes it on exit:

```json
{"pipe": "\\\\.\\pipe\\notch-S-1-5-21-…", "api_version": 1, "pid": 1234}
```

If the file is missing, Peeka is not running; the plugin waits quietly and retries at intervals that grow from 5 s to 60 s.

## 3. Handshake

### 3.1 `hello` (first message, no token)

```json
{"jsonrpc":"2.0","id":1,"method":"hello","params":{
  "id":"com.example.assistant","name":"Sample Assistant","publisher":"Example","version":"1.2.0",
  "api":1,"scopes":["island.protrusion","card.module","composer.handler"],
  "why":{"composer.handler":"To send what you type with Ctrl+Space to this assistant"}}}
```

Validation:
- `id`: reverse-domain form, at most 64 characters.
- `name`, `publisher`: plain text; control characters and bidirectional characters are dropped. `publisher` is not verified and is shown as such.
- `launch` (optional): absolute path of the plugin's program, `X:\...d.exe`. It is opened only when the owner clicks "Launch <name>", and only while the plugin is the main assistant; it is re-validated on every launch. Arguments, quotes, UNC paths (`\\server\...`), wildcards (`*`, `?`) and any extension other than `.exe` are rejected; if the file does not exist the button does nothing (`missing`).
- Unknown scope → the request is rejected. Unknown field → ignored.
- If the name resembles the name of an already paired plugin or a reserved name ("Peeka", "Windows", "System", the main assistant's name), ignoring case and accents, the approval window shows a warning; two plugins cannot get the same-looking name.

A `hello` without a token makes Peeka open its own approval window (§5). If the owner approves, the reply carries a one-time token:

```json
{"jsonrpc":"2.0","id":1,"result":{"token":"<32 bytes, base64>","scopes":["island.protrusion","card.module"],"main_assistant":false}}
```

`scopes` are the scopes the owner actually granted (a subset of what was requested). If the owner denies, or no answer arrives within 2 minutes, an error is returned and the connection closes.

### 3.2 `auth` (later connections)

```json
{"jsonrpc":"2.0","id":1,"method":"auth","params":{"id":"com.example.assistant","token":"<token>"}}
```

- Peeka keeps only the SHA-256 digest of the token, the granted scopes and the approval time in `plugins.json`; the comparison is constant-time.
- Storing the token is the plugin's job (in its own user folder).
- If the plugin asks for a new scope (new version), approval is asked again; the old scopes are kept.

## 4. Scopes

Level: **low** (arrives pre-checked in the approval window), **medium** (pre-checked, on a separate line), **high** (arrives unchecked; the owner checks each one, with a warning text beside it). A "peek" is the small row a plugin shows on the island (the `island.protrusion` scope).

| Scope | Level | What it grants |
|---|---|---|
| `island.protrusion` | low | A peek row in the center of the island (goes through the attention budget, §7) |
| `card.module` | low | Up to 3 tabs on the Modules card and up to 3 summary rows on the "General" page |
| `alerts.post` | low | Short alerts and ongoing activities |
| `notifications.post` | low | Entries in the Notifications list |
| `search.provider` | medium | A result group in Ctrl+K; the plugin sees the typed query |
| `composer.handler` | medium | Receives what is typed in the Ctrl+Space box plus the attachments the owner added, and streams the answer back. Only one owner at a time = the **main assistant** (the owner picks it in Settings) |
| `voice.line` | medium | The state of the line under the strip (idle / listening / speaking / thinking) and the live transcript. Main assistant only. Microphone access is tied to the Windows recording setting, not to this scope |
| `approvals.prompt` | medium | The approval peek and card (§6.3); the answer comes back only through the owner's click |
| `files.drop` | medium | Paths of files dropped on the island, only at the moment of the drop |
| `lock.signal` | medium | Locks Peeka; unlocking depends on the owner's approval inside Peeka |
| `media.read` | medium | Title and artist of the playing track |
| `windows.read` | high | Titles of open windows (the title is `null` for a sensitive app) |
| `clipboard.read` | high | Clipboard history: text, image, file path. **Password-class items are never returned, under any condition** |
| `notifications.read` | high | The Windows notification mirror (only while the mirror is on; otherwise empty) |

**Never granted by any scope:** password-class clipboard items and the DPAPI store, plugin tokens and other plugins' data, keyboard input (the hook is for media keys and shortcuts only; no key goes to a plugin), screenshots (only the owner's one-time share), Peeka's settings and allow list, running commands/files/processes. A plugin cannot make Peeka run anything; Peeka's own actions happen only through the owner's click.

**One-time shares that need no scope** (to the main assistant only, only when the owner clicks): "Ask the assistant" on a clipboard item, "Ask the assistant" on a screen snip, a file on the drop target, the Ctrl+Space chips ("This window" = image + app name, not the title; "Clipboard …"; "N files on the Shelf"; chips appear as suggestions and are attached when clicked), "Add screenshot", "Add file", and "Let the assistant reply" on a Windows notification card (that single notification's app name and text). These buttons do not exist on password-class items or on the window of a sensitive app.

## 5. Approval window (drawn by Peeka)

From the plugin, only `name`, `publisher`, `version`, `id` and `why` are taken, as plain text. Mockup: `yon-3d-son.html`, state `eo`. Contents, top to bottom:

1. Peeka's own icon and "A new plugin wants to connect".
2. An initial-letter tile drawn by Peeka, `name`, `version`, `id`; below it "Publisher: `publisher` · unverified".
3. The connecting program: exe path and signature state (`WinVerifyTrust`: "Signed: <signer>" or "Unsigned"), labelled "unverified".
4. A similar-name warning (orange line): "This name looks like an already connected plugin."
5. The scopes in three groups by level: a checkbox, a plain-language description, and the plugin's `why` text in quotes. Low/medium are pre-checked, high are unchecked. For `composer.handler` and `voice.line` there is an extra unchecked line: "Make main assistant?". On the `approvals.prompt` line: the risk level is what the plugin declares, and Peeka cannot verify it.
6. "No plugin can see your passwords, your keyboard input or Peeka's settings, or run commands on your computer."
7. "This plugin may use its own internet connection; Peeka cannot control that."
8. "Deny" (default focus, Esc), "Allow" (ignores clicks for ~300 ms after opening; Enter is not on the initial focus), and a small "Never ask about this plugin again".
9. If there is no answer within 2 minutes it counts as "Deny". It opens centered below the strip on the main screen; it does not open over a full-screen app, and the plugin waits.

Against floods: only one approval window at a time; at most 3 requests per 10 minutes for the same `id` or process path; "never ask again" writes to the blocklist.

Undo: Settings › Plugins (name, last connection, scopes that can be switched off one by one, the **counts** of scope use over the last 24 hours, "Disconnect", "Remove"). Remove deletes the record and closes the open connection immediately; narrowing a scope restarts the connection.

## 6. Schemas (the plugin sends data, Peeka draws)

A plugin cannot send HTML, CSS or JS; text is always drawn as text.

**Identity rules (in every schema):** Peeka itself puts the plugin's display name in front of every peek, card, approval and tab ("Sample Assistant › …"); `title` or `source` cannot replace this prefix, and `›` and similar separators inside a title are turned into plain characters. The `mascot` field is accepted only from the main assistant; anyone else's is ignored. An icon is only a name from Peeka's Lucide set or a single character; an image icon cannot be sent.

### 6.1 `island.protrusion`

```json
{"title":"…","subtitle":"…","icon":"bell","state":"idle|info|attention|done|danger|tired",
 "progress":0.4,"timer":{"started_at":"2026-10-16T14:32:00Z"},"live_text":{"stream_id":"s1"},
 "transcript":{"stream_id":"v1"},"note":"draft ready",
 "mascot":"listening","actions":[{"id":"a1","label":"Open","style":"default|primary|destructive"}]}
```

`subtitle`, `progress`, `timer`, `live_text`, `transcript`, `note` and `mascot` are optional; `actions` has at most 2 entries. `transcript` (Fidelity 3) opens a two-line live transcript: its shape is like `live_text` (`{stream_id}`), and the text and the speaker (`speaker`) arrive through the `voice.transcript` stream; the page receives `transcript: {streamId: "<plugin id>:<stream_id>"}`. `note` is a faint short note beside the title, at most 40 characters of plain text (a number or object gives `-32602`). Of the `icon` values, `tired` and `attention` (the assistant's faces) are accepted only from the main assistant; anyone else gets `-32602`. Color is not free: only `state` and `style` decide it (primary #0A84FF filled, destructive #FF453A filled). Peeka counts the `timer` itself.

### 6.2 `card.module`

A list of blocks: `heading`, `text` (plain text; no formatting except inline bold and code), `list` (row: title, sub-line, right value, state), `kv`, `progress`, `timer`, `buttons` (style as in 6.1), `image` (only PNG/JPEG `data:`, at most 256 KB, Peeka re-encodes it; not yet in this version, §13). There are no links: a button comes back to the plugin as `action {id}`. A ~300 ms click guard applies to all buttons. Content that asks for approval comes through `approvals.prompt`. At most 3 tabs per plugin; the `summary` on the "General" page has at most 3 rows.

Fidelity 3 additions (all optional; the wrong type gives `-32602`):

- Tab `general: true` → the tab also appears on the "General" page as a box. A tab's `icon` may be, besides Peeka's icons, `ghost`, `terminal`, `users`, `pointer`, `brain`, `list`, `shield`.
- A `summary` row is `{title, subtitle?, value?, icon?, state?, action?}`: `icon` only `ghost|terminal|users|pointer|brain|list|shield`, `state` only `idle|info|attention|done|danger|tired`, `action` a single button `{id, label, style?}` (see 6.1). Pressing this button sends the plugin `action {id, surface: "module"}` (no `tab`).
- The `meter` block (quota bar): `{"type":"meter","label":"5-hour","value":42,"reset_note":"Resets at 14:30","threshold":80}`. `value` and `threshold` are numbers 0..100 (out-of-range values are clamped, a non-number gives `-32602`), `label` ≤ 80 and `reset_note` ≤ 80 characters. The page receives `{type: "meter", label, value: 0..1, note, mark: 0..1 | null}`.
- An **unknown block type** no longer drops the card: only that block is discarded, the card stays, and only the count is written to Peeka's log ("N unknown blocks skipped"; never the content; at most one log line per minute per connection). If the fields of a known type are malformed, the message is still rejected with `-32602`.

### 6.3 `approvals.prompt`

```json
{"id":"ap-123","source":"Claude Code","title":"Wants to run a command",
 "risk":"high","kind":"command","command":"rm -rf build","cwd":"C:\\project",
 "detail":"…","options":["allow","always","deny"],"always_label":"npm test in this folder",
 "choices":null,"free_text":false,"expires_s":300}
```

- `risk`: `low` | `high`. Missing or unrecognized = `high`. When `high`, the peek has no "Allow", only "Details"; "Always allow" is removed by Peeka. The risk is the plugin's declaration; Peeka cannot verify it.
- `kind`: `command` | `file` | `network` | `question` | `plan` | `other`. `command` requires `command` and `cwd` (plain text in a code box); `file` requires `path`.
- `options`: a subset of `allow`, `always`, `deny`; if `always` is present, `always_label` is required.
- `choices`: at most 6 `{id, label, recommended?}`; the option with `recommended: true` is preselected on the card and labelled "recommended" (anything other than true/false gives `-32602`). If `free_text: true` there is a text box (at most 2,000 characters, plain text). For a plugin that is not the main assistant, Peeka sets `freeTextWarning: true` on the approval view; the card then shows above the box "This question is from the <plugin name> plugin; do not type a password here" (the plugin cannot turn this off).
- `short_title`: the short title on the peek, at most 24 characters of plain text (longer is truncated; a non-string gives `-32602`). The page receives it as `shortTitle`.
- `expires_s`: at most 3,600; when it runs out Peeka closes the card and returns `expired` to the plugin.
- Answer (only through the owner's click or typing): `{"id":"ap-123","decision":"allow|always|deny|choice","choice_id":"…","text":"…"}`.
- The accidental-click guard (~300 ms; on a risky command the peek has only "Details") is independent of the plugin and also applies in Modules.

### 6.4 The `composer.handler` flow

- Peeka → plugin: `composer.submit {turn, text, attachments: [{kind: screenshot|file|clip|window_image|rack, path?, text?}]}` (attachments only from one-time shares; images arrive as paths in the share folder; for a small text file `text` arrives next to the path, see §13 "Attachments").
- Plugin → Peeka: `composer.delta {turn, text}` (streaming answer), `composer.chip {turn, label, kind: source|reminder|note}`, `composer.done {turn}`, `composer.error {turn, message}`.
- Peeka draws the bubbles and chips. The "Ask by voice" button appears only if the main assistant also owns `voice.line`.

## 7. Rate limit and attention

- **50 control messages per 10 s** per connection; beyond that the error is `-32005` with `retry_after` (seconds).
- **Stream messages are counted separately** (`composer.delta`, the live transcript of `voice.line`, `live_text`): Peeka draws by merging every 50 ms per stream id; at most 40 stream messages per second are accepted, the excess is merged (not dropped); a stream is cut off at 64 KB total.
- Opening a peek is limited to **at most 6 per minute**; at most 1 plugin peek at a time. Peeka's attention budget (Do Not Disturb, full screen, meeting) takes precedence over plugin priority.
- Plugin priority is **0–69**; 70 and above is only for Peeka's own system alerts and `approvals.prompt`.
- Rejected requests leave at most one log line per minute.

## 8. Logging and privacy

The log records only the plugin id, the method name and the result code; message content, clipboard text, window titles and queries are not written. Peeka makes no network requests apart from the update check (which can be turned off); a plugin's own network use is the plugin's responsibility.

**Peeka's local sources do not go to plugins.** The following become events for Peeka's own pages only; none is forwarded to a plugin, and no plugin can read them:

- **Download finished (`download_done`, privacy surface).** Peeka lists the user's Downloads folder (found through Windows' known-folder API) every few seconds. All it reads is file names and sizes; the contents of no file are opened. A new file is reported as `{id, name, size}` once its size stays the same across two looks (and half-written files such as `.crdownload`, `.part`, `.tmp` are not counted); the path is in no event, the folder path stays in Rust. The setting is `watchDownloads` (on by default, can be turned off in Settings); while it is off the list is not read. While Peeka is locked no notification arrives and `download_open` / `download_show_in_folder` return `denied`. Executable files (`.exe`, `.bat`, `.ps1`, `.lnk` …) are not started by "Open".

## 9. Compatibility: the simple alert HTTP API (off by default)

The paths of the local alert API (`/notify`, `/activity`, `/activity/{id}`, `/status`): `127.0.0.1` only, Host check, every `Origin` rejected, an `X-Notch-Key` key (its file is in Peeka's data folder), 30 requests per 10 s, 4 KB, JSON only. Internally it behaves like a plugin named "Scripts" that has only the `alerts.post` scope.

## 10. Versioning and SDK

- `api` is an integer; within one version, changes are additive only (a new field, a new method). A breaking change = a new `api` number.
- Small client examples for Python and Node are under `sdk/` (MIT).

## 11. Methods

All messages are JSON-RPC 2.0. A request that carries an `id` gets a reply; a notification without an `id` never gets a reply (not even an error). `id` must be a number or a string.

**Plugin → Peeka** (the scope on the left is checked against the current record on every call: when the owner switches the scope off or removes the plugin, it takes effect on the next message):

| Method | Scope | Parameters | Result |
|---|---|---|---|
| `hello` | — | the §3.1 manifest | once approved, `{token, scopes, main_assistant}` |
| `auth` | — | `{id, token}` | `{scopes, main_assistant, api_version}` |
| `ping` | — | — | `{pong: true}` |
| `share.done` | — | `{id}` (32 hex) | `{ok}` |
| `island.protrusion.set` | `island.protrusion` | the §6.1 object | `{ok}`; replaces the same plugin's previous peek |
| `island.protrusion.clear` | `island.protrusion` | — | `{ok}` |
| `live_text.append` | `island.protrusion` | `{stream_id, text, final?}` | stream (§7); `final: true` ends the stream |
| `card.module.set` | `card.module` | `{tabs: [{id, title, icon?, general?, blocks}], summary?: [text or {title, subtitle?, value?, icon?, state?, action?}]}` | `{ok}`; replaces the previous one; an unknown block is discarded on its own (§6.2) |
| `card.module.clear` | `card.module` | — | `{ok}` |
| `alerts.post` | `alerts.post` | the `/notify` body from §9 + `id` required + `notify?` (default `true`; `false` = an ongoing job) | `{ok}`; rejected if `action` and `color` are sent |
| `alerts.remove` | `alerts.post` | `{id}` | `{ok}` |
| `approvals.prompt` | `approvals.prompt` | the §6.3 object | `{ok}`; the decision comes later as an `approvals.decision` notification |
| `approvals.cancel` | `approvals.prompt` | `{id}` | `{ok}` (e.g. the job was answered in the terminal) |
| `composer.delta` | `composer.handler`, main assistant only | `{turn, text}` | stream (§7) |
| `composer.chip` / `composer.done` / `composer.error` | same | §6.4 | `{ok}`; `done`/`error` close the turn, flushing any pending text first |
| `voice.line` | `voice.line`, main assistant only | `{state: idle\|listening\|speaking\|thinking}` | `{ok}` |
| `voice.transcript` | same | `{stream_id, text, final?, speaker?}` | stream (§7) |
| `lock.signal` | `lock.signal` | `{locked: true}` | `{ok}`; `false` is rejected (the owner unlocks) |
| `clipboard.read` | `clipboard.read` | — | `{items: [{kind, text?, path?}]}` (Peeka's clipboard history, newest first; `kind` is `text` / `image` / `file`; images have no path); password-class items and the `password` field are never returned. While Peeka is locked: `{items: [], locked: true}` |
| `search.results` | `search.provider` | `{request, group?, items: [{id, title, subtitle?}]}` (at most 8 rows; `group` ≤ 40 characters, e.g. "Notes") | `{ok}`; the answer to an old `request` is quietly dropped (`{ok: false}`). Peeka waits ~250 ms after the query; a late answer misses that search |
| `media.read`, `windows.read`, `notifications.post`, `notifications.read` | the scope in the name | — | the scope is checked, then `-32601` "resource not available yet" |
| `assistant.counts.set` | `card.module`, main assistant only | `{jobs, memory, approvals?}` (zero or positive integers, clamped at 9,999; 0 if `approvals` is absent) | `{ok}`; the job, note and "Waiting for approval" counts on the status card (Fidelity 3) |
| `calendar.set` | `card.module`, main assistant only | `{detail?, next: [{time, title, source?, start?, link?}]}` (at most 5 rows; `time` ≤ 16, `title` ≤ 120, `source` ≤ 40 characters, plain text; `start` is an ISO time + offset, the reminder counts from it; `link` is accepted only as https on teams.microsoft.com, zoom.us or meet.google.com, anything else is dropped) | `{ok}`; the detail and upcoming items of the meeting card |
| `claude.bridge.set` | `card.module`, main assistant only | `{installed, healthy, last_event_ago_s?}` | `{ok}`; the "Claude Code bridge" row in Settings. Peeka ages the seconds itself; Peeka never reads Claude Code's files |
| `cc.sessions.set` | `card.module`, main assistant only | `{sessions: [{id, pid}]}` (at most 32; `id` is the Claude Code session id: letters, digits, `-`, `_`, ≤ 128; `pid` is the id of the session's `claude` process, an integer greater than 4) | `{ok}`; replaces the previous list. "Open terminal" uses only a pid from this list: Peeka walks up the process tree from that pid and brings the first ancestor that owns a window (Windows Terminal, VS Code, conhost…) to the front. The main assistant must resend the list on every session change (a finished session's pid may be given to another process) |
| `cc.event` | `island.protrusion`, main assistant only | `{kind, tool?, reason?, sid?}`; `sid` (optional): a session tag, exactly 8 lowercase hex characters (anything else gives `-32602`); a salted digest of the Claude Code session id, not the id itself. In the "2 sessions" chip the page tells the sessions apart as "Session 1", "Session 2" by their last tools; a `sid` with no events for 30 minutes drops off the list, `session_end` removes it immediately; `kind`: `session_start`, `session_end`, `prompt`, `pre_tool`, `post_tool`, `tool_failed`, `notification`, `permission`, `stop`, `stop_failure`, `subagent_start`, `subagent_stop` (Claude Code hook events; any other value gives `-32602`). `tool` is the tool name, `reason` is the error or notification class (`rate_limit`, `permission_prompt`, `elicitation_dialog`, `idle_prompt`…): letters, digits and `_ . : -` only, at most 64 characters; free text, commands, paths and prompts are never sent | `{ok}`; `cc_event` goes to the page. While the mascot is calm: `prompt`/tool = thinking, `pre_tool` search tools (WebSearch, WebFetch, Grep, Glob, anything with `search` in the name) = searching, `AskUserQuestion` and `elicitation_dialog` = question, `permission` and `permission_prompt` = approval, `tool_failed` and `stop_failure` = error, `stop_failure` + `rate_limit` = quota full, `stop` = done (calm after 5 s), `session_end` = calm. If the hook goes silent the state drops after 2 minutes. The main assistant's own approval, job and error always stay in front. Without a main assistant, Peeka also receives the same events through its own hook (§13 "Claude Code bridge"); if the main assistant sent `cc.event` in the last 2 minutes, Peeka's own hook is ignored |
| `assistant.offline` | `island.protrusion`, main assistant only | `{on}` | `{ok}`; when it changes the page receives `assistant_offline`; becomes `false` when the connection drops |
| `meeting.set` | `island.protrusion`, main assistant only | `{active}` (bool; any other type gives `-32602`) | `{ok}`; when it changes the page receives `meeting_changed`; while a meeting is on, the attention budget is silent (§0i: alerts other than approvals and a plugin peek do not open a candidate, they only wait in the list and the count; the mascot does not play pranks); becomes `false` when the connection drops, when another plugin becomes the main assistant, or when the owner switches off the `island.protrusion` scope |
| `job.done` | `island.protrusion`, main assistant only | `{title, took?, seconds?}` (≤ 120 / ≤ 40 characters; `seconds` is zero or a positive number, may be fractional, Peeka rounds down; for the page's 2-minute rule) | `{ok}`; if the owner left "Celebrate when a job finishes" on, the page receives `job_done` (the mascot jumps; the page counts at most 3 per hour) |
| `shelf.suggestion` | `files.drop`, main assistant only | `{request, text?}` (≤ 300 characters; no `text` = no suggestion) | `{ok}`; only for an open `shelf.suggest` request; an old or second answer is dropped with `{ok: false}`. Peeka waits 3 s |

**Peeka → plugin** (notifications, no reply expected):

| Method | When | Parameters |
|---|---|---|
| `composer.submit` | the owner sent the Ctrl+Space box (to the main assistant only) | `{turn, text, attachments: [{kind, path, text?}\|{kind: "clip", text}]}` |
| `approvals.decision` | the owner decided or the time ran out | `{id, decision: allow\|always\|deny\|choice\|expired, choice_id?, text?}` |
| `action` | the owner pressed one of the plugin's buttons | `{id, surface: protrusion\|module, tab?}` |
| `voice.request` | the owner pressed "Ask by voice" in the Ctrl+Space box (if the main assistant also owns `voice.line`) | `{}` |
| `search.query` | the owner typed into Ctrl+K (to every connected plugin with the `search.provider` scope on; never sent while Peeka is locked, and a `search.results` that arrives then is dropped) | `{request, query}` |
| `search.open` | the owner opened one of that plugin's search rows | `{id}` |
| `assistant.open` | the owner pressed "Open" on the status card (to the main assistant only) | `{kind: approval\|jobs\|memory}` |
| `shelf.suggest` | the Shelf card is showing a file; only if the main assistant owns `files.drop` (otherwise never sent) | `{request, path}` (`path` = the copy in the share folder, see below) |
| `shelf.memory` | the owner pressed "Add to Notes" on a Shelf suggestion (a one-time share) | `{path}` (same) |

**Shelf file path (Fidelity 3):** `shelf.suggest`, `shelf.memory`, "Ask the assistant" on the Shelf card (`shelf_ask`, the `rack` attachment) and the `shelf` attachment of Ctrl+Space do not send the path of the original file on the Shelf, but the path of the copy Peeka made of it in the one-time share folder (`%LOCALAPPDATA%\<code>\share\<32 hex>.<ext>`; the main assistant's read rule should open only this folder). The copy is deleted after 10 minutes at the latest (or by `share.done {id}`). Nothing is copied, and nothing goes to the plugin, for a folder, a file larger than 50 MB, or a password-class file: a file whose name looks like a password/key file (`.kdbx`, `.pem`, `id_rsa`, `.env`, `credentials`, bank names…; the Clipboard's window-title pattern), or a text file that contains a secret pattern (API key, IBAN, card number…). In that case the page gets `denied` (password) or `invalid` (folder, size). If even one of the Shelf files cannot be copied, that message is not sent at all. The copy is made only if the message will actually be sent: first it checks that the main assistant is connected (and, for `shelf.suggest`, that it also owns `files.drop`); otherwise nothing is copied (the page gets `not_connected`, and `shelf.suggest` is silently not asked).

## 12. Error codes

| Code | Meaning | Connection |
|---|---|---|
| `-32700` | not JSON | stays open |
| `-32600` | not a JSON-RPC 2.0 request; or `hello`/`auth` again while already connected | open |
| `-32601` | no such method / resource not available yet | open |
| `-32602` | invalid parameter: unknown scope, a reserved name or someone else's name, an HTML/link/icon field, a schema error (`message` says which field) | closes on `hello`, open afterwards |
| `-32001` | a message before `hello`/`auth`, wrong token, removed plugin | closes |
| `-32003` | scope not granted or switched off by the owner | open |
| `-32004` | message over 64 KB (except `card.module.set`) | open; a line over 256 KB closes the connection |
| `-32005` | rate limit, `data.retry_after` (seconds); a pairing flood (3 per 10 min for the same id or exe, 6 for all plugins) also uses this code | closes on pairing, open afterwards |
| `-32006` | the owner denied, 2 min ran out, or it is on the "never ask again" list | closes |
| `-32007` | another approval window is open / this connection's approval is pending, `data.retry_after` 30; or at most 20 pending approvals / 20 alerts | closes on `hello` |
| `-32008` | something only the main assistant can do | open |

## 13. Clarifications

- **Pipe:** the DACL SDDL is `D:P(D;;GA;;;NU)(A;;GA;;;<user SID>)`: protected (no inheritance), NETWORK denied first, the only allow is this user. At most 16 connections at once. If 256 lines pile up unread by a plugin, its connection is cut.
- **One plugin per connection:** if the same plugin does `auth` a second time, the old connection closes.
- **`hello` again with the same `id`** (if the token was lost): a new approval window opens, the old scopes arrive checked; "Allow" invalidates the old token. The name is always re-checked.
- **Name rules:** a name that is the same as another plugin's name or as a reserved name ("Peeka", "Notch", "Windows", "System", "Microsoft", the main assistant's name), ignoring case, accents and spacing, is rejected at `hello` (no window opens); so is a name that **begins** with "Notch", "Peeka" or the main assistant's name ("Sample Assistant Pro", "Peeka Security", "Sample Assistant - Claude Code"). Separators in the name and publisher (`›`, `»`, `>`, `<`, `/`, `|`, `‣`, `→` and similar) become `-`, and tags are removed: a plugin cannot imitate Peeka's "<name> › <title>" line. This rule applies at pairing (`hello`); an earlier paired record's name stays as it is until it pairs again. Only a **similar** name (twin Cyrillic/Greek letters, a digit for a letter, `rn`/`m`, a 1-letter difference for a short name, 2 for a long one) raises a warning in the window. The look-alike letter table is a small hand-made table, not Unicode's full list.
- **Attachments and Claude Code (what the main assistant must do):** the main assistant's read rule opens only the `share\` subfolder, but Claude Code's own permission rules keep the whole Peeka folder closed. So if the main assistant gives the model a `file`/`rack` attachment only as a path, the model **cannot read** that file. That is why Peeka also sends a small text copy as `text`. The main assistant: (1) uses `text` if present; (2) otherwise reads the file itself (checking that it is inside the share folder) and gives the model the content if it is small text, or the image as an image attachment; for a large or binary file it says "could not be read" instead of dropping it silently; (3) if a `clip` attachment also has a `path` (text over 32 KB), `text` is only the head and the full text is at the path; (4) releases every share it used with `share.done {id}`.
- **"Never ask again"** writes the id to the blocklist; that id gets `-32006` without a window. In Settings › Plugins, "Remove" also takes it off the blocklist.
- **Approval time:** 2 minutes, counted from the moment the window page **first showed** the request; the ~300 ms guard too. If the window could not open at all (full screen), the plugin waits at most 10 minutes, then `-32006`.
- **The main assistant** is solely the owner's choice (the mark in the approval window or Settings); `hello` cannot ask for it. Being the main assistant requires an active `composer.handler`; there is one main assistant, and when a new one is chosen the old one's open turns close.
- **Default checkboxes:** if the owner clicks "Allow" without touching the boxes, high-level scopes are not granted. If no scope is checked, "Allow" counts as "Deny".
- **Identity prefix:** Peeka puts a `plugin: {id, name, main}` field on every item from its own record (a `plugin` field in the payload is ignored); the page draws "`name` › `title`". In `title` and `source`, `›` `‹` `»` `«` `❯` `❮` `⟩` `⟨` `〉` `〈` become plain `-` and `<tag>`s are dropped (except `command`, `cwd`, `path` in a code box: there `echo <x>` is real).
- **Forbidden fields:** if `html`, `href`, `url`, `link`, `links`, `src`, `svg`, `css`, `script`, `iframe`, `icon_url`, `iconUrl`, `image_url`, `imageUrl` appears at any depth, the message is rejected with `-32602`. `icon` is only a Peeka icon name (including `ticket` and `video`) or a single character; any other value (`https://…`, `data:…`, `<svg>`) gets the message rejected.
- **Mascot states:** `drowsy`, `listening`, `speaking`, `thinking`, `happy`, `tired`, `surprised`, `attention`. A `mascot` field from a non-main assistant is not rejected, it is quietly dropped; an unrecognized state is also dropped. **Face icons:** `tired` and `attention` can also be used as an `icon` (the page draws them with the assistant's face), but only on the main assistant's peek and on an `alerts.post` alert; from any other plugin, `-32602`. The HTTP alert gate (§9) accepts these names not at all (the icon is dropped).
- **`card.module` limits:** at most 40 blocks per tab, `list`/`kv` at most 50 rows, `buttons` at most 4 buttons. A `list` row is `{title, subtitle?, value?, state?, session?}` (a summary row also takes `session?`: the Claude Code session id, same rule as `cc.sessions.set`; the page adds "Open terminal" to that row), a `kv` row is `{key, value}`, `image` is `{data}`, `timer` is `{started_at, label?}`. An image is only a PNG/JPEG `data:` URL, at most 256 KB once decoded, and its file signature (magic bytes) must be correct. **In this version Peeka does not re-encode the image** (the imaging library was left for a later version).
- **`approvals.prompt`:** without `options` it is `["allow", "deny"]`. `expires_s` defaults to 300, minimum 10, maximum 3,600 (overflow is clamped). At high risk Peeka drops `always` and `always_label`. At most 20 pending approvals per plugin. An approval enters Peeka's alert list with priority 90 as the "approval" kind: it overrides Do Not Disturb, lowers the strip for 4 s on a full-screen app, does not lower it in an exclusive full-screen DirectX game, and only waits in the count (Wave 2's attention budget). The owner cannot decide from the peek (at high risk), "Always" can be chosen only from the card; "Deny" is always valid.
- **Button guard:** the ~300 ms on peek and Modules buttons counts from the moment the item **last changed** (if the plugin changed what is under the button, the first click is ignored).
- **`alerts.post`:** a plugin alert has no link (`action`) and no free color (`color`); Peeka puts a "`name` › " prefix on the title, priority is clamped to 0–69, at most 20 ids per plugin. When the plugin's connection drops or it is removed, its alerts, peek, card and approvals go away.
- **Streams:** `composer.delta`, `voice.transcript` and `live_text.append` do not enter the control counter; more than 40 per second are not rejected either, they are merged into the same 50 ms chunk. After 64 KB total per stream the rest is dropped and the page gets `truncated: true` once. In streamed text, spaces and line breaks are kept and `<…>` is not dropped (the answer may be code; the page draws it as text). The stream id on the page is `"<plugin id>:<stream_id>"`.
- **`composer.submit` attachments:** a path must be a full Windows path (`C:\…` or `\\…`), at most 10 attachments, and the only attachment with text and no path is `clip` (at most 256 KB). A long clipboard text (over 256 KB) goes as `clip` with both the `path` of the full text and its first ~256 KB in `text`, with the note "[Text cut at 256 KB; the whole text is in the attached file.]". If a `file`/`rack` copy in the share folder is UTF-8 text under 256 KB (with no NUL and no secret pattern), `text` arrives next to the path; the total of these inline copies in one message is at most 256 KB; a `composer.submit` line (Peeka to plugin) can be at most 512 KB, and if it is exceeded the inline copies are dropped and the paths stay. The plugin's reader must accept lines up to 512 KB in this direction (the 64 KB limit from plugin to Peeka is unchanged). A clipboard image (screenshot or not) goes with the `screenshot` kind. The page sends only the attachment's kind, never the path; Rust resolves it (Fidelity 3): `screen_image` = the full-size image of the topmost app window, taken with the owner's scan button (Peeka's own windows are skipped; if that window is a sensitive app, i.e. its exe is in the Clipboard's password-manager/Windows-security list or its title matches the Clipboard's sensitive-title pattern (bank, password manager…), no image is taken, `denied` is returned and Peeka shows the "This window is a sensitive app…" notification; it does not fall through to the window beneath), `file` = a copy of the file the owner picked in the Open dialog (both live in the share folder; not taken while locked; the file is at most 50 MB), `clipboard_link` = the newest link on the clipboard (`clip` text, never password-class), `shelf` = copies of all the files on the Shelf in the share folder (`rack`; see "Shelf file path" above). The kinds that go to the plugin are unchanged: `screenshot`, `file`, `clip`, `rack`. The "This window" image (`window_image`) does not exist in this version: `not_yet` is returned.
- **Usage counts:** in memory, a 24-hour window aware of time zones; reset when Peeka reopens. No content is ever kept.
- **The main assistant's data (Fidelity 3):** `assistant.*`, `calendar.set`, `meeting.set`, `claude.bridge.set`, `job.done`, `shelf.suggestion` are accepted only from the main assistant (anyone else gets `-32008`), and the scope is checked on every call. Peeka keeps the last value in memory; with no main assistant the page gets `not_connected`, and if it has not sent anything yet, `not_yet`. When the connection drops or the plugin is removed, all of it is deleted.
- **`alerts.post` `open`:** a plugin alert cannot carry a link, but it can ask for a single fixed Peeka action by name: `"open": "task_manager"` (the button "Open in Task Manager", with the label set by Peeka; when the owner presses it Peeka launches `System32\Taskmgr.exe` by its full path with no arguments). Any other value gives `-32602`.
- **First connection and permission history:** the first time a plugin connects as the main assistant (once in a lifetime) the page receives `first_connect`; `first_connect_ack` silences it. The approval window, the scope buttons in Settings and "Remove" write every scope change to the permission log in `plugins.json` (time, the plugin's name, the scope name, granted/released; at most 100 lines; never a token or digest).
- **Claude Code bridge (works without a main assistant too):** "Install" in Settings (`claude_bridge_install`) adds Peeka's hook for twelve events to Claude Code's user settings (`CLAUDE_CONFIG_DIR\settings.json`, otherwise `%USERPROFILE%\.claude\settings.json`): `{"type":"command","command":"<path of peeka.exe>","args":["--cc-hook"],"async":true,"timeout":5}`. The file is merged, not overwritten: first a backup `settings.json.bak-peeka`, then a temporary file + rename; the owner's and other tools' own hooks, `env`, `statusLine` and the key order stay as they were; a second "Install" changes nothing (an old Peeka entry is replaced by the new one). If it is not JSON, or `hooks` / an event list has an unexpected type, the file is not touched and the reason appears as a notification. "Remove" (`claude_bridge_remove`) deletes only entries whose `args` contain `--cc-hook`. The hook process (`peeka.exe --cc-hook`, which runs before Tauri starts) reads from the hook JSON on stdin only the event name, the tool name, and the `StopFailure` `error` / `Notification` `notification_type` field; it writes a `{kind, tool, reason, sid}` line to the `\\.\pipe\notch-cc-<SID>` pipe (same DACL as the plugin pipe: only this user, network denied; no handshake, no reply). If the tool name or reason contains anything other than letters, digits, `_ . : -`, or exceeds 64 characters, `null` is sent; prompts, commands, file paths, working folders and output never pass over the pipe. The session id does not pass either: only `sid` is sent, which is the first 8 hex characters of `HMAC-SHA256(salt, session_id)`. The salt is 32 random bytes specific to this installation (`cc-salt.bin` in Peeka's data folder; created by the process running the hook on the first event); the salt never leaves the machine, so the tag only tells sessions apart on this desk and the id cannot be recovered from it. If the salt cannot be read or written, the event goes without `sid` (the chip only counts, as before). Peeka re-validates the line by the same rule as `cc.event` and sends `cc_event` to the page. The hook never makes Claude Code wait: it is `async`, writes nothing to stdout (on PermissionRequest Claude Code's own question remains), exits immediately if Peeka is closed or the pipe is busy, closes itself within 2 seconds at the latest, and the exit code is 0 on every path. No double reaction: if the main assistant sent `cc.event` in the last 2 minutes, Peeka ignores the lines on its own pipe (the main assistant already relays the same events through its own hook; if it goes silent or disconnects, Peeka's takes over again). `claude_bridge_state` gives the main assistant's report; if there is no main assistant or it has not reported, Peeka's own: `installed` = the entries exist, `healthy` = the entries point to this exe (if Peeka is moved or updated, "Install" again), `lastEventAgoS` = the last valid line on the pipe. Other tools' hooks are separate; all of them sit side by side in the same file.
- **`lock.signal`:** locks Peeka. The lock is held for three reasons: the Windows lock, the owner's "Lock", and a plugin. When the Windows lock is released only its own reason is lifted; the owner removes the "Lock" and `lock.signal` locks in Peeka (`lock_release`). The lock state appears as `lock_changed` and as `locked` in `plugin_surfaces_changed`. While locked, none of the owner's content goes to a plugin: the Ctrl+Space send (including queued screenshots), Ctrl+K "Ask the assistant", the Shelf (ask, Add to Notes, suggestion), Clipboard sharing, scan, attach, the share window and the mirror return `denied`. While locked, nothing typed in Ctrl+K is sent as `search.query` (Peeka's own results still work) and `clipboard.read` returns an empty list (`{items: [], locked: true}`).

## 14. UI contract (Rust ↔ page; names and shapes are in `ui/src/plugin-api.ts`)

Commands: `plugin_surfaces`, `plugin_action {pluginId, actionId}`, `approval_answer {pluginId, id, decision, choiceId?, text?, surface?}`, `composer_submit {text, attachments}` → `{turn}`, `composer_voice`, `consent_get` → `ConsentRequest | null`, `consent_answer {requestId, allow, scopes, mainAssistant, never}`, `plugin_list`, `plugin_set_scope {id, scope, on}`, `plugin_set_main {id | null}`, `plugin_disconnect {id}`, `plugin_remove {id}`, `modules_get`, `modules_set {order, off}`; Fidelity 3: `assistant_counts` → `{jobs, memory, approvals}`, `assistant_open {kind}`, `calendar_next`, `claude_bridge_state` / `_install` / `_remove`, `cc_focus_terminal {sessionId}` ("Open terminal": the page sends only the row's `session` id, never a pid; an id the main assistant did not report with `cc.sessions.set` gives `unknown`, no main assistant gives `not_connected`, no window-owning ancestor (classic console, session ended) gives `missing`, and if Windows refuses focus, `refused`), `permission_history`, `first_connect_get`, `first_connect_ack`, `shelf_suggest {id}`, `shelf_memory {id}`, `assistant_start` (needs no main assistant; opens the `launch` path if the plugin's manifest has one). Events: `plugin_surfaces_changed` (`SurfacesView`), `plugins_changed` (null), `plugin_stream` (`{streamId, text, truncated, done}`), `composer_event`, `consent_changed` (null), `first_connect` (null), `job_done` (`{title, took, seconds}`; `seconds` may be null), `assistant_offline` (bool), `meeting_changed` (bool), `cc_event` (`{kind, tool, reason}`).

**Demo mode (`notch --demo`):** Peeka writes nothing to disk: settings, pins and the clipboard stay in memory (the clipboard holds text only; images and passwords are not taken), the pipe is not opened, `endpoint.json` and `plugins.json` are not written, nothing is copied to the share folder, the taskbar is not hidden, and there is no guard and no Windows startup registration. The main assistant is a fake one inside Peeka: two Claude Code sessions (rows with a `session` field), one pending approval and status counts; everything sent to it is dropped. A fake music player appears to be playing. `get_settings` returns `demo: true` (the page shows a "Demo" badge); the following return `unsupported`: `taskbar_set_mode`, `media_control`, `mirror_enable`, `cc_focus_terminal`, and attachments that require a copy into the share folder (`composer_scan`, `composer_attach_file`, Shelf: `shelf_ask`, `shelf_memory`, the Ctrl+Space `shelf` attachment; the fake assistant has no `files.drop`, so `shelf_suggest` is never asked); `set_settings` does not turn on the alert API. The mode is not toggled while running: to leave it, start Peeka normally.

New error strings: `ignored` (the 300 ms guard; the prompt stays open), `not_connected` (no main assistant connected: "Assistant not connected"). The approval window is labelled `consent` and uses `consent.html`; its capability file is `capabilities/consent.json` (events only).
