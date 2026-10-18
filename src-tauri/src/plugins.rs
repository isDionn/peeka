//! The plugin server's Windows half: the named pipe (per-user DACL, remote clients refused, first
//! instance only), `endpoint.json`, the client's exe path and signature (information only), the consent window, and
//! the runner for `notch_core::plugins::host::Out`. Every rule lives in `notch_core::plugins`; this file moves bytes.
//!
//! Events (payload shapes: `notch/ui/src/plugin-api.ts`): `plugins_changed` (null), `consent_changed` (null),
//! `plugin_surfaces_changed` (`SurfacesView`), `composer_event` (`ComposerEvent`), `plugin_stream` (`StreamPiece`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use notch_core::alerts::Attention;
use notch_core::plugins::host::{Host, Out, SurfacesView, UiEvent};
use notch_core::plugins::{pipe, MAX_CARD_MESSAGE};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc;

use crate::app::{notice, Notch};
use crate::live::now_ms;

/// At most this many pipe instances (= open plugin connections) at once.
const MAX_INSTANCES: usize = 16;
/// Lines waiting for a slow plugin; a plugin that stops reading is cut off past this.
const QUEUE: usize = 256;
const CONSENT_LABEL: &str = "consent";
/// The consent window, CSS px (the page centres its card inside).
const CONSENT_W: f64 = 460.0;
const CONSENT_H: f64 = 640.0;

enum Msg {
    Line(String),
    Close,
}

pub struct Plugins {
    pub host: Mutex<Host>,
    conns: Mutex<HashMap<u64, mpsc::Sender<Msg>>>,
    next: AtomicU64,
    data_dir: PathBuf,
    /// When Peeka's own Claude Code hook last delivered a valid line (0 = never); `claude_bridge_state` reads it.
    pub cc_seen: AtomicU64,
}

/// Starts the pipe server and the 50 ms tick. A failure is a notice: Notch runs on without plugins.
pub fn start(app: &AppHandle, data_dir: PathBuf) {
    // Demo: a fake main assistant in process, no pipe, no endpoint.json, no plugins.json.
    let (host, demo_outs) =
        if crate::app::demo() { Host::demo(data_dir.clone(), now_ms()) } else { (Host::new(data_dir.clone()), vec![]) };
    app.manage(Plugins {
        host: Mutex::new(host),
        conns: Mutex::new(HashMap::new()),
        next: AtomicU64::new(1),
        data_dir,
        cc_seen: AtomicU64::new(0),
    });
    run(app, demo_outs);
    if crate::app::demo() {
        tick_loop(app.clone());
        return;
    }
    let sid = win::user_sid();
    let Some((name, sddl)) = sid.as_deref().and_then(|sid| pipe::pipe_name(sid).zip(pipe::sddl(sid))) else {
        notice(app, "Eklenti borusu açılamadı (kullanıcı kimliği okunamadı); eklentiler bağlanamaz.");
        return;
    };
    if let Some(cc) = sid.as_deref().and_then(pipe::cc_pipe_name) {
        let (handle, sddl) = (app.clone(), sddl.clone());
        tauri::async_runtime::spawn(async move { serve_cc(handle, cc, sddl).await });
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move { serve(handle, name, sddl).await });
    tick_loop(app.clone());
}

/// The host's 50 ms tick, the consent window retry and the island-hide expiry.
fn tick_loop(handle: AppHandle) {
    std::thread::spawn(move || {
        for i in 0u64.. {
            std::thread::sleep(Duration::from_millis(50));
            let Some(p) = handle.try_state::<Plugins>() else { break };
            let (outs, pending) = {
                let mut h = p.host.lock();
                (h.tick(now_ms()), h.consent_pending())
            };
            run(&handle, outs);
            // The window could not open (fullscreen) or was closed by hand: try again once a second.
            if pending && i % 20 == 0 && handle.get_webview_window(CONSENT_LABEL).is_none() {
                open_consent(&handle);
            }
            if i % 20 == 0 {
                crate::commands::island_hide_expire(&handle);
            }
        }
    });
}

/// Exit: `endpoint.json` goes (only if it is still ours).
pub fn stop(app: &AppHandle) {
    if crate::app::demo() {
        return;
    }
    if let Some(p) = app.try_state::<Plugins>() {
        pipe::remove_endpoint(&p.data_dir, std::process::id());
    }
}

