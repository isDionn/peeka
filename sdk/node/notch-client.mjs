// MIT License (pending owner confirmation) - Copyright (c) Peeka authors.
// Minimal Peeka plugin client (api = 1). Windows named pipe, NDJSON JSON-RPC 2.0, no dependencies.
// Run: node notch-client.mjs   (needs Peeka running; first run asks the owner to approve in Peeka)
import { connect } from "node:net";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN = {
  id: "com.example.hello", name: "Hello Plugin", publisher: "Example", version: "0.1.0", api: 1,
  scopes: ["island.protrusion", "card.module"],
  why: { "island.protrusion": "Show a small timer in the island", "card.module": "Show one tab in the modules card" },
};
const TOKEN_FILE = join(homedir(), ".peeka-hello-plugin-token");
export const MAX_LINE = 64 * 1024; // spec: 64 KB per message (card.module.set: 256 KB)
export const MAX_IN = 512 * 1024; // Peeka -> plugin: a line may be up to 512 KB (composer.submit carries a 256 KB clip); plugin -> Peeka stays MAX_LINE
export const BAD_TOKEN = -32001; // plugin-api.md section 12: wrong token / removed plugin; the only error that clears the stored token

export function endpointPath(env = process.env) {
  return join(env.NOTCH_DATA_DIR || join(env.LOCALAPPDATA || "", "notch"), "endpoint.json");
}

/** Pipe name from endpoint.json, or null when Peeka is not running. */
export function readEndpoint(path = endpointPath()) {
  try {
    const ep = JSON.parse(readFileSync(path, "utf8"));
    return ep.api_version === 1 && typeof ep.pipe === "string" ? ep.pipe : null;
  } catch { return null; }
}

const request = (id, method, params) => ({ jsonrpc: "2.0", id, method, params });
export const helloRequest = (id = 1) => request(id, "hello", PLUGIN);
export const authRequest = (token, id = 1) => request(id, "auth", { id: PLUGIN.id, token });
/** The island row. Plain text only: no HTML, icons (Lucide names only) or links. */
export const protrusionRequest = (id, title, startedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z")) =>
  request(id, "island.protrusion.set", { title, icon: "timer", state: "info", timer: { started_at: startedAt } });
export const cardRequest = (id, heading, text) =>
  request(id, "card.module.set", { tabs: [{ id: "hello", title: "Hello", blocks: [{ type: "heading", text: heading }, { type: "text", text }] }], summary: [{ title: heading, value: "ok" }] });

export function encode(msg) {
  const line = Buffer.from(JSON.stringify(msg) + "\n", "utf8");
  if (line.length > MAX_LINE) throw new Error("message over 64 KB");
  return line;
}

/** Feed text chunks, get complete NDJSON messages back. */
export function lineSplitter(onMessage) {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (Buffer.byteLength(line) + 1 > MAX_IN) throw new Error("line too long");
      if (line.trim()) onMessage(JSON.parse(line));
    }
    if (buf.length >= MAX_IN) throw new Error("line too long"); // chars <= bytes: already over the cap with no newline yet
  };
}

function session(pipe) {
  return new Promise((resolve) => {
    const sock = connect(pipe);
    sock.setEncoding("utf8");
    const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : null;
    let greeted = false;
    const onMessage = (msg) => {
      if (!greeted) { // first reply: hello waits for the owner (up to 2 minutes)
        greeted = true;
        if (msg.error) {
          if (token && msg.error.code === BAD_TOKEN) rmSync(TOKEN_FILE, { force: true }); // revoked or reset: next round asks again with hello
          console.log("refused:", msg.error); // -32006 owner said no / timed out, -32007 busy (retry_after), -32602 bad manifest
          return sock.end();
        }
        if (msg.result?.token) writeFileSync(TOKEN_FILE, msg.result.token);
        sock.write(encode(protrusionRequest(2, "Hello from Node")));
        sock.write(encode(cardRequest(3, "Hello", "A plain-text card from the SDK example.")));
        return;
      }
      // notifications from Peeka: action {id, surface, tab?}, approvals.decision, composer.submit, voice.request;
      // replies to ids 2 and 3 are {result: {ok: true}} or {error: {code, message}} (-32003 scope off, -32005 rate limit)
      console.log("<-", msg);
    };
    const split = lineSplitter(onMessage);
    sock.on("connect", () => sock.write(encode(token ? authRequest(token) : helloRequest())));
    sock.on("data", (d) => { try { split(d); } catch (e) { console.log(e.message); sock.destroy(); } });
    sock.on("error", (e) => console.log("pipe error:", e.message));
    sock.on("close", resolve); // Peeka closed: back to waiting
  });
}

async function main() {
  let wait = 5;
  for (;;) {
    const pipe = readEndpoint();
    if (pipe) { await session(pipe); wait = 5; }
    await new Promise((r) => setTimeout(r, wait * 1000));
    wait = Math.min(wait * 2, 60); // 5 s growing to 60 s, as the spec asks
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
