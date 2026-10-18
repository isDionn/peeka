# MIT License (pending owner confirmation)
import builtins
import io
import json
import os
import re
import tempfile
import unittest
from unittest import mock

import notch_client as nc

SCOPES = {"island.protrusion", "card.module", "alerts.post", "approvals.prompt", "composer.handler", "voice.line",
          "lock.signal", "clipboard.read", "search.provider", "media.read", "windows.read", "notifications.post",
          "notifications.read", "files.drop"}
GLYPHS = {"ghost", "terminal", "users", "pointer", "brain", "list", "shield"}  # plugin-api.md 6.2
STATES = {"idle", "info", "attention", "done", "danger", "tired"}  # 6.1
PROTRUSION_KEYS = {"title", "subtitle", "icon", "state", "progress", "timer", "live_text", "transcript", "note",
                   "mascot", "actions"}


class Build(unittest.TestCase):
    def test_hello_is_jsonrpc_with_known_scopes(self):
        m = nc.hello_request()
        self.assertEqual((m["jsonrpc"], m["method"], m["params"]["api"]), ("2.0", "hello", 1))
        self.assertTrue(set(m["params"]["scopes"]) <= {"island.protrusion", "card.module"})

    def test_protrusion_carries_timer_and_no_markup(self):
        m = nc.protrusion_request(2, "t", "2026-10-16T14:32:00Z")
        self.assertEqual(m["params"]["timer"], {"started_at": "2026-10-16T14:32:00Z"})
        self.assertNotIn("html", m["params"])

    def test_cc_event_carries_identifiers_only(self):
        m = nc.cc_event_request(4, "pre_tool", tool="WebSearch")
        self.assertEqual((m["method"], m["params"]), ("cc.event", {"kind": "pre_tool", "tool": "WebSearch"}))
        self.assertEqual(nc.cc_event_request(5, "stop")["params"], {"kind": "stop"})

    def test_methods_and_card_shape_match_contract(self):
        self.assertEqual(nc.protrusion_request(2, "t")["method"], "island.protrusion.set")
        m = nc.card_request(3, "h", "x")
        self.assertEqual(m["method"], "card.module.set")
        tab = m["params"]["tabs"][0]
        self.assertTrue(tab["id"] and tab["title"] and tab["blocks"][0]["type"] == "heading")
        self.assertEqual(m["params"]["summary"][0]["title"], "h")
        self.assertEqual(nc.BAD_TOKEN, -32001)

    def test_encode_is_one_line_and_size_capped(self):
        self.assertEqual(nc.encode(nc.auth_request("x")).count(b"\n"), 1)
        with self.assertRaises(ValueError):
            nc.encode({"x": "a" * nc.MAX_LINE})

    def test_lines_split_and_report_disconnect(self):
        lines = nc.Lines(io.BytesIO(b'{"a":1}\n{"b":2}\n'))
        self.assertEqual((lines.next(), lines.next(), lines.next()), ({"a": 1}, {"b": 2}, None))


