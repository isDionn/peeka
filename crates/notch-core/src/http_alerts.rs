//! The simple alert HTTP adapter, so scripts can show a build's progress without the plugin pipe.
//! OFF by default; the owner switches it on in Notch's settings. Inside it is a plugin named "Betikler" with
//! `alerts.post` only: priority 0-69, it can add, update and remove its OWN items and read them back, nothing else.
//!
//!
//! Routes and JSON keep the shape of that project's local API so its scripts work with one added header.
//! The security floor:
//! * `127.0.0.1` only, and `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding); any `Origin`
//!   is refused (a web page cannot post here; scripts send none);
//! * every route, `GET /status` too, needs the per-install key (`X-Notch-Key` or `Authorization: Bearer`) from
//!   `<data>/keys/alerts-api.key`;
//! * 30 requests per 10 s, counted BEFORE the key check (guessing is throttled too); body <= 4 KB; JSON only;
//! * no command, file or prompt anywhere: an `action` is a checked http(s) link opened only on the owner's click.
//!
//! shortcut: one connection at a time, 2 s timeout per read; a slow local client sending a byte now and then can
//! stall other scripts until its 8 KB head is used up. Upgrade to a thread per connection (or a deadline) if real
//! scripts ever queue up.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};

use crate::alerts::{parse, AlertList};

/// README's port; off by default.
pub const PORT: u16 = 5199;
pub const MAX_BODY: usize = 4096;
const MAX_HEAD: usize = 8192;
pub const RATE_WINDOW_MS: u64 = 10_000;
pub const RATE_MAX: usize = 30;
pub const KEY_FILE: &str = "alerts-api.key";
const SOURCE: &str = "api";

pub fn key_path(data_dir: &Path) -> PathBuf {
    data_dir.join("keys").join(KEY_FILE)
}

/// The install's key (64 hex chars from the OS random source); made on first use. Only a MISSING file starts a new
/// key (deleting it rotates the key); a file that cannot be read (antivirus lock) is an error, never a silent swap.
pub fn ensure_key(path: &Path) -> std::io::Result<String> {
    match std::fs::read_to_string(path) {
        Ok(k) if k.trim().len() >= 32 => return Ok(k.trim().to_string()),
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("key.tmp");
    std::fs::write(&tmp, format!("{key}\n"))?;
    std::fs::rename(&tmp, path)?;
    Ok(key)
}

#[derive(Clone, Debug, Default)]
pub struct Request {
    pub method: String,
    pub path: String,
    /// Names lower-cased.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    /// Content-Length said more than `MAX_BODY`; the body was not read.
    pub too_large: bool,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub body: Value,
    pub retry_after: Option<u64>,
}

impl Response {
    fn new(status: u16, body: Value) -> Self {
        Self { status, body, retry_after: None }
    }

    fn error(status: u16, text: &str) -> Self {
        Self::new(status, json!({ "error": text }))
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let reason = match self.status {
            200 => "OK",
            401 => "Unauthorized",
            403 => "Forbidden",
            404 => "Not Found",
            409 => "Conflict",
            413 => "Payload Too Large",
            415 => "Unsupported Media Type",
            422 => "Unprocessable Entity",
            429 => "Too Many Requests",
            431 => "Request Header Fields Too Large",
            _ => "Bad Request",
        };
        let body = self.body.to_string();
        let retry = self.retry_after.map(|s| format!("Retry-After: {s}\r\n")).unwrap_or_default();
        format!(
            "HTTP/1.1 {} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{retry}\
             X-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
            self.status,
            body.len()
        )
        .into_bytes()
    }
}

/// Length-independent of where the first difference is (the key is fixed-length; its length is no secret).
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Default)]
pub struct Adapter {
    hits: VecDeque<u64>,
    logged_at: Option<u64>,
}

impl Adapter {
    fn limited(&mut self, now: u64) -> Option<u64> {
        while self.hits.front().is_some_and(|t| now.saturating_sub(*t) >= RATE_WINDOW_MS) {
            self.hits.pop_front();
        }
        if self.hits.len() >= RATE_MAX {
            let wait = self.hits.front().map_or(1, |t| (RATE_WINDOW_MS - now.saturating_sub(*t)).div_ceil(1000));
            return Some(wait.max(1));
        }
        self.hits.push_back(now);
        None
    }

