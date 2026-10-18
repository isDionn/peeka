# MIT License (pending owner confirmation) - Copyright (c) Peeka authors.
"""Minimal Peeka plugin client (api = 1). Windows named pipe, NDJSON JSON-RPC 2.0, standard library only.

Run: python notch_client.py   (needs Peeka running; first run asks the owner to approve in Peeka)
"""
import json
import os
import time
from datetime import datetime, timezone

PLUGIN = {"id": "com.example.hello", "name": "Hello Plugin", "publisher": "Example", "version": "0.1.0",
          "api": 1, "scopes": ["island.protrusion", "card.module"],
          "why": {"island.protrusion": "Show a small timer in the island",
                  "card.module": "Show one tab in the modules card"}}
TOKEN_FILE = os.path.join(os.path.expanduser("~"), ".peeka-hello-plugin-token")
MAX_LINE = 64 * 1024  # spec: 64 KB per message (card.module.set: 256 KB)
MAX_IN = 512 * 1024  # Peeka -> plugin: a line may be up to 512 KB (composer.submit carries a 256 KB clip); plugin -> Peeka stays MAX_LINE
BAD_TOKEN = -32001  # plugin-api.md section 12: wrong token / removed plugin; the only error that clears the stored token


def endpoint_path():
    base = os.environ.get("NOTCH_DATA_DIR") or os.path.join(os.environ.get("LOCALAPPDATA", ""), "notch")
    return os.path.join(base, "endpoint.json")


def read_endpoint():
    """Pipe name from endpoint.json, or None when Peeka is not running."""
    try:
        with open(endpoint_path(), encoding="utf-8") as f:
            ep = json.load(f)
    except (OSError, ValueError):
        return None
    return ep["pipe"] if ep.get("api_version") == 1 and isinstance(ep.get("pipe"), str) else None


def request(req_id, method, params):
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}


def hello_request(req_id=1):
    return request(req_id, "hello", PLUGIN)


def auth_request(token, req_id=1):
    return request(req_id, "auth", {"id": PLUGIN["id"], "token": token})


def protrusion_request(req_id, title, started_at=None):
    """The island row. Plain text only: no HTML, icons (Lucide names only) or links."""
    started_at = started_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return request(req_id, "island.protrusion.set",
                   {"title": title, "icon": "timer", "state": "info", "timer": {"started_at": started_at}})


def card_request(req_id, heading, text):
    return request(req_id, "card.module.set",
                   {"tabs": [{"id": "hello", "title": "Hello",
                              "blocks": [{"type": "heading", "text": heading}, {"type": "text", "text": text}]}],
                    "summary": [{"title": heading, "value": "ok"}]})


def cc_event_request(req_id, kind, tool=None, reason=None):
    """One Claude Code hook event for the mascot (main assistant only, scope island.protrusion). Identifiers only, never free text."""
    params = {"kind": kind}
    if tool:
        params["tool"] = tool
    if reason:
        params["reason"] = reason
    return request(req_id, "cc.event", params)


def encode(msg):
    line = json.dumps(msg, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(line) > MAX_LINE:
        raise ValueError("message over 64 KB")
    return line


class Lines:
    """Splits a byte stream into NDJSON lines; returns None at disconnect."""

    def __init__(self, stream):
        self.stream, self.buf = stream, b""

    def next(self):
        while b"\n" not in self.buf:
            if len(self.buf) >= MAX_IN:  # no newline within 512 KB: the line (with its newline) is over the cap
                raise ValueError("line too long")
            chunk = self.stream.read(4096)
            if not chunk:
                return None
            self.buf += chunk
        line, self.buf = self.buf.split(b"\n", 1)
        if len(line) + 1 > MAX_IN:
            raise ValueError("line too long")
        return json.loads(line.decode("utf-8"))


def session(pipe):
    with open(pipe, "r+b", buffering=0) as stream:
        lines = Lines(stream)
        token = open(TOKEN_FILE, encoding="utf-8").read().strip() if os.path.exists(TOKEN_FILE) else None
        stream.write(encode(auth_request(token) if token else hello_request()))
        reply = lines.next()  # hello waits for the owner (up to 2 minutes)
        if reply is None or "error" in reply:
            err = (reply or {}).get("error") or {}
            if token and err.get("code") == BAD_TOKEN:
                os.remove(TOKEN_FILE)  # revoked or reset: next round asks again with hello
            print("refused:", err)  # -32006 owner said no / timed out, -32007 busy (retry_after), -32602 bad manifest
            return
        if "token" in (reply.get("result") or {}):
            with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                f.write(reply["result"]["token"])
        stream.write(encode(protrusion_request(2, "Hello from Python")))
        stream.write(encode(card_request(3, "Hello", "A plain-text card from the SDK example.")))
        while (msg := lines.next()) is not None:
            # notifications from Peeka: action {id, surface, tab?}, approvals.decision, composer.submit, voice.request;
            # replies to ids 2 and 3 are {result: {ok: true}} or {error: {code, message}} (-32003 scope off, -32005 rate limit)
            print("<-", msg)


def main():
    wait = 5
    while True:
        pipe = read_endpoint()
        try:
            if pipe:
                session(pipe)
                wait = 5
        except OSError as e:
            print("pipe error:", e)  # Peeka closed: back to waiting
        time.sleep(wait)
        wait = min(wait * 2, 60)  # 5 s growing to 60 s, as the spec asks


if __name__ == "__main__":
    main()