class Contract(unittest.TestCase):
    """The messages the example builds, checked against plugin-api.md 3, 6 and 11."""

    def test_manifest_follows_section_3_1(self):
        m = nc.hello_request()["params"]
        self.assertTrue(re.fullmatch(r"[a-z0-9]+(\.[a-z0-9-]+)+", m["id"]) and len(m["id"]) <= 64)
        self.assertEqual(type(m["api"]), int)
        self.assertTrue(set(m["scopes"]) <= SCOPES)
        self.assertTrue(set(m["why"]) <= set(m["scopes"]))  # a reason only for a scope that is asked
        self.assertTrue(all(m[k] for k in ("name", "publisher", "version")))

    def test_auth_carries_the_manifest_id_and_the_token(self):
        m = nc.auth_request("tok", req_id=7)
        self.assertEqual((m["id"], m["method"], m["params"]), (7, "auth", {"id": nc.PLUGIN["id"], "token": "tok"}))

    def test_every_request_is_jsonrpc_2_with_a_numeric_id(self):
        for m in (nc.hello_request(), nc.auth_request("t"), nc.protrusion_request(2, "t"), nc.card_request(3, "h", "x")):
            self.assertEqual(m["jsonrpc"], "2.0")
            self.assertEqual(type(m["id"]), int)

    def test_protrusion_uses_only_section_6_1_fields(self):
        p = nc.protrusion_request(2, "t")["params"]
        self.assertTrue(set(p) <= PROTRUSION_KEYS)
        self.assertIn(p["state"], STATES)
        self.assertNotIn(p["icon"], {"tired", "attention"})  # the main assistant's faces, -32602 from anyone else
        self.assertRegex(p["timer"]["started_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")  # default = UTC "now"

    def test_card_stays_within_section_6_2_limits(self):
        p = nc.card_request(3, "h", "x")["params"]
        self.assertLessEqual(len(p["tabs"]), 3)
        self.assertLessEqual(len(p["summary"]), 3)
        self.assertTrue(all(b["type"] in {"heading", "text"} and set(b) == {"type", "text"} for b in p["tabs"][0]["blocks"]))
        for row in p["summary"]:
            self.assertTrue(row.get("icon", "ghost") in GLYPHS and row.get("state", "idle") in STATES)

    def test_example_messages_fit_one_line(self):
        for m in (nc.hello_request(), nc.protrusion_request(2, "t"), nc.card_request(3, "h", "x")):
            self.assertLess(len(nc.encode(m)), nc.MAX_LINE)


class Wire(unittest.TestCase):
    def test_encode_keeps_unicode_and_is_compact(self):
        self.assertEqual(nc.encode({"a": "éüñ"}), '{"a":"éüñ"}\n'.encode("utf-8"))

    def test_encode_limit_is_the_whole_line(self):
        pad = nc.MAX_LINE - len(nc.encode({"x": ""}))
        self.assertEqual(len(nc.encode({"x": "a" * pad})), nc.MAX_LINE)  # exactly 64 KB passes
        with self.assertRaises(ValueError):
            nc.encode({"x": "a" * (pad + 1)})

    def test_lines_join_a_message_split_across_reads(self):
        class Slow(io.BytesIO):
            def read(self, n=-1):
                return super().read(3)  # three bytes at a time

        lines = nc.Lines(Slow(b'{"a":1}\n{"b":[2]}\n'))
        self.assertEqual((lines.next(), lines.next(), lines.next()), ({"a": 1}, {"b": [2]}, None))

    def test_lines_reject_garbage_and_an_endless_line(self):
        with self.assertRaises(ValueError):  # json.JSONDecodeError is a ValueError
            nc.Lines(io.BytesIO(b"not json\n")).next()
        with self.assertRaises(ValueError):
            nc.Lines(io.BytesIO(b"a" * nc.MAX_IN)).next()

    def test_lines_read_up_to_512_kb_and_refuse_more(self):
        big = b'{"t":"' + b"a" * (256 * 1024) + b'"}\n'  # a 256 KB clip arrives well past the 64 KB send cap
        self.assertEqual(len(nc.Lines(io.BytesIO(big)).next()["t"]), 256 * 1024)
        pad = nc.MAX_IN - len(b'{"t":""}\n')
        edge = b'{"t":"' + b"a" * pad + b'"}\n'
        self.assertEqual(len(edge), nc.MAX_IN)  # exactly 512 KB with its newline passes
        self.assertEqual(len(nc.Lines(io.BytesIO(edge)).next()["t"]), pad)
        with self.assertRaises(ValueError):  # one byte more, newline present
            nc.Lines(io.BytesIO(b'{"t":"' + b"a" * (pad + 1) + b'"}\n')).next()


class Endpoint(unittest.TestCase):
    def read(self, doc):
        with tempfile.TemporaryDirectory() as d:
            if doc is not None:
                with open(os.path.join(d, "endpoint.json"), "w", encoding="utf-8") as f:
                    f.write(doc if isinstance(doc, str) else json.dumps(doc))
            with mock.patch.dict(os.environ, {"NOTCH_DATA_DIR": d}):
                return nc.read_endpoint()

    def test_pipe_is_read_only_for_api_1(self):
        self.assertEqual(self.read({"pipe": "p1", "api_version": 1}), "p1")
        self.assertIsNone(self.read({"pipe": "p1", "api_version": 2}))
        self.assertIsNone(self.read({"pipe": 5, "api_version": 1}))

    def test_notch_not_running_is_none_not_an_error(self):
        self.assertIsNone(self.read(None))  # no file
        self.assertIsNone(self.read("{broken"))


class FakePipe:
    def __init__(self, replies):
        self.inbox, self.sent = b"".join(json.dumps(r).encode() + b"\n" for r in replies), []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n):
        out, self.inbox = self.inbox[:n], self.inbox[n:]
        return out

    def write(self, data):
        self.sent.append(json.loads(data))


def error_reply(code):
    return [{"jsonrpc": "2.0", "id": 1, "error": {"code": code, "message": "x"}}]


class Session(unittest.TestCase):
    """The pairing flow of section 3 against a fake pipe; the token file is a temp file."""

    def run_session(self, replies, token=None):
        pipe = FakePipe(replies)
        real_open = builtins.open
        with tempfile.TemporaryDirectory() as d:
            tok = os.path.join(d, "token")
            if token:
                with open(tok, "w", encoding="utf-8") as f:
                    f.write(token + "\n")

            def fake_open(path, *a, **kw):
                return pipe if path == "PIPE" else real_open(path, *a, **kw)

            with mock.patch.object(nc, "TOKEN_FILE", tok), mock.patch.object(nc, "open", fake_open, create=True), \
                    mock.patch("builtins.print"):
                nc.session("PIPE")
            saved = None
            if os.path.exists(tok):
                with open(tok, encoding="utf-8") as f:
                    saved = f.read()
        return pipe.sent, saved

    def test_first_run_says_hello_stores_the_token_then_sends_both_messages(self):
        sent, saved = self.run_session([{"jsonrpc": "2.0", "id": 1, "result": {"token": "T0", "scopes": []}}])
        self.assertEqual([m["method"] for m in sent], ["hello", "island.protrusion.set", "card.module.set"])
        self.assertEqual((sent[1]["id"], sent[2]["id"], saved), (2, 3, "T0"))

    def test_later_run_authenticates_with_the_saved_token(self):
        sent, saved = self.run_session([{"jsonrpc": "2.0", "id": 1, "result": {"api_version": 1}}], token="T0")
        self.assertEqual(sent[0]["method"], "auth")
        self.assertEqual(sent[0]["params"]["token"], "T0")
        self.assertEqual(saved, "T0\n")  # no new token in the reply: the file is left alone

    def test_only_a_bad_token_clears_the_stored_one(self):
        sent, saved = self.run_session(error_reply(nc.BAD_TOKEN), token="T0")
        self.assertEqual((len(sent), saved), (1, None))  # nothing after the refusal, token gone
        for code in (-32006, -32007):  # owner declined / another approval open: keep the token
            sent, saved = self.run_session(error_reply(code), token="T0")
            self.assertEqual((len(sent), saved), (1, "T0\n"))

    def test_disconnect_before_any_reply_ends_the_session(self):
        sent, saved = self.run_session([])
        self.assertEqual(([m["method"] for m in sent], saved), (["hello"], None))


if __name__ == "__main__":
    unittest.main()