fn create(name: &str, sd: &win::Sd, first: bool) -> std::io::Result<NamedPipeServer> {
    let mut attrs = sd.attributes();
    let mut opts = ServerOptions::new();
    opts.first_pipe_instance(first)
        .reject_remote_clients(true)
        .max_instances(MAX_INSTANCES)
        .in_buffer_size(64 * 1024)
        .out_buffer_size(64 * 1024);
    // SAFETY: `attrs` is a valid SECURITY_ATTRIBUTES whose descriptor (`sd`) outlives this call; Windows copies it.
    unsafe {
        opts.create_with_security_attributes_raw(
            name,
            (&mut attrs as *mut windows::Win32::Security::SECURITY_ATTRIBUTES).cast(),
        )
    }
}

async fn serve(app: AppHandle, name: String, sddl: String) {
    let Some(sd) = win::Sd::new(&sddl) else {
        notice(&app, "Eklenti borusunun güvenlik tanımı kurulamadı; eklentiler bağlanamaz.");
        return;
    };
    let mut server = match create(&name, &sd, true) {
        Ok(s) => s,
        Err(_) => {
            notice(&app, "Başka bir program eklenti borusunun adını tutuyor; eklentiler bağlanamaz.");
            return;
        }
    };
    if let Some(p) = app.try_state::<Plugins>() {
        if pipe::write_endpoint(&p.data_dir, &name, std::process::id()).is_err() {
            notice(&app, "endpoint.json yazılamadı; eklentiler Peeka'yı bulamaz.");
        }
    }
    loop {
        if server.connect().await.is_err() {
            match create(&name, &sd, false) {
                Ok(s) => server = s,
                Err(_) => tokio_sleep().await,
            }
            continue;
        }
        // Serve the connected client first, then make the next instance: with all 16 taken, waiting for a free one
        // must not hold up the client that just got in. (A client arriving in that gap retries, §2.)
        tauri::async_runtime::spawn(connection(app.clone(), server));
        server = loop {
            match create(&name, &sd, false) {
                Ok(s) => break s,
                Err(_) => tokio_sleep().await, // all instances busy: wait for one to close
            }
        };
    }
}

/// Peeka's own Claude Code hook pipe (`docs/eklenti-api.md` "Claude Code"): same per-user DACL as the plugin pipe,
/// one `cc.event` line per connection, no handshake, nothing sent back. Checked by `Host::cc_hook`.
async fn serve_cc(app: AppHandle, name: String, sddl: String) {
    let Some(sd) = win::Sd::new(&sddl) else { return };
    let Ok(mut server) = create(&name, &sd, true) else {
        notice(&app, "Başka bir program Claude Code borusunun adını tutuyor; Claude Code olayları gelmeyecek.");
        return;
    };
    loop {
        if server.connect().await.is_ok() {
            tauri::async_runtime::spawn(cc_connection(app.clone(), server));
        }
        server = loop {
            match create(&name, &sd, false) {
                Ok(s) => break s,
                Err(_) => tokio_sleep().await,
            }
        };
    }
}

/// A hook line is ~100 bytes; anything past this is not one.
const CC_LINE_MAX: usize = 1024;

async fn cc_connection(app: AppHandle, pipe: NamedPipeServer) {
    let pipe = Arc::new(pipe);
    let cut = pipe.clone();
    // A client that connects and stays silent is cut off after 0.5 s (the hook writes at once and exits).
    tauri::async_runtime::spawn(async move {
        tokio_sleep().await;
        let _ = cut.disconnect();
    });
    let (mut buf, mut chunk) = (Vec::<u8>::new(), [0u8; 512]);
    loop {
        if pipe.readable().await.is_err() {
            break;
        }
        match pipe.try_read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') {
                    break;
                }
                if buf.len() > CC_LINE_MAX {
                    return;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break, // the hook closed its end: what it wrote is in `buf`
        }
    }
    let _ = pipe.disconnect();
    let line = buf.split(|b| *b == b'\n').next().unwrap_or_default();
    let Some(p) = app.try_state::<Plugins>() else { return };
    let Some(outs) = p.host.lock().cc_hook(line, now_ms()) else { return };
    p.cc_seen.store(now_ms(), Ordering::SeqCst);
    run(&app, outs);
}