    /// At most one log line a minute: a flood must not fill the log. Never logs the request itself.
    fn deny(&mut self, r: Response, why: &str, now: u64) -> (Response, bool) {
        if self.logged_at.is_none_or(|t| now.saturating_sub(t) > 60_000) {
            self.logged_at = Some(now);
            eprintln!("[notch] alert gate rejected a request: {why}");
        }
        (r, false)
    }

    /// One request -> (response, the list changed). `port` = the port actually bound; `key` = the install's key.
    pub fn handle(&mut self, req: &Request, port: u16, key: &str, list: &mut AlertList, now: u64) -> (Response, bool) {
        if let Some(wait) = self.limited(now) {
            let r = Response { retry_after: Some(wait), ..Response::error(429, "too many requests") };
            return self.deny(r, "rate limit", now);
        }
        let host = req.header("host").unwrap_or_default().to_ascii_lowercase();
        if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
            return self.deny(Response::error(403, "127.0.0.1 only"), "Host", now);
        }
        if req.header("origin").is_some() {
            return self.deny(Response::error(403, "requests from a browser are not accepted"), "Origin", now);
        }
        let sent = req
            .header("x-notch-key")
            .or_else(|| req.header("authorization").and_then(|a| a.strip_prefix("Bearer ")))
            .unwrap_or_default();
        if !same(sent.trim().as_bytes(), key.as_bytes()) {
            return self.deny(Response::error(401, "anahtar gerekli (X-Notch-Key)"), "anahtar", now);
        }
        let path = req.path.split('?').next().unwrap_or_default();
        let activity_id = path.strip_prefix("/activity/").filter(|id| !id.is_empty());
        match (req.method.as_str(), path) {
            ("GET", "/status") => {
                list.prune(now);
                let mine: Vec<Value> = list
                    .sorted()
                    .into_iter()
                    .filter(|a| a.source == SOURCE)
                    .map(|a| {
                        json!({"id": a.id, "title": a.title, "subtitle": a.subtitle, "icon": a.icon,
                               "progress": a.progress, "priority": a.priority, "source": a.source})
                    })
                    .collect();
                (Response::new(200, json!({"version": env!("CARGO_PKG_VERSION"), "activities": mine})), false)
            }
            ("DELETE", _) if activity_id.is_some() => {
                let id = activity_id.unwrap_or_default();
                // A script removes only its own items, never Notch's (a Bluetooth or battery alert).
                if list.get(id).is_some_and(|a| a.source == SOURCE) && list.remove(id) {
                    (Response::new(200, json!({ "removed": id })), true)
                } else {
                    (Response::error(404, "not found"), false)
                }
            }
            ("POST", "/notify" | "/activity") => self.post(req, path == "/notify", list, now),
            _ => (Response::error(404, "not found"), false),
        }
    }

    fn post(&mut self, req: &Request, notify: bool, list: &mut AlertList, now: u64) -> (Response, bool) {
        let ctype = req.header("content-type").unwrap_or_default();
        if !ctype.split(';').next().unwrap_or_default().trim().eq_ignore_ascii_case("application/json") {
            return (Response::error(415, "application/json only"), false);
        }
        if req.too_large || req.body.len() > MAX_BODY {
            return (Response::error(413, "body is 4 KB at most"), false);
        }
        let Ok(body) = serde_json::from_slice::<Value>(&req.body) else {
            return (Response::error(422, "invalid JSON"), false);
        };
        let id = list.new_id();
        let (alert, ignored) = match parse(&body, notify, now, id) {
            Ok(x) => x,
            Err(e) => return (Response::error(422, e.0), false),
        };
        if list.get(&alert.id).is_some_and(|a| a.source != SOURCE) {
            return (Response::error(409, "this id belongs to Peeka"), false);
        }
        let id = alert.id.clone();
        if !list.put(alert, now) {
            return (Response::error(409, "list full (50 at most)"), false);
        }
        let mut out = json!({ "id": id });
        if !ignored.is_empty() {
            out["ignored"] = json!(ignored);
        }
        (Response::new(200, out), true)
    }
}

