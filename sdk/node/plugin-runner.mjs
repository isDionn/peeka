// MIT License (pending owner confirmation) - Copyright (c) Peeka authors.
// Shared connection loop for the weather and pomodoro examples: pairing (hello/auth), token file, reconnect.
// Reuses the wire helpers of notch-client.mjs; the plugin only supplies its manifest and what to do once connected.
import { connect } from "node:net";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BAD_TOKEN, encode, lineSplitter, readEndpoint } from "./notch-client.mjs";

/**
 * runPlugin({ manifest, start, onNotification })
 *   start(send) runs once pairing succeeded; send(method, params) writes a request. It may return a stop() function.
 *   onNotification(msg) gets what Peeka sends back (e.g. `action {id, surface}`).
 */
export async function runPlugin({ manifest, start, onNotification = () => {} }) {
  const tokenFile = join(homedir(), `.peeka-${manifest.id}-token`);
  let wait = 5;
  for (;;) {
    const pipe = readEndpoint();
    if (pipe) { await session(pipe); wait = 5; }
    await new Promise((r) => setTimeout(r, wait * 1000));
    wait = Math.min(wait * 2, 60); // 5 s growing to 60 s, as the contract asks
  }

  function session(pipe) {
    return new Promise((resolve) => {
      const sock = connect(pipe);
      sock.setEncoding("utf8");
      const token = existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : null;
      let nextId = 2, greeted = false, stop;
      const send = (method, params) => sock.write(encode({ jsonrpc: "2.0", id: nextId++, method, params }));
      const onMessage = (msg) => {
        if (!greeted) { // first reply: hello waits for the owner (up to 2 minutes)
          greeted = true;
          if (msg.error) {
            if (token && msg.error.code === BAD_TOKEN) rmSync(tokenFile, { force: true });
            console.log("refused:", msg.error); // -32006 declined, -32007 busy (retry later)
            return sock.end();
          }
          if (msg.result?.token) writeFileSync(tokenFile, msg.result.token);
          stop = start(send);
        } else if (msg.method) onNotification(msg);
        else if (msg.error) console.log("rejected:", msg.error.code, msg.error.message); // -32003 scope off, -32005 rate limit
      };
      const split = lineSplitter(onMessage);
      const first = token ? { method: "auth", params: { id: manifest.id, token } } : { method: "hello", params: manifest };
      sock.on("connect", () => sock.write(encode({ jsonrpc: "2.0", id: 1, ...first })));
      sock.on("data", (d) => { try { split(d); } catch (e) { console.log(e.message); sock.destroy(); } });
      sock.on("error", (e) => console.log("pipe error:", e.message));
      sock.on("close", () => { stop?.(); resolve(); }); // Peeka closed: stop timers, back to waiting
    });
  }
}