/// `peeka.exe --cc-hook`, run by Claude Code for each hook event (before Tauri starts; `main.rs`). Reads the hook's
/// JSON on stdin and sends Peeka only `{kind, tool, reason, sid}` (`cc_hooks::hook_params`; `sid` = salted 8-hex tag of the session id). Never holds Claude Code up
/// and never answers: no stdout at all (a PermissionRequest keeps Claude Code's own prompt), every path ends in exit
/// 0, a 2 s watchdog ends it whatever happens, and a closed or busy pipe (Peeka not running) is given up at once.
pub fn cc_hook_main() -> ! {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(2));
        std::process::exit(0);
    });
    let send = || -> Option<()> {
        use std::io::{Read, Write};
        let mut raw = Vec::new();
        std::io::stdin().lock().take(4 * 1024 * 1024).read_to_end(&mut raw).ok()?;
        let salt = notch_core::data_dir().and_then(|d| notch_core::plugins::cc_hooks::salt(&d.join("cc-salt.bin")));
        let line = notch_core::plugins::cc_hooks::hook_params(&serde_json::from_slice(&raw).ok()?, salt.as_deref())?;
        drop(raw); // the prompt, the command, the output: gone before anything is sent
        let name = pipe::cc_pipe_name(&win::user_sid()?)?;
        let mut pipe = std::fs::OpenOptions::new().read(true).write(true).open(name).ok()?;
        pipe.write_all(format!("{line}\n").as_bytes()).ok()?;
        // Wait for Peeka to hang up (it has read the line), so exiting cannot race its read; the watchdog caps it.
        let _ = pipe.read(&mut [0u8; 1]);
        Some(())
    };
    let _ = send();
    std::process::exit(0)
}

/// tokio's `time` feature is not on (it would be one more feature for one wait): a blocking sleep off the runtime.
async fn tokio_sleep() {
    let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(500))).await;
}