/// Reads one request: the head (at most 8 KB), then the body if Content-Length is within `MAX_BODY`.
/// Err = answer this and close (malformed head, header too big); Ok(None) = the peer gave up.
pub fn read_request(stream: &mut impl Read) -> Result<Option<Request>, Response> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Ok(None),
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
        let mut headers = [httparse::EMPTY_HEADER; 32];
        let mut parsed = httparse::Request::new(&mut headers);
        match parsed.parse(&buf) {
            Ok(httparse::Status::Complete(head_len)) => {
                let mut req = Request {
                    method: parsed.method.unwrap_or_default().to_string(),
                    path: parsed.path.unwrap_or_default().to_string(),
                    headers: parsed
                        .headers
                        .iter()
                        .map(|h| (h.name.to_ascii_lowercase(), String::from_utf8_lossy(h.value).into_owned()))
                        .collect(),
                    ..Request::default()
                };
                let len: usize = match req.header("content-length").map(|v| v.trim().parse()) {
                    None => 0,
                    Some(Ok(n)) => n,
                    Some(Err(_)) => return Err(Response::error(400, "Content-Length")),
                };
                if len > MAX_BODY {
                    req.too_large = true;
                    return Ok(Some(req));
                }
                let mut body = buf[head_len..].to_vec();
                while body.len() < len {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => return Ok(None),
                        Ok(n) => body.extend_from_slice(&chunk[..n]),
                    }
                }
                body.truncate(len);
                req.body = body;
                return Ok(Some(req));
            }
            Ok(httparse::Status::Partial) if buf.len() <= MAX_HEAD => {}
            Ok(httparse::Status::Partial) => return Err(Response::error(431, "header too large")),
            Err(_) => return Err(Response::error(400, "invalid request")),
        }
    }
}

/// Accept loop on a listener bound to 127.0.0.1 (the caller binds). Ends when `stop` is set and one more
/// connection arrives (the caller connects once to wake it).
pub fn serve(listener: &TcpListener, stop: &AtomicBool, mut handle: impl FnMut(&Request) -> Response) {
    for stream in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(mut stream) = stream else { continue };
        let _ = answer(&mut stream, &mut handle);
    }
}

