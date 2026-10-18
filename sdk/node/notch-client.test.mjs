// MIT License (pending owner confirmation)
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BAD_TOKEN, PLUGIN, authRequest, cardRequest, encode, endpointPath, helloRequest, lineSplitter, MAX_IN, MAX_LINE, protrusionRequest, readEndpoint } from "./notch-client.mjs";

test("hello is JSON-RPC 2.0 with api 1", () => {
  const m = helloRequest();
  assert.deepEqual([m.jsonrpc, m.method, m.params.api], ["2.0", "hello", 1]);
  assert.equal(authRequest("t").params.token, "t");
});

test("protrusion carries the timer, no markup fields", () => {
  const m = protrusionRequest(2, "t", "2026-10-16T14:32:00Z");
  assert.deepEqual(m.params.timer, { started_at: "2026-10-16T14:32:00Z" });
  assert.equal("html" in m.params, false);
  assert.equal(cardRequest(3, "h", "x").params.tabs[0].blocks[0].type, "heading");
});

test("methods and card shape match the contract", () => {
  assert.equal(protrusionRequest(2, "t").method, "island.protrusion.set");
  const m = cardRequest(3, "h", "x");
  assert.equal(m.method, "card.module.set");
  const tab = m.params.tabs[0];
  assert.deepEqual([typeof tab.id, typeof tab.title, tab.blocks[0].type], ["string", "string", "heading"]);
  assert.equal(m.params.summary[0].title, "h");
  assert.equal(BAD_TOKEN, -32001);
});

test("encode is one NDJSON line and capped at 64 KB", () => {
  assert.equal(encode(authRequest("x")).toString().split("\n").length, 2);
  assert.throws(() => encode({ x: "a".repeat(MAX_LINE) }));
});

test("splitter joins chunks into whole messages", () => {
  const got = [];
  const feed = lineSplitter((m) => got.push(m));
  feed('{"a":1}\n{"b"');
  feed(":2}\n");
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
});

// --- contract checks against eklenti-api.md 3, 6, 11 (same cases as the Python SDK) ---------------------------------
const SCOPES = new Set(["island.protrusion", "card.module", "alerts.post", "approvals.prompt", "composer.handler", "voice.line",
  "lock.signal", "clipboard.read", "search.provider", "media.read", "windows.read", "notifications.post", "notifications.read", "files.drop"]);
const GLYPHS = new Set(["ghost", "terminal", "users", "pointer", "brain", "list", "shield"]);
const STATES = new Set(["idle", "info", "attention", "done", "danger", "tired"]);
const PROTRUSION_KEYS = new Set(["title", "subtitle", "icon", "state", "progress", "timer", "live_text", "transcript", "note", "mascot", "actions"]);

test("manifest follows section 3.1", () => {
  const m = helloRequest().params;
  assert.match(m.id, /^[a-z0-9]+(\.[a-z0-9-]+)+$/);
  assert.ok(m.id.length <= 64 && Number.isInteger(m.api));
  assert.ok(m.scopes.every((s) => SCOPES.has(s)));
  assert.ok(Object.keys(m.why).every((s) => m.scopes.includes(s))); // a reason only for a scope that is asked
  assert.ok(["name", "publisher", "version"].every((k) => m[k]));
});

test("auth carries the manifest id and the token", () => {
  const m = authRequest("tok", 7);
  assert.deepEqual([m.id, m.method, m.params], [7, "auth", { id: PLUGIN.id, token: "tok" }]);
});

test("every request is JSON-RPC 2.0 with a numeric id", () => {
  for (const m of [helloRequest(), authRequest("t"), protrusionRequest(2, "t"), cardRequest(3, "h", "x")]) {
    assert.deepEqual([m.jsonrpc, typeof m.id], ["2.0", "number"]);
  }
});

test("protrusion uses only section 6.1 fields", () => {
  const p = protrusionRequest(2, "t").params;
  assert.ok(Object.keys(p).every((k) => PROTRUSION_KEYS.has(k)));
  assert.ok(STATES.has(p.state));
  assert.ok(!["yorgun", "dikkat"].includes(p.icon)); // the main assistant's faces: -32602 from anyone else
  assert.match(p.timer.started_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/); // default = UTC "now", no milliseconds
});

test("card stays within section 6.2 limits", () => {
  const p = cardRequest(3, "h", "x").params;
  assert.ok(p.tabs.length <= 3 && p.summary.length <= 3);
  assert.ok(p.tabs[0].blocks.every((b) => ["heading", "text"].includes(b.type) && Object.keys(b).length === 2));
  assert.ok(p.summary.every((r) => GLYPHS.has(r.icon ?? "ghost") && STATES.has(r.state ?? "idle")));
});

test("encode keeps unicode, and the 64 KB limit is the whole line", () => {
  assert.equal(encode({ a: "şğü" }).toString("utf8"), '{"a":"şğü"}\n');
  const pad = MAX_LINE - encode({ x: "" }).length;
  assert.equal(encode({ x: "a".repeat(pad) }).length, MAX_LINE); // exactly 64 KB passes
  assert.throws(() => encode({ x: "a".repeat(pad + 1) }));
});

test("splitter skips blank lines, rejects garbage and an endless line", () => {
  const got = [];
  const feed = lineSplitter((m) => got.push(m));
  feed('\n{"a":1}\n\n');
  assert.deepEqual(got, [{ a: 1 }]);
  assert.throws(() => feed("not json\n"));
  assert.throws(() => lineSplitter(() => {})("a".repeat(MAX_IN)), /too long/);
});

test("splitter takes a line up to 512 KB (a 256 KB clip) and refuses one byte more", () => {
  const got = [];
  lineSplitter((m) => got.push(m))(JSON.stringify({ t: "a".repeat(256 * 1024) }) + "\n");
  assert.equal(got[0].t.length, 256 * 1024);
  const pad = MAX_IN - Buffer.byteLength(JSON.stringify({ t: "" }) + "\n");
  lineSplitter((m) => got.push(m))(JSON.stringify({ t: "a".repeat(pad) }) + "\n"); // exactly 512 KB with its newline
  assert.equal(got[1].t.length, pad);
  assert.throws(() => lineSplitter(() => {})(JSON.stringify({ t: "a".repeat(pad + 1) }) + "\n"), /too long/);
});

test("endpoint is read only for api 1, and a missing or broken file means Peeka is not running", () => {
  const dir = mkdtempSync(join(tmpdir(), "notch-sdk-"));
  try {
    const path = join(dir, "endpoint.json");
    assert.equal(endpointPath({ NOTCH_DATA_DIR: dir }), path);
    assert.equal(readEndpoint(path), null); // no file
    writeFileSync(path, "{broken");
    assert.equal(readEndpoint(path), null);
    writeFileSync(path, JSON.stringify({ pipe: "p1", api_version: 2 }));
    assert.equal(readEndpoint(path), null);
    writeFileSync(path, JSON.stringify({ pipe: 5, api_version: 1 }));
    assert.equal(readEndpoint(path), null);
    writeFileSync(path, JSON.stringify({ pipe: "p1", api_version: 1 }));
    assert.equal(readEndpoint(path), "p1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