async fn write_all(pipe: &NamedPipeServer, mut rest: &[u8]) -> std::io::Result<()> {
    while !rest.is_empty() {
        pipe.writable().await?;
        match pipe.try_write(rest) {
            Ok(n) => rest = &rest[n..],
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

async fn connection(app: AppHandle, pipe: NamedPipeServer) {
    let pipe = Arc::new(pipe);
    let raw = std::os::windows::io::AsRawHandle::as_raw_handle(&*pipe) as isize;
    // `pipe` stays alive across this await, so the raw handle is valid while the lookup runs.
    let client = tauri::async_runtime::spawn_blocking(move || win::client(raw)).await.unwrap_or_default();
    let Some(p) = app.try_state::<Plugins>() else { return };
    let id = p.next.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::channel::<Msg>(QUEUE);
    p.conns.lock().insert(id, tx);
    p.host.lock().connect(id, client);

    let w = pipe.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(m) = rx.recv().await {
            match m {
                Msg::Line(l) if write_all(&w, format!("{l}\n").as_bytes()).await.is_ok() => {}
                _ => break,
            }
        }
        let _ = w.disconnect(); // the reader's next read fails and it cleans up
    });

    let (mut buf, mut chunk) = (Vec::<u8>::new(), vec![0u8; 16 * 1024]);
    'read: loop {
        if pipe.readable().await.is_err() {
            break;
        }
        match pipe.try_read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                while let Some(i) = buf.iter().position(|b| *b == b'\n') {
                    let mut line: Vec<u8> = buf.drain(..=i).collect();
                    line.pop();
                    if line.last() == Some(&b'\r') {
                        line.pop();
                    }
                    if !line.is_empty() {
                        let outs = p.host.lock().line(id, &line, now_ms());
                        run(&app, outs);
                    }
                }
                if buf.len() > MAX_CARD_MESSAGE {
                    let outs = p.host.lock().line(id, &buf, now_ms()); // "too large", then close
                    run(&app, outs);
                    break 'read;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }
    }
    p.conns.lock().remove(&id); // the writer's channel ends, it disconnects
    let outs = p.host.lock().disconnect(id, now_ms());
    run(&app, outs);
}

fn send(app: &AppHandle, conn: u64, m: Msg) {
    let Some(p) = app.try_state::<Plugins>() else { return };
    let mut conns = p.conns.lock();
    let full = conns.get(&conn).is_some_and(|tx| tx.try_send(m).is_err());
    if full {
        conns.remove(&conn); // a plugin that does not read its answers is cut off
    }
}

pub fn surfaces(app: &AppHandle) -> Option<SurfacesView> {
    let n = app.try_state::<Notch>()?;
    let p = app.try_state::<Plugins>()?;
    let alerts = crate::live::alerts_view(&n);
    let ctx = Attention { dnd: n.settings.lock().dnd, ..*n.attention.lock() };
    let v = p.host.lock().surfaces_view(&ctx, alerts.top.as_deref(), alerts.drop_strip_ms);
    Some(v)
}

/// Notch's lock from Windows or the owner's button (`lock.signal` comes in through the host itself).
pub fn lock(app: &AppHandle, reason: notch_core::lock::Reason, on: bool) {
    let Some(p) = app.try_state::<Plugins>() else { return };
    let outs = p.host.lock().lock_set(reason, on);
    run(app, outs);
}

pub fn locked(app: &AppHandle) -> bool {
    app.try_state::<Plugins>().is_some_and(|p| p.host.lock().locked())
}

pub fn emit_surfaces(app: &AppHandle) {
    if let Some(v) = surfaces(app) {
        let _ = app.emit("plugin_surfaces_changed", v);
    }
}

/// Runs what the host decided. Locks are taken one at a time (host, then alerts), never nested.
pub fn run(app: &AppHandle, outs: Vec<Out>) {
    let (mut surfaces, mut plugins, mut consent, mut alerts) = (false, false, false, false);
    for o in outs {
        match o {
            Out::Send(c, l) => send(app, c, Msg::Line(l)),
            Out::Close(c) => send(app, c, Msg::Close),
            Out::Ui(UiEvent::PluginsChanged) => plugins = true,
            Out::Ui(UiEvent::ConsentChanged) => consent = true,
            Out::Ui(UiEvent::SurfacesChanged) => surfaces = true,
            Out::Ui(UiEvent::Composer(e)) => {
                let _ = app.emit("composer_event", e);
            }
            Out::Ui(UiEvent::Stream(s)) => {
                let _ = app.emit("plugin_stream", s);
            }
            Out::Ui(UiEvent::LockChanged(s)) => {
                let _ = app.emit("lock_changed", s);
            }
            Out::Ui(UiEvent::AssistantOffline(on)) => {
                let _ = app.emit("assistant_offline", on);
            }
            Out::Ui(UiEvent::Meeting(on)) => {
                if let Some(n) = app.try_state::<Notch>() {
                    n.attention.lock().meeting = on;
                }
                let _ = app.emit("meeting_changed", on);
                alerts = true; // the attention budget changed: the alert list and the surfaces again
            }
            Out::Ui(UiEvent::JobDone { title, took, seconds }) => {
                if app.try_state::<Notch>().is_some_and(|n| n.settings.lock().celebrate) {
                    let _ =
                        app.emit("job_done", serde_json::json!({ "title": title, "took": took, "seconds": seconds }));
                }
            }
            Out::Ui(UiEvent::CcEvent { kind, tool, reason, sid }) => {
                let _ = app.emit("cc_event", serde_json::json!({ "kind": kind, "tool": tool, "reason": reason, "sid": sid }));
            }
            Out::Ui(UiEvent::FirstConnect) => {
                let _ = app.emit("first_connect", ());
            }
            Out::AlertPut { alert, system } => {
                if let Some(n) = app.try_state::<Notch>() {
                    let mut list = n.alerts.lock();
                    if system {
                        list.put_system(alert, now_ms());
                    } else {
                        list.put(alert, now_ms());
                    }
                    alerts = true;
                }
            }
            Out::AlertRemove(id) => {
                alerts |= app.try_state::<Notch>().is_some_and(|n| n.alerts.lock().remove(&id));
            }
            Out::AlertClear(source) => {
                alerts |= app.try_state::<Notch>().is_some_and(|n| n.alerts.lock().clear(Some(&source)));
            }
            Out::ConsentOpen => open_consent(app),
            Out::ConsentClose => {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Some(w) = handle.get_webview_window(CONSENT_LABEL) {
                        let _ = w.close();
                    }
                });
            }
            Out::Log(l) => eprintln!("[notch] {l}"),
        }
    }
    if alerts {
        crate::live::emit_alerts(app);
    }
    if plugins {
        let _ = app.emit("plugins_changed", ());
    }
    if consent {
        let _ = app.emit("consent_changed", ());
    }
    if surfaces || alerts || plugins {
        emit_surfaces(app);
    }
}