fn answer(stream: &mut TcpStream, handle: &mut impl FnMut(&Request) -> Response) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let response = match read_request(stream) {
        Ok(Some(req)) => handle(&req),
        Ok(None) => return Ok(()),
        Err(r) => r,
    };
    stream.write_all(&response.to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alerts::Alert;
    use crate::test_util::Tmp;

    const KEY: &str = "k0123456789abcdef0123456789abcdef";

    fn req(method: &str, path: &str, body: &str, extra: &[(&str, &str)]) -> Request {
        let mut headers = vec![
            ("host".to_string(), format!("127.0.0.1:{PORT}")),
            ("content-type".to_string(), "application/json".to_string()),
            ("x-notch-key".to_string(), KEY.to_string()),
        ];
        for (k, v) in extra {
            headers.retain(|(h, _)| h != k);
            if !v.is_empty() {
                headers.push((k.to_string(), v.to_string()));
            }
        }
        Request { method: method.into(), path: path.into(), headers, body: body.as_bytes().to_vec(), too_large: false }
    }

    fn run(a: &mut Adapter, l: &mut AlertList, r: &Request) -> (u16, Value) {
        let (res, _) = a.handle(r, PORT, KEY, l, 1_000);
        (res.status, res.body)
    }

    #[test]
    fn no_key_no_entry_not_even_for_status() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        assert_eq!(run(&mut a, &mut l, &req("GET", "/status", "", &[("x-notch-key", "")])).0, 401);
        assert_eq!(
            run(&mut a, &mut l, &req("POST", "/notify", r#"{"title":"x"}"#, &[("x-notch-key", "wrong")])).0,
            401
        );
        let short = &KEY[..KEY.len() - 1];
        assert_eq!(run(&mut a, &mut l, &req("GET", "/status", "", &[("x-notch-key", short)])).0, 401);
        let bearer = format!("Bearer {KEY}");
        let r = req("GET", "/status", "", &[("x-notch-key", ""), ("authorization", &bearer)]);
        assert_eq!(run(&mut a, &mut l, &r).0, 200);
        assert!(l.sorted().is_empty());
    }

    #[test]
    fn the_readme_flow_with_the_key() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        let (code, body) = run(
            &mut a,
            &mut l,
            &req("POST", "/notify", r##"{"title":"Deploy done","icon":"check","color":"#30D158"}"##, &[]),
        );
        assert_eq!(code, 200);
        assert!(body["id"].is_string() && body.get("ignored").is_none());
        let (_, body) =
            run(&mut a, &mut l, &req("POST", "/activity", r#"{"id":"build","title":"Build","progress":0.2}"#, &[]));
        assert_eq!(body, json!({"id": "build"}));
        run(
            &mut a,
            &mut l,
            &req("POST", "/activity", r#"{"id":"build","title":"Build","progress":0.7,"priority":95}"#, &[]),
        );
        let (_, status) = run(&mut a, &mut l, &req("GET", "/status", "", &[]));
        let acts = status["activities"].as_array().unwrap();
        let build = acts.iter().find(|x| x["id"] == "build").unwrap();
        assert_eq!((build["progress"].as_f64(), build["priority"].as_u64()), (Some(0.7), Some(69)));
        assert!(build.get("action").is_none());
        assert_eq!(acts.len(), 2);
        assert_eq!(run(&mut a, &mut l, &req("DELETE", "/activity/build", "", &[])), (200, json!({"removed": "build"})));
        assert_eq!(run(&mut a, &mut l, &req("DELETE", "/activity/build", "", &[])).0, 404);
    }

    #[test]
    fn a_script_cannot_touch_or_read_notchs_own_alerts() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        l.put_system(Alert::system("system.battery", "power", "Battery low".into(), 80, 1_000, 60_000), 1_000);
        assert_eq!(run(&mut a, &mut l, &req("DELETE", "/activity/system.battery", "", &[])).0, 404);
        assert_eq!(
            run(&mut a, &mut l, &req("POST", "/activity", r#"{"id":"system.battery","title":"x"}"#, &[])).0,
            409
        );
        let (_, status) = run(&mut a, &mut l, &req("GET", "/status", "", &[]));
        assert_eq!(status["activities"], json!([]));
        assert_eq!(l.get("system.battery").unwrap().title, "Battery low");
    }

    #[test]
    fn host_and_origin_are_judged_before_the_key() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        let wrong_key = ("x-notch-key", "nope");
        for host in ["evil.example:5199", "127.0.0.1:9999", "127.0.0.1", ""] {
            assert_eq!(run(&mut a, &mut l, &req("GET", "/status", "", &[("host", host), wrong_key])).0, 403, "{host}");
        }
        let r = req("POST", "/notify", r#"{"title":"x"}"#, &[("origin", "https://evil.example")]);
        assert_eq!(run(&mut a, &mut l, &r).0, 403, "a web page cannot post here, even with the key");
        assert_eq!(run(&mut a, &mut l, &req("GET", "/status", "", &[("host", "LOCALHOST:5199")])).0, 200);
    }

    #[test]
    fn limits_and_types() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        let mut big = req("POST", "/notify", "", &[]);
        big.too_large = true;
        assert_eq!(run(&mut a, &mut l, &big).0, 413);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/notify", &format!("{{{}}}", " ".repeat(5000)), &[])).0, 413);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/notify", "not json", &[])).0, 422);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/notify", r#"{"subtitle":"no title"}"#, &[])).0, 422);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/notify", "[1]", &[])).0, 422);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/notify", "{}", &[("content-type", "text/plain")])).0, 415);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/notify", "{}", &[("content-type", "")])).0, 415);
        let charset =
            req("POST", "/notify", r#"{"title":"x"}"#, &[("content-type", "application/json; charset=utf-8")]);
        assert_eq!(run(&mut a, &mut l, &charset).0, 200);
        assert_eq!(run(&mut a, &mut l, &req("PUT", "/notify", "{}", &[])).0, 404);
        assert_eq!(run(&mut a, &mut l, &req("POST", "/run", r#"{"cmd":"calc"}"#, &[])).0, 404, "no such door");
        let (_, body) =
            run(&mut a, &mut l, &req("POST", "/notify", r#"{"title":"x","action":"file:///C:/x.exe"}"#, &[]));
        assert_eq!(body["ignored"], json!(["action"]));
    }

    #[test]
    fn the_list_cap_holds_for_scripts() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        for i in 0..crate::alerts::MAX_ITEMS {
            l.put(Alert { id: format!("s{i}"), source: "api".into(), ..Alert::default() }, 0);
        }
        assert_eq!(run(&mut a, &mut l, &req("POST", "/activity", r#"{"id":"more","title":"x"}"#, &[])).0, 409);
    }

    #[test]
    fn rate_limit_counts_wrong_keys_too_and_answers_429_with_retry_after() {
        let (mut a, mut l) = (Adapter::default(), AlertList::default());
        let guess = req("GET", "/status", "", &[("x-notch-key", "guess")]);
        let codes: Vec<u16> = (0..RATE_MAX + 2).map(|_| a.handle(&guess, PORT, KEY, &mut l, 5_000).0.status).collect();
        assert!(codes[..RATE_MAX].iter().all(|c| *c == 401) && codes[RATE_MAX..].iter().all(|c| *c == 429));
        let (res, _) = a.handle(&guess, PORT, KEY, &mut l, 5_000);
        assert_eq!(res.retry_after, Some(10));
        assert!(String::from_utf8(res.to_bytes()).unwrap().contains("Retry-After: 10\r\n"));
        assert_eq!(a.handle(&guess, PORT, KEY, &mut l, 5_000 + RATE_WINDOW_MS).0.status, 401, "the window moved on");
    }

    #[test]
    fn the_key_file_is_per_install_stable_and_rotates_when_deleted() {
        let tmp = Tmp::new();
        let path = key_path(tmp.path());
        let first = ensure_key(&path).unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(ensure_key(&path).unwrap(), first);
        std::fs::remove_file(&path).unwrap();
        assert_ne!(ensure_key(&path).unwrap(), first);
        std::fs::write(&path, "short").unwrap();
        assert_eq!(ensure_key(&path).unwrap().len(), 64, "a damaged key is replaced");
    }

    #[test]
    fn requests_are_read_with_their_limits() {
        let raw =
            format!("POST /notify HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nContent-Length: 13\r\n\r\n{{\"title\":\"x\"}}");
        let r = read_request(&mut raw.as_bytes()).unwrap().unwrap();
        assert_eq!(
            (r.method.as_str(), r.path.as_str(), r.body.as_slice()),
            ("POST", "/notify", &b"{\"title\":\"x\"}"[..])
        );
        assert_eq!(r.header("host"), Some("127.0.0.1:5199"));
        let big = "POST /notify HTTP/1.1\r\nContent-Length: 999999\r\n\r\n";
        assert!(read_request(&mut big.as_bytes()).unwrap().unwrap().too_large, "the body is never read");
        let huge = format!("GET / HTTP/1.1\r\nX: {}", "a".repeat(9000));
        assert_eq!(read_request(&mut huge.as_bytes()).unwrap_err().status, 431);
        assert_eq!(read_request(&mut &b"\x00\x01garbage\r\n\r\n"[..]).unwrap_err().status, 400);
        assert!(read_request(&mut &b"GET / HTTP/1.1\r\n"[..]).unwrap().is_none(), "the peer gave up");
    }

    #[test]
    fn it_cannot_run_anything() {
        for src in [include_str!("http_alerts.rs"), include_str!("alerts.rs")] {
            let code = src.split("#[cfg(test)]").next().unwrap();
            for word in ["process::", "Command::new", "ShellExecute", "std::fs::remove", "open::"] {
                assert!(!code.contains(word), "{word}");
            }
        }
    }

    #[test]
    fn a_real_loopback_round_trip() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let s = stop.clone();
        let t = std::thread::spawn(move || {
            let (mut a, mut l) = (Adapter::default(), AlertList::default());
            serve(&listener, &s, |r| a.handle(r, port, KEY, &mut l, 0).0);
        });
        let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
        c.write_all(format!("GET /status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).unwrap();
        let mut out = String::new();
        c.read_to_string(&mut out).unwrap();
        assert!(out.starts_with("HTTP/1.1 401 "), "{out}");
        stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(("127.0.0.1", port));
        t.join().unwrap();
    }
}