/// The consent window: on the primary monitor, centred under the strip; it takes focus (Esc
/// and the default "Reddet" need it). Never in fullscreen: the plugin waits and the tick tries again.
fn open_consent(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if handle.get_webview_window(CONSENT_LABEL).is_some() {
            return;
        }
        if handle.try_state::<Notch>().is_some_and(|n| n.attention.lock().fullscreen) {
            return;
        }
        let monitors = notch_win::monitors::list();
        let Some(m) = notch_core::model::primary(&monitors) else { return };
        let (w, h) = ((CONSENT_W * m.scale) as i32, (CONSENT_H * m.scale) as i32);
        let x = m.rect.left + (m.rect.width() - w) / 2;
        let y = notch_core::model::strip_rect(m).bottom + (8.0 * m.scale) as i32;
        let built = WebviewWindowBuilder::new(&handle, CONSENT_LABEL, WebviewUrl::App("consent.html".into()))
            .title(notch_core::PRODUCT_NAME)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(true)
            .visible(false)
            .zoom_hotkeys_enabled(false)
            .build();
        match built {
            Ok(win) => {
                if let Ok(hwnd) = win.hwnd() {
                    notch_win::style::tool_window(hwnd.0 as isize); // still hidden: no taskbar button, no Alt+Tab entry
                }
                let _ = win.set_position(PhysicalPosition::new(x, y));
                let _ = win.set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
                let _ = win.show();
                let _ = win.set_focus();
            }
            Err(e) => eprintln!("[notch] consent: {e}"),
        }
    });
}

/// The few Win32 calls: this user's SID, the pipe's security descriptor, the client's exe and its signature.
mod win {
    use notch_core::plugins::consent::{Client, Signature};
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL, HWND};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE};
    use windows::Win32::Security::WinTrust::{
        WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
        WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY,
        WTD_UI_NONE,
    };
    use windows::Win32::Security::{
        GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

    pub fn user_sid() -> Option<String> {
        // SAFETY: every out-pointer points at a local that lives through the call; the token handle is closed and
        // the SID string freed with LocalFree as the API asks.
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
            let mut len = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
            let mut buf = vec![0u64; (len as usize).div_ceil(8)]; // u64: TOKEN_USER holds pointers
            let read = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr().cast()), len, &mut len);
            let _ = CloseHandle(token);
            read.ok()?;
            let user = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut s = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut s).ok()?;
            let out = s.to_string().ok();
            let _ = LocalFree(Some(HLOCAL(s.0.cast())));
            out
        }
    }

    /// The pipe's security descriptor, built from `notch_core::plugins::pipe::sddl` (tested there).
    pub struct Sd(PSECURITY_DESCRIPTOR);

    // SAFETY: the descriptor is immutable after creation and only read by CreateNamedPipeW.
    unsafe impl Send for Sd {}
    unsafe impl Sync for Sd {}

    impl Sd {
        pub fn new(sddl: &str) -> Option<Self> {
            let mut sd = PSECURITY_DESCRIPTOR::default();
            // SAFETY: `sd` receives a LocalAlloc'd descriptor, freed in Drop.
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    &HSTRING::from(sddl),
                    SDDL_REVISION_1,
                    &mut sd,
                    None,
                )
            }
            .ok()?;
            Some(Self(sd))
        }

        pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
            SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: self.0 .0,
                bInheritHandle: false.into(),
            }
        }
    }

    impl Drop for Sd {
        fn drop(&mut self) {
            // SAFETY: allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW, freed once.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0 .0)));
            }
        }
    }

    /// The client's exe path (from its pid: spoofable, so shown as "doğrulanmadı") and its Authenticode status.
    pub fn client(pipe: isize) -> Client {
        let mut pid = 0u32;
        // SAFETY: `pipe` is a live pipe handle held by the caller for the whole call.
        if unsafe { GetNamedPipeClientProcessId(HANDLE(pipe as *mut _), &mut pid) }.is_err() {
            return Client::default();
        }
        let Some(exe) = exe_of(pid) else { return Client::default() };
        let signature = signature(&exe);
        Client { exe: Some(exe), signature }
    }

    fn exe_of(pid: u32) -> Option<String> {
        // SAFETY: the process handle is closed before returning; `buf` outlives the call and `len` is its size.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
            let _ = CloseHandle(h);
            r.ok()?;
            Some(String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    /// `WinVerifyTrust` on the file (no UI, no network: cached revocation only), then the signer's display name.
    /// shortcut: catalog-signed system binaries count as unsigned (no catalog lookup); plugins ship embedded
    /// signatures, so this only matters if a plugin runs inside a Windows binary.
    fn signature(path: &str) -> Signature {
        let wide: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let mut file = WINTRUST_FILE_INFO {
            cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: PCWSTR(wide.as_ptr()),
            ..Default::default()
        };
        let mut data = WINTRUST_DATA {
            cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
            dwStateAction: WTD_STATEACTION_VERIFY,
            dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
            ..Default::default()
        };
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
        let no_ui = HWND(-1isize as *mut _);
        // SAFETY: `file`, `wide` and `data` live until the CLOSE call below, which frees the state VERIFY made.
        unsafe {
            let status = WinVerifyTrust(no_ui, &mut action, (&mut data as *mut WINTRUST_DATA).cast());
            let out = if status == 0 {
                Signature::Signed { by: signer(&data).unwrap_or_else(|| "bilinmeyen imzalayan".into()) }
            } else {
                Signature::Unsigned
            };
            data.dwStateAction = WTD_STATEACTION_CLOSE;
            let _ = WinVerifyTrust(no_ui, &mut action, (&mut data as *mut WINTRUST_DATA).cast());
            out
        }
    }

    /// # Safety
    /// `data` must hold the state of a successful `WTD_STATEACTION_VERIFY` that has not been closed yet.
    unsafe fn signer(data: &WINTRUST_DATA) -> Option<String> {
        // SAFETY: per the contract above every pointer here belongs to that live state.
        unsafe {
            let prov = WTHelperProvDataFromStateData(data.hWVTStateData);
            if prov.is_null() {
                return None;
            }
            let sgnr = WTHelperGetProvSignerFromChain(prov, 0, false, 0);
            if sgnr.is_null() || (*sgnr).csCertChain == 0 || (*sgnr).pasCertChain.is_null() {
                return None;
            }
            let cert = (*(*sgnr).pasCertChain).pCert;
            let mut name = [0u16; 256];
            let n = CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut name)) as usize;
            (n > 1).then(|| String::from_utf16_lossy(&name[..n - 1]))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notch_core::plugins::consent::Signature;
    use tokio::net::windows::named_pipe::ClientOptions;

    fn unique_name() -> String {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        format!(r"\\.\pipe\notch-test-{}-{t}", std::process::id())
    }

    fn sd() -> win::Sd {
        win::Sd::new(&pipe::sddl(&win::user_sid().expect("own SID")).expect("sddl")).expect("descriptor")
    }

    /// `first_pipe_instance(true)`: a program that already holds the name (squatter) makes our first create fail,
    /// and two "first" creates never both succeed. Our own further instances (false) still work.
    #[test]
    fn only_the_first_pipe_instance_can_claim_the_name() {
        let (name, sd) = (unique_name(), sd());
        tauri::async_runtime::block_on(async {
            let squatter = create(&name, &sd, false).expect("a plain instance");
            assert!(create(&name, &sd, true).is_err(), "the name is already held: ours must not be the first");
            drop(squatter);
        });
        let name = unique_name();
        tauri::async_runtime::block_on(async {
            let first = create(&name, &sd, true).expect("nobody holds the name");
            assert!(create(&name, &sd, true).is_err(), "a second first instance is refused");
            let more = create(&name, &sd, false).expect("further instances of the same server work");
            drop((first, more));
        });
    }

    /// A connected client is looked up by pid: its exe path comes back (this test binary), and a test binary is not
    /// Authenticode-signed. A handle that is no pipe gives "Windows did not say" (the consent window shows nothing).
    #[test]
    fn the_client_exe_and_signature_come_from_windows_and_a_bad_handle_says_nothing() {
        let (name, sd) = (unique_name(), sd());
        let client = tauri::async_runtime::block_on(async {
            let server = create(&name, &sd, true).expect("server");
            let connecting = ClientOptions::new().open(&name).expect("client connects");
            server.connect().await.expect("server sees it");
            let raw = std::os::windows::io::AsRawHandle::as_raw_handle(&server) as isize;
            let c = win::client(raw);
            drop(connecting);
            c
        });
        let exe = client.exe.expect("exe path of the connecting process");
        let own = std::env::current_exe().unwrap();
        assert_eq!(
            std::path::Path::new(&exe).file_name().map(|n| n.to_ascii_lowercase()),
            own.file_name().map(|n| n.to_ascii_lowercase())
        );
        assert_eq!(client.signature, Signature::Unsigned);

        let none = win::client(-1);
        assert_eq!((none.exe, none.signature), (None, Signature::Unknown));
    }
}
