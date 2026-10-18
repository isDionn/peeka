//! The Win32 commands. Everything here touches the live desktop: never called by `cargo test`, never run by agents.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use windows::core::{w, BOOL, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateSolidBrush, DrawTextW, EndPaint, EnumDisplayMonitors, FillRect, GetMonitorInfoW, InvalidateRect,
    ScreenToClient, SetBkMode, SetTextColor, DT_CENTER, DT_SINGLELINE, DT_VCENTER, DT_WORDBREAK, HDC, HMONITOR,
    MONITORINFO, PAINTSTRUCT, TRANSPARENT,
};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::{
    GetDpiForMonitor, SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI,
};
use windows::Win32::UI::Shell::{
    SHAppBarMessage, SHQueryUserNotificationState, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA,
};
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::taskbar::{self, Win32Shell};
use crate::{
    appbar_marker, log, ops, restore_appbars, run_steps, still_reserved, taskbar_marker, write_json, AppBarMarker, Bar,
    Cmd, Deadline, GUARD_CHILD_ARG, HOLD, STRIP_PX,
};

const APPBAR_CB: u32 = WM_APP + 1;

pub fn dispatch(cmd: Cmd, dir: &Path) -> i32 {
    // SAFETY: process-wide setting, before any window exists; a failure only means system scaling.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    if !matches!(cmd, Cmd::GuardChild(_)) {
        install_ctrl_handler(dir);
    }
    let result = match cmd {
        Cmd::Help => Ok(()),
        Cmd::Restore | Cmd::AppBar(false) | Cmd::Hide(false) => {
            log("Undo done. If there is no 'Leftover ... marker' line above, there was nothing to undo.");
            Ok(())
        }
        Cmd::AppBar(true) => appbar(dir, false),
        Cmd::Guard => appbar(dir, true),
        Cmd::Hide(true) => hide(dir),
        Cmd::Island => island(),
        Cmd::Tray => tray(dir),
        Cmd::Radios => crate::winrt::radios(dir),
        Cmd::Topmost => topmost(),
        Cmd::VolKeys => volkeys(),
        Cmd::Exclude => exclude(),
        Cmd::Smtc => crate::winrt::smtc(),
        Cmd::Dpapi => crate::winrt::dpapi(),
        Cmd::GuardChild(pid) => guard_child(dir, pid),
    };
    match result {
        Ok(()) => {
            log("Done.");
            0
        }
        Err(error) => {
            log(&format!("ERROR: {error}"));
            1
        }
    }
}

// ---------------------------------------------------------------- Ctrl+C

static CTRL_DIR: OnceLock<PathBuf> = OnceLock::new();

unsafe extern "system" fn on_ctrl(_kind: u32) -> BOOL {
    if let Some(dir) = CTRL_DIR.get() {
        crate::on_ctrl(dir);
    }
    std::process::exit(130);
}

fn install_ctrl_handler(dir: &Path) {
    let _ = CTRL_DIR.set(dir.to_path_buf());
    // SAFETY: a plain extern "system" handler that lives for the whole process.
    if let Err(error) = unsafe { windows::Win32::System::Console::SetConsoleCtrlHandler(Some(on_ctrl), true) } {
        log(&format!("Could not set up the Ctrl+C undo ({error}); the undo still happens after 60 s and at the next start."));
    }
}

// ---------------------------------------------------------------- helpers

struct Mon {
    rect: RECT,
    work: RECT,
    dpi: u32,
    primary: bool,
}

fn monitors() -> Vec<Mon> {
    unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        // SAFETY: `data` is the &mut Vec below, alive for the whole EnumDisplayMonitors call.
        unsafe { (*(data.0 as *mut Vec<HMONITOR>)).push(m) };
        BOOL(1)
    }
    let mut handles: Vec<HMONITOR> = vec![];
    // SAFETY: synchronous enumeration into a local Vec.
    let _ = unsafe { EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut handles as *mut _ as isize)) };
    handles
        .into_iter()
        .filter_map(|h| {
            let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
            // SAFETY: a monitor handle just enumerated; mi has its size set.
            if !unsafe { GetMonitorInfoW(h, &mut mi) }.as_bool() {
                return None;
            }
            let (mut x, mut y) = (96u32, 96u32);
            // SAFETY: valid out pointers; a failure keeps 96 (100 %).
            let _ = unsafe { GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut x, &mut y) };
            Some(Mon { rect: mi.rcMonitor, work: mi.rcWork, dpi: x, primary: mi.dwFlags & 1 != 0 })
        })
        .collect()
}

fn primary() -> Result<Mon, String> {
    let mut all = monitors();
    let at = all.iter().position(|m| m.primary).unwrap_or(0);
    if all.is_empty() {
        return Err("No monitor found".into());
    }
    Ok(all.swap_remove(at))
}

fn strip_height(dpi: u32) -> i32 {
    STRIP_PX * dpi as i32 / 96
}

/// (monitor top, work area top) for every monitor now.
fn work_tops() -> Vec<(i32, i32)> {
    monitors().iter().map(|m| (m.rect.top, m.work.top)).collect()
}

pub fn log_work_areas() {
    for (i, m) in monitors().iter().enumerate() {
        log(&format!(
            "  Monitor {}{}: {}x{} @ ({},{}), scale {}%; work area top is {} px lower, bottom {} px higher.",
            i + 1,
            if m.primary { " (ana)" } else { "" },
            m.rect.right - m.rect.left,
            m.rect.bottom - m.rect.top,
            m.rect.left,
            m.rect.top,
            m.dpi * 100 / 96,
            m.work.top - m.rect.top,
            m.rect.bottom - m.work.bottom,
        ));
    }
}

fn instance() -> Result<HINSTANCE, String> {
    // SAFETY: the module handle of this exe.
    unsafe { GetModuleHandleW(None) }.map(|m| HINSTANCE(m.0)).map_err(|e| e.to_string())
}

/// Register a window class once (a second call in the same process just fails harmlessly).
fn register(name: PCWSTR, proc: WNDPROC, bg: Option<COLORREF>) -> Result<(), String> {
    let class = WNDCLASSW {
        lpfnWndProc: proc,
        hInstance: instance()?,
        lpszClassName: name,
        // SAFETY: plain GDI/user calls with constant arguments.
        hbrBackground: bg.map(|c| unsafe { CreateSolidBrush(c) }).unwrap_or_default(),
        hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap_or_default(),
        ..Default::default()
    };
    // SAFETY: `class` is fully initialised; 0 = already registered or failed, CreateWindowExW reports the latter.
    unsafe { RegisterClassW(&class) };
    Ok(())
}

fn create(ex: WINDOW_EX_STYLE, class: PCWSTR, title: &str, style: WINDOW_STYLE, r: RECT) -> Result<HWND, String> {
    // SAFETY: a registered class, a live HSTRING for the title, no parent.
    unsafe {
        CreateWindowExW(
            ex,
            class,
            &HSTRING::from(title),
            style,
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top,
            None,
            None,
            Some(instance()?),
            None,
        )
    }
    .map_err(|e| format!("Could not open the window: {e}"))
}

fn destroy(hwnd: HWND) {
    // SAFETY: our own window, on the thread that created it.
    let _ = unsafe { DestroyWindow(hwnd) };
}

fn set_label(hwnd: HWND, text: &str) {
    // SAFETY: our own window; the HSTRING lives for the call.
    unsafe {
        let _ = SetWindowTextW(hwnd, &HSTRING::from(text));
        let _ = InvalidateRect(Some(hwnd), None, true);
    }
}

/// Pump this thread's messages until `deadline` (or Ctrl+C), calling `tick` at least every `every`.
fn pump(deadline: Deadline, every: Duration, mut tick: impl FnMut()) {
    while let Some(left) = deadline.left(Instant::now()) {
        if crate::exiting() {
            return;
        }
        // SAFETY: waits on this thread's own queue; MSG is a plain out struct.
        unsafe {
            MsgWaitForMultipleObjects(None, false, left.min(every).as_millis() as u32, QS_ALLINPUT);
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        tick();
    }
}

fn wait(d: Duration) {
    pump(Deadline::after(Instant::now(), d), Duration::from_millis(50), || {});
}

fn window_text(hwnd: HWND) -> Vec<u16> {
    let mut buf = [0u16; 512];
    // SAFETY: a window handle and a local buffer.
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) }.max(0) as usize;
    buf[..n].to_vec()
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    // SAFETY: as above.
    let n = unsafe { GetClassNameW(hwnd, &mut buf) }.max(0) as usize;
    String::from_utf16_lossy(&buf[..n])
}

fn window_rect(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    // SAFETY: as above.
    unsafe { GetWindowRect(hwnd, &mut r) }.ok().map(|_| r)
}

/// The exe file name of a process (no path, no window title: titles may hold personal text).
fn exe_of_pid(pid: u32) -> String {
    // SAFETY: OpenProcess on a pid; the handle is checked and closed.
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return format!("pid {pid}");
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return format!("pid {pid}");
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        full.rsplit('\\').next().unwrap_or(&full).to_string()
    }
}

fn pid_of(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: a window handle; pid is a valid out pointer.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

fn foreground_exe() -> String {
    // SAFETY: no arguments.
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() {
        "none".into()
    } else {
        exe_of_pid(pid_of(fg))
    }
}

/// Paints the window title centred: the label of every probe window.
unsafe extern "system" fn probe_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            // SAFETY: the standard paint sequence on our own window.
            unsafe { paint_label(hwnd) };
            LRESULT(0)
        }
        APPBAR_CB => {
            let what = match wparam.0 as u32 {
                0 => "ABN_STATECHANGE (taskbar state changed)".to_string(),
                1 => "ABN_POSCHANGED (another bar moved)".to_string(),
                2 => format!(
                    "ABN_FULLSCREENAPP: fullscreen app {}",
                    if lparam.0 != 0 { "TURNED ON" } else { "turned off" }
                ),
                3 => "ABN_WINDOWARRANGE".to_string(),
                other => format!("unknown AppBar notification {other}"),
            };
            log(&format!("AppBar notification (window {:#x}): {what}", hwnd.0 as isize));
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            log("Display layout changed (WM_DISPLAYCHANGE).");
            // SAFETY: default handling.
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        // SAFETY: default handling for everything else.
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

/// # Safety
/// Only from WM_PAINT of a window of this thread.
unsafe fn paint_label(hwnd: HWND) {
    let mut ps = PAINTSTRUCT::default();
    // SAFETY: as documented above.
    unsafe {
        let dc = BeginPaint(hwnd, &mut ps);
        let mut rc = RECT::default();
        let _ = GetClientRect(hwnd, &mut rc);
        let mut text = window_text(hwnd);
        SetBkMode(dc, TRANSPARENT);
        SetTextColor(dc, COLORREF(0x00FF_FFFF));
        DrawTextW(dc, &mut text, &mut rc, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        let _ = EndPaint(hwnd, &ps);
    }
}

// ---------------------------------------------------------------- appbar / guard

pub fn appbar_remove(hwnd: isize) -> bool {
    let mut abd = APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        hWnd: HWND(hwnd as *mut _),
        ..Default::default()
    };
    // SAFETY: a fully initialised APPBARDATA; for a dead window Explorer decides what happens (that is the probe).
    unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) != 0 }
}

fn spawn_guard() -> Result<u32, String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    // Same flags as the taskbar guard (taskbar.rs ensure_guard).
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let me = std::process::id().to_string();
    let spawn = |flags: u32| {
        Command::new(&exe)
            .args([GUARD_CHILD_ARG, me.as_str()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(flags)
            .spawn()
    };
    let (child, broke_away) = match spawn(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB) {
        Ok(child) => (child, true),
        Err(error) => {
            log(&format!(
                "The guard could not break away from the job ({error}); starting it inside the job, it may die with the main process."
            ));
            (spawn(CREATE_NO_WINDOW).map_err(|e| format!("The guard did not start: {e}"))?, false)
        }
    };
    log(&format!("Guard started: PID {}, broke away from the job: {}.", child.id(), if broke_away { "yes" } else { "no" }));
    Ok(child.id())
}

fn appbar(dir: &Path, guard: bool) -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    let mons = monitors();
    if mons.is_empty() {
        return Err("No monitor found".into());
    }
    if guard {
        spawn_guard()?;
    }
    let class = w!("NotchProbeStrip");
    register(class, Some(probe_proc), Some(COLORREF(0x0060_3010)))?;
    let mut windows = vec![];
    for m in &mons {
        let height = strip_height(m.dpi);
        let r = RECT { left: m.rect.left, top: m.rect.top, right: m.rect.right, bottom: m.rect.top + height };
        let title = if guard {
            "Notch trial strip + guard (removed after 60 s)"
        } else {
            "Notch trial strip (removed after 60 s)"
        };
        let hwnd = create(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE, class, title, WS_POPUP, r)?;
        windows.push((hwnd, r, Bar { hwnd: hwnd.0 as isize, mon_top: m.rect.top, height }));
    }
    let marker = appbar_marker(dir);
    // Before ABM_NEW: a kill from here on leaves a marker the next start (or the guard) acts on.
    write_json(&marker, &AppBarMarker { appbars: windows.iter().map(|w| w.2).collect() })?;
    log("Marker written. Previous work areas:");
    log_work_areas();
    for (hwnd, r, bar) in &windows {
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: *hwnd,
            uCallbackMessage: APPBAR_CB,
            uEdge: ABE_TOP,
            rc: *r,
            ..Default::default()
        };
        // SAFETY: APPBARDATA fully initialised; our own top-level window.
        let registered = unsafe { SHAppBarMessage(ABM_NEW, &mut abd) } != 0;
        unsafe { SHAppBarMessage(ABM_QUERYPOS, &mut abd) };
        abd.rc.bottom = abd.rc.top + bar.height;
        unsafe { SHAppBarMessage(ABM_SETPOS, &mut abd) };
        let rc = abd.rc;
        // SAFETY: our own window.
        let _ = unsafe {
            SetWindowPos(
                *hwnd,
                Some(HWND_TOPMOST),
                rc.left,
                rc.top,
                rc.right - rc.left,
                rc.bottom - rc.top,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        };
        log(&format!(
            "AppBar registration (ABM_NEW) window {:#x}: {}; the place Windows gave ({},{})-({},{}), height {} px.",
            bar.hwnd,
            if registered { "accepted" } else { "REJECTED" },
            rc.left,
            rc.top,
            rc.right,
            rc.bottom,
            rc.bottom - rc.top
        ));
    }
    wait(Duration::from_millis(1500));
    log("Work areas 1.5 s after the strip opened:");
    log_work_areas();
    if guard {
        log(&format!(
            "Now, in Task Manager > Details, end the notch-probe.exe with PID {} using 'End task'. What the guard does is written to the log file.",
            std::process::id()
        ));
    } else {
        log("Check whether a maximized window starts below the strip. After 60 s the strip goes away by itself.");
    }
    pump(deadline, Duration::from_millis(250), || {});
    let _ops = ops();
    if crate::exiting() {
        return Ok(());
    }
    restore_appbars(&marker, appbar_remove);
    for (hwnd, _, _) in &windows {
        destroy(*hwnd);
    }
    wait(Duration::from_millis(1000));
    log("60 s are up, strips removed. Current work areas:");
    log_work_areas();
    Ok(())
}

/// `--guard-child <pid>`: wait for the `guard` process to end; if it left an AppBar marker (killed), watch whether
/// Windows frees the 30 px by itself, then try the four recovery steps in order and log which one worked.
fn guard_child(dir: &Path, pid: u32) -> Result<(), String> {
    log(&format!("Guard: watching PID {pid}."));
    if !taskbar::wait_for_exit(pid) {
        return Err("The guard could not watch the main process; exiting without touching anything.".into());
    }
    let t0 = Instant::now();
    let (am, tm) = (appbar_marker(dir), taskbar_marker(dir));
    let Some(marker) = crate::read_json::<AppBarMarker>(&am) else {
        log("Guard: the main process closed cleanly (no marker); the guard did nothing.");
        return Ok(());
    };
    let bars = marker.appbars;
    log(&format!(
        "Guard: the main process died leaving a marker (crash or Task Manager). {} strips. Current state:",
        bars.len()
    ));
    log_work_areas();
    let ms = || t0.elapsed().as_millis();
    let watch = Deadline::after(t0, Duration::from_secs(10));
    while watch.left(Instant::now()).is_some() {
        if !still_reserved(&bars, &work_tops()) {
            log(&format!("Guard: Windows released the 30 px BY ITSELF, {} ms after the death. No steps were needed.", ms()));
            restore_appbars(&am, appbar_remove);
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    log("Guard: 10 s passed, the 30 px are still reserved. Starting the steps.");

    let mut step1 = || {
        let had = tm.exists();
        let ok = taskbar::restore(&Win32Shell, &tm);
        log(&format!(
            "  Windows taskbar: {}",
            if !had {
                "no marker, left alone".to_string()
            } else {
                format!("restore {}", if ok { "ok" } else { "failed" })
            }
        ));
    };
    let mut step2 = || {
        let _ = restore_appbars(&am, appbar_remove);
    };
    let mut step3a = || {
        let mut result = 0usize;
        // SAFETY: a broadcast with no pointers; bounded by the timeout so a hung window cannot hold the guard.
        let sent = unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                WPARAM(SPI_SETWORKAREA.0 as usize),
                LPARAM(0),
                SMTO_ABORTIFHUNG,
                2000,
                Some(&mut result),
            )
        };
        log(&format!("  WM_SETTINGCHANGE broadcast: {}", if sent.0 != 0 { "sent" } else { "timed out" }));
    };
    let mut step3b = || {
        for m in monitors() {
            if !bars.iter().any(|b| b.mon_top == m.rect.top && m.work.top >= m.rect.top + b.height) {
                continue;
            }
            let mut r = m.work;
            r.top = m.rect.top;
            // SAFETY: a RECT on the stack for the call. Only the top edge moves back to the monitor's top.
            let ok = unsafe {
                SystemParametersInfoW(SPI_SETWORKAREA, 0, Some(&mut r as *mut RECT as *mut _), SPIF_SENDCHANGE)
            }
            .is_ok();
            log(&format!(
                "  SPI_SETWORKAREA (top edge {} -> {}): {}",
                m.work.top,
                m.rect.top,
                if ok { "accepted" } else { "rejected" }
            ));
        }
    };
    let mut step4 = || {
        log("  Showing the 'restart Explorer' suggestion (the guard never closes Explorer itself).");
        // SAFETY: a message box with live HSTRINGs; blocks only the guard until the owner clicks.
        unsafe {
            MessageBoxW(
                None,
                &HSTRING::from("The Notch trial tool could not give back the top 30 px.\n\nFix it with Task Manager > Windows Explorer > Restart."),
                &HSTRING::from("Notch trial guard"),
                MB_OK | MB_ICONWARNING | MB_TOPMOST | MB_SETFOREGROUND,
            )
        };
    };
    let mut steps: [(&str, &mut dyn FnMut()); 5] = [
        ("1) show the Windows taskbar, restore auto-hide", &mut step1),
        ("2) ABM_REMOVE for every strip in the marker", &mut step2),
        ("3a) WM_SETTINGCHANGE (SPI_SETWORKAREA) broadcast", &mut step3a),
        ("3b) write the top edge back with SPI_SETWORKAREA", &mut step3b),
        ("4) the 'restart Explorer' suggestion", &mut step4),
    ];
    let mut reserved = || {
        std::thread::sleep(Duration::from_millis(1500));
        log_work_areas();
        still_reserved(&bars, &work_tops())
    };
    match run_steps(&mut steps, &mut reserved) {
        Some(_) => log(&format!("Guard: the 30 px were free {} ms after the death.", ms())),
        None => log("Guard: no step gave the 30 px back."),
    }
    let _ = restore_appbars(&am, appbar_remove); // the marker goes even when step 1 already freed the space
    Ok(())
}

// ---------------------------------------------------------------- hide

fn hide(dir: &Path) -> Result<(), String> {
    log("The taskbar will be fully hidden for 60 s. Try: Win key, Win+A, Win+N.");
    if crate::hide_for(
        &Win32Shell,
        &taskbar_marker(dir),
        HOLD,
        Duration::from_secs(1),
        Instant::now,
        std::thread::sleep,
    ) {
        Ok(())
    } else {
        Err("Could not restore the taskbar: run 'notch-probe restore' or restart Explorer.".into())
    }
}

// ---------------------------------------------------------------- island

thread_local! {
    /// 1 = WM_NCHITTEST -> HTTRANSPARENT outside the box; 2 = cursor tracking toggles WS_EX_TRANSPARENT.
    static ISLAND_MODE: Cell<u8> = const { Cell::new(1) };
    static ISLAND_BOX: Cell<RECT> = const { Cell::new(RECT { left: 0, top: 0, right: 0, bottom: 0 }) };
}

fn lparam_point(lparam: LPARAM) -> POINT {
    POINT { x: (lparam.0 & 0xFFFF) as i16 as i32, y: ((lparam.0 >> 16) & 0xFFFF) as i16 as i32 }
}

fn inside(r: RECT, p: POINT) -> bool {
    p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
}

unsafe extern "system" fn island_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let boxr = ISLAND_BOX.with(Cell::get);
    match msg {
        WM_NCHITTEST if ISLAND_MODE.with(Cell::get) == 1 => {
            let mut p = lparam_point(lparam);
            // SAFETY: our own window.
            let _ = unsafe { ScreenToClient(hwnd, &mut p) };
            LRESULT(if inside(boxr, p) { HTCLIENT as isize } else { HTTRANSPARENT as isize })
        }
        WM_LBUTTONDOWN => {
            let p = lparam_point(lparam);
            log(&format!(
                "Click on the island ({}), mode {}. Foreground app: {}.",
                if inside(boxr, p) { "inside the box" } else { "TRANSPARENT AREA: the click did NOT pass through to the window below" },
                ISLAND_MODE.with(Cell::get),
                foreground_exe()
            ));
            LRESULT(0)
        }
        WM_MOUSEACTIVATE => {
            log("WM_MOUSEACTIVATE arrived (checking whether Windows wants to activate the island).");
            // SAFETY: default handling (WS_EX_NOACTIVATE is the thing under test, not this answer).
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        WM_ACTIVATE => {
            log(&format!(
                "Island {}.",
                if wparam.0 & 0xFFFF == 0 {
                    "released focus"
                } else {
                    "TOOK FOCUS (the foreground window lost focus)"
                }
            ));
            LRESULT(0)
        }
        WM_PAINT => {
            let mut ps = PAINTSTRUCT::default();
            // SAFETY: standard paint sequence on our own window.
            unsafe {
                let dc = BeginPaint(hwnd, &mut ps);
                let mut rc = RECT::default();
                let _ = GetClientRect(hwnd, &mut rc);
                let outer = CreateSolidBrush(COLORREF(0x00A0_A0A0));
                let inner = CreateSolidBrush(COLORREF(0x0030_2020));
                FillRect(dc, &rc, outer);
                let mut b = boxr;
                FillRect(dc, &b, inner);
                SetBkMode(dc, TRANSPARENT);
                SetTextColor(dc, COLORREF(0x00FF_FFFF));
                let mut label: Vec<u16> = "Box: click here".encode_utf16().collect();
                DrawTextW(dc, &mut label, &mut b, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
                SetTextColor(dc, COLORREF(0x0000_0000));
                let mut top = RECT { bottom: b.top, ..rc };
                let mut mode: Vec<u16> = window_text(hwnd);
                DrawTextW(dc, &mut mode, &mut top, DT_CENTER | DT_VCENTER | DT_WORDBREAK);
                let _ = windows::Win32::Graphics::Gdi::DeleteObject(outer.into());
                let _ = windows::Win32::Graphics::Gdi::DeleteObject(inner.into());
                let _ = EndPaint(hwnd, &ps);
            }
            LRESULT(0)
        }
        // SAFETY: default handling.
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

fn island() -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    let half = Deadline::after(Instant::now(), HOLD / 2);
    let m = primary()?;
    let s = |px: i32| px * m.dpi as i32 / 96;
    let (w, h) = (s(480), s(200));
    let left = m.rect.left + (m.rect.right - m.rect.left - w) / 2;
    let top = m.rect.top + s(STRIP_PX) + s(10);
    ISLAND_BOX.with(|b| b.set(RECT { left: s(140), top: s(80), right: s(340), bottom: s(160) }));
    let class = w!("NotchProbeIsland");
    register(class, Some(island_proc), None)?;
    let hwnd = create(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
        class,
        "Mode 1 (first 30 s): HTTRANSPARENT. Click the grey area: does the window below get the click?",
        WS_POPUP,
        RECT { left, top, right: left + w, bottom: top + h },
    )?;
    // SAFETY: our own layered window; uniform alpha so the grey area is NOT click-through by itself.
    unsafe {
        SetLayeredWindowAttributes(hwnd, COLORREF(0), 200, LWA_ALPHA).map_err(|e| e.to_string())?;
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    log(&format!("Sample island opened (WS_EX_NOACTIVATE, always on top). Foreground app: {}.", foreground_exe()));
    log("Mode 1: the transparent (grey) area is passed through with WM_NCHITTEST -> HTTRANSPARENT.");
    let mut toggles = 0u32;
    let mut transparent = false;
    pump(deadline, Duration::from_millis(16), || {
        if ISLAND_MODE.with(Cell::get) == 1 {
            if half.left(Instant::now()).is_none() {
                ISLAND_MODE.with(|c| c.set(2));
                set_label(hwnd, "Mode 2 (last 30 s): cursor tracking + WS_EX_TRANSPARENT. Click the grey area again.");
                log("Mode 2: the cursor is tracked at 60 Hz; WS_EX_TRANSPARENT is turned on outside the box.");
            }
            return;
        }
        let mut p = POINT::default();
        // SAFETY: plain reads and our own window's style.
        unsafe {
            if GetCursorPos(&mut p).is_err() || !ScreenToClient(hwnd, &mut p).as_bool() {
                return;
            }
            let want = !inside(ISLAND_BOX.with(Cell::get), p);
            if want != transparent {
                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let bit = WS_EX_TRANSPARENT.0 as isize;
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, if want { ex | bit } else { ex & !bit });
                transparent = want;
                toggles += 1;
            }
        }
    });
    destroy(hwnd);
    log(&format!(
        "60 s are up, island closed. In mode 2 click-through toggled {toggles} times. Foreground app: {}.",
        foreground_exe()
    ));
    Ok(())
}

// ---------------------------------------------------------------- topmost

fn notification_state() -> String {
    // SAFETY: no arguments.
    match unsafe { SHQueryUserNotificationState() } {
        Ok(s) => match s.0 {
            1 => "QUNS_NOT_PRESENT (screensaver / lock)".into(),
            2 => "QUNS_BUSY (fullscreen app)".into(),
            3 => "QUNS_RUNNING_D3D_FULL_SCREEN (EXCLUSIVE FULLSCREEN game)".into(),
            4 => "QUNS_PRESENTATION_MODE (presentation)".into(),
            5 => "QUNS_ACCEPTS_NOTIFICATIONS (normal desktop)".into(),
            6 => "QUNS_QUIET_TIME".into(),
            7 => "QUNS_APP (Store app fullscreen)".into(),
            other => format!("unknown state {other}"),
        },
        Err(error) => format!("could not be read ({error})"),
    }
}

fn topmost() -> Result<(), String> {
    let m = primary()?;
    let class = w!("NotchProbeTopmost");
    register(class, Some(probe_proc), Some(COLORREF(0x0000_80FF)))?;
    let r = RECT { left: m.rect.left, top: m.rect.top, right: m.rect.right, bottom: m.rect.top + strip_height(m.dpi) };
    let hwnd = create(
        WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
        class,
        "Notch trial: 4 s always-on-top strip",
        WS_POPUP,
        r,
    )?;
    for round in 1..=3 {
        log(&format!("Round {round}/3: switch to the game within 15 s. The strip will show for 4 s after 15 s."));
        for left in [15, 10, 5] {
            log(&format!("  {left} s..."));
            wait(Duration::from_secs(5));
        }
        log(&format!(
            "  Strip shown. According to Windows right now: {}. Foreground app: {}.",
            notification_state(),
            foreground_exe()
        ));
        // SAFETY: our own window.
        let _ = unsafe {
            SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                r.left,
                r.top,
                r.right - r.left,
                r.bottom - r.top,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        };
        wait(Duration::from_secs(4));
        // SAFETY: our own window.
        let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
        log(&format!("  Strip hidden. Now: {}. Foreground app: {}.", notification_state(), foreground_exe()));
    }
    destroy(hwnd);
    Ok(())
}

// ---------------------------------------------------------------- volkeys

thread_local! {
    static SWALLOWED: Cell<u32> = const { Cell::new(0) };
}

unsafe extern "system" fn kb_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        // SAFETY: for HC_ACTION, lParam points to a KBDLLHOOKSTRUCT (WH_KEYBOARD_LL contract).
        let k = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let name = match k.vkCode {
            0xAD => Some("Mute"),
            0xAE => Some("Volume down"),
            0xAF => Some("Volume up"),
            _ => None,
        };
        if let Some(name) = name {
            if matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN) {
                SWALLOWED.with(|c| c.set(c.get() + 1));
                log(&format!("Volume key captured and swallowed: {name}. Did the Windows volume overlay appear?"));
            }
            return LRESULT(1);
        }
    }
    // SAFETY: pass everything else on unchanged.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn volkeys() -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    // SAFETY: a low-level hook on this thread, which pumps messages below; removed before returning.
    let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb_hook), Some(instance()?), 0) }
        .map_err(|e| format!("Could not set up the keyboard hook: {e}"))?;
    log("Volume keys are captured for 60 s (only Mute / Volume down / Volume up; no other key is touched). The volume does not change meanwhile.");
    pump(deadline, Duration::from_millis(250), || {});
    // SAFETY: the hook installed above.
    let _ = unsafe { UnhookWindowsHookEx(hook) };
    log(&format!("60 s are up, hook removed. {} volume key presses were swallowed.", SWALLOWED.with(Cell::get)));
    Ok(())
}

// ---------------------------------------------------------------- exclude

fn exclude() -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    let m = primary()?;
    let s = |px: i32| px * m.dpi as i32 / 96;
    let (w, h) = (s(560), s(220));
    let left = m.rect.left + (m.rect.right - m.rect.left - w) / 2;
    let top = m.rect.top + (m.rect.bottom - m.rect.top - h) / 2;
    let class = w!("NotchProbeExclude");
    register(class, Some(probe_proc), Some(COLORREF(0x0020_2090)))?;
    let hwnd = create(
        WINDOW_EX_STYLE(0),
        class,
        "NOW: VISIBLE (should show in screen sharing)",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        RECT { left, top, right: left + w, bottom: top + h },
    )?;
    log("Sample window opened. The flag will toggle every 5 s.");
    let mut hidden = false;
    let mut next = Instant::now() + Duration::from_secs(5);
    pump(deadline, Duration::from_millis(100), || {
        if Instant::now() < next {
            return;
        }
        next += Duration::from_secs(5);
        hidden = !hidden;
        let affinity = if hidden { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        // SAFETY: our own top-level window.
        let result = unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
        let mut now = 0u32;
        // SAFETY: as above; a plain out value.
        let _ = unsafe { GetWindowDisplayAffinity(hwnd, &mut now) };
        set_label(
            hwnd,
            if hidden {
                "NOW: HIDDEN FROM CAPTURE (should not show in sharing)"
            } else {
                "NOW: VISIBLE (should show in screen sharing)"
            },
        );
        log(&format!(
            "WDA_EXCLUDEFROMCAPTURE {}: {}; the value Windows read back is {:#x}.",
            if hidden { "TURNED ON" } else { "turned off" },
            match result {
                Ok(()) => "accepted".to_string(),
                Err(error) => format!("REJECTED ({error})"),
            },
            now
        ));
    });
    destroy(hwnd);
    log("60 s are up, window closed.");
    Ok(())
}

// ---------------------------------------------------------------- tray

const OVERFLOW_CLASSES: [PCWSTR; 2] = [w!("TopLevelWindowForOverflowXamlIsland"), w!("NotifyIconOverflowWindow")];

fn top_windows() -> Vec<HWND> {
    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        // SAFETY: `data` is the &mut Vec below, alive for the whole EnumWindows call.
        unsafe {
            if IsWindowVisible(hwnd).as_bool() {
                (*(data.0 as *mut Vec<HWND>)).push(hwnd);
            }
        }
        BOOL(1)
    }
    let mut out = vec![];
    // SAFETY: synchronous enumeration into a local Vec.
    let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut out as *mut _ as isize)) };
    out
}

fn uia_overflow(strip_bottom: i32) -> Result<(), String> {
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationInvokePattern, TreeScope_Descendants, UIA_ButtonControlTypeId,
        UIA_InvokePatternId,
    };
    let tray = Win32Shell::tray().ok_or("Explorer's taskbar was not found")?;
    let e = |error: windows::core::Error| error.to_string();
    // SAFETY: COM on this (window) thread, then plain UIA client calls on live objects.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(e)?;
        let all = uia
            .ElementFromHandle(tray)
            .map_err(e)?
            .FindAll(TreeScope_Descendants, &uia.CreateTrueCondition().map_err(e)?)
            .map_err(e)?;
        let n = all.Length().map_err(e)?;
        log(&format!("UIA: {n} items in the taskbar. Buttons:"));
        let mut chosen = None;
        for i in 0..n {
            let Ok(el) = all.GetElement(i) else { continue };
            if el.CurrentControlType().ok() != Some(UIA_ButtonControlTypeId) {
                continue;
            }
            let name = el.CurrentName().map(|b| b.to_string()).unwrap_or_default();
            let id = el.CurrentAutomationId().map(|b| b.to_string()).unwrap_or_default();
            let class = el.CurrentClassName().map(|b| b.to_string()).unwrap_or_default();
            let hit = crate::looks_like_chevron(&name, &id);
            log(&format!(
                "  button: name='{name}' id='{id}' class='{class}'{}",
                if hit && chosen.is_none() { "  <- counted as the arrow button" } else { "" }
            ));
            if hit && chosen.is_none() {
                chosen = Some(el);
            }
        }
        let Some(button) = chosen else {
            return Err("The hidden-icons arrow button was not found in UIA (it may be invisible while the bar is hidden).".into());
        };
        let before = top_windows();
        let invoked =
            button.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).and_then(|p| p.Invoke());
        log(&format!(
            "The arrow button was pressed through UIA: {}",
            match &invoked {
                Ok(()) => "accepted".to_string(),
                Err(error) => format!("REJECTED ({error})"),
            }
        ));
        wait(Duration::from_millis(1200));
        let mut panels: Vec<HWND> = top_windows().into_iter().filter(|h| !before.contains(h)).collect();
        for class in OVERFLOW_CLASSES {
            if let Ok(h) = FindWindowW(class, PCWSTR::null()) {
                if !h.is_invalid() && !panels.contains(&h) && IsWindowVisible(h).as_bool() {
                    panels.push(h);
                }
            }
        }
        if panels.is_empty() {
            log("No new panel window appeared after the press: the panel may not open while the bar is hidden.");
        }
        for h in panels {
            let Some(r) = window_rect(h) else { continue };
            log(&format!(
                "New window: class '{}', place ({},{})-({},{}). Moving it below the strip (y={strip_bottom}).",
                class_name(h),
                r.left,
                r.top,
                r.right,
                r.bottom
            ));
            let moved = SetWindowPos(h, None, r.left, strip_bottom, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            log(&format!(
                "  SetWindowPos: {}",
                match &moved {
                    Ok(()) => "accepted".to_string(),
                    Err(error) => format!("REJECTED ({error})"),
                }
            ));
            wait(Duration::from_millis(1000));
            match window_rect(h) {
                Some(after) if !IsWindowVisible(h).as_bool() => {
                    log(&format!("  After 1 s: the panel CLOSED (place {},{}).", after.left, after.top))
                }
                Some(after) if after.top == strip_bottom => log("  After 1 s: the panel STAYS where it was moved."),
                Some(after) => log(&format!("  After 1 s: Explorer MOVED THE PANEL BACK (y={}).", after.top)),
                None => log("  After 1 s: the window is gone."),
            }
        }
    }
    Ok(())
}

struct Icon {
    hwnd: u32,
    uid: u32,
    callback: u32,
    version: u32,
    tip: String,
    exe: String,
}

thread_local! {
    static ICONS: RefCell<Vec<Icon>> = const { RefCell::new(vec![]) };
    static ICONS_DIRTY: Cell<bool> = const { Cell::new(false) };
    static MESSAGES: Cell<u32> = const { Cell::new(0) };
}

fn record(msg: crate::TrayMsg) {
    const NIF_MESSAGE: u32 = 1;
    let hwnd = HWND(msg.hwnd as usize as *mut _);
    ICONS.with(|icons| {
        let mut icons = icons.borrow_mut();
        let at = icons.iter().position(|i| i.hwnd == msg.hwnd && i.uid == msg.uid);
        match (msg.message, at) {
            (0 | 1, None) => {
                let exe = exe_of_pid(pid_of(hwnd));
                log(&format!("Tray mirror: icon added: {exe} (tip: '{}').", msg.tip.as_deref().unwrap_or("")));
                icons.push(Icon {
                    hwnd: msg.hwnd,
                    uid: msg.uid,
                    callback: msg.callback,
                    version: 0,
                    tip: msg.tip.unwrap_or_default(),
                    exe,
                });
                ICONS_DIRTY.with(|d| d.set(true));
            }
            (0 | 1, Some(i)) => {
                if msg.flags & NIF_MESSAGE != 0 {
                    icons[i].callback = msg.callback;
                }
                if let Some(tip) = msg.tip {
                    icons[i].tip = tip;
                }
            }
            (2, Some(i)) => {
                log(&format!("Tray mirror: icon removed: {}.", icons[i].exe));
                icons.remove(i);
                ICONS_DIRTY.with(|d| d.set(true));
            }
            (4, Some(i)) => icons[i].version = msg.version.unwrap_or(0),
            _ => {}
        }
    });
}

unsafe extern "system" fn tray_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg != WM_COPYDATA {
        // SAFETY: default handling.
        return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
    }
    // SAFETY: WM_COPYDATA's lParam is a COPYDATASTRUCT the system copied into this process for this call.
    let cds = unsafe { &*(lparam.0 as *const COPYDATASTRUCT) };
    MESSAGES.with(|c| c.set(c.get() + 1));
    if cds.dwData == 1 && !cds.lpData.is_null() {
        // SAFETY: lpData/cbData describe the copied buffer, valid for this call.
        let bytes = unsafe { std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize) };
        if let Some(m) = crate::parse_tray(bytes) {
            record(m);
        }
    }
    // Forward everything (tray icons and other apps' SHAppBarMessage calls) to Explorer's real tray.
    let Some(real) = Win32Shell::tray() else { return LRESULT(0) };
    let mut result = 0usize;
    // SAFETY: re-sending the same WM_COPYDATA; the system marshals it again; bounded by the timeout.
    unsafe { SendMessageTimeoutW(real, WM_COPYDATA, wparam, lparam, SMTO_ABORTIFHUNG, 2000, Some(&mut result)) };
    LRESULT(result as isize)
}

fn click_icon(index: usize) {
    ICONS.with(|icons| {
        let icons = icons.borrow();
        let Some(icon) = icons.get(index) else { return };
        let hwnd = HWND(icon.hwnd as usize as *mut _);
        let mut p = POINT::default();
        // SAFETY: plain calls with values from the icon's own registration.
        unsafe {
            let _ = GetCursorPos(&mut p);
            let _ = AllowSetForegroundWindow(pid_of(hwnd));
            let xy = WPARAM(((p.y as u16 as usize) << 16) | p.x as u16 as usize);
            let posted = if icon.version >= 4 {
                let event = |e: u32| LPARAM(((icon.uid as isize & 0xFFFF) << 16) | e as isize);
                [WM_RBUTTONDOWN, WM_RBUTTONUP, WM_CONTEXTMENU]
                    .iter()
                    .all(|&e| PostMessageW(Some(hwnd), icon.callback, xy, event(e)).is_ok())
            } else {
                [WM_RBUTTONDOWN, WM_RBUTTONUP].iter().all(|&e| {
                    PostMessageW(Some(hwnd), icon.callback, WPARAM(icon.uid as usize), LPARAM(e as isize)).is_ok()
                })
            };
            log(&format!(
                "Tray mirror: right-click sent to the {} icon (version {}): {}. Did the app's own menu open?",
                icon.exe,
                icon.version,
                if posted { "delivered" } else { "NOT DELIVERED" }
            ));
        }
    });
}

unsafe extern "system" fn list_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_COMMAND && (wparam.0 & 0xFFFF) >= 100 {
        click_icon((wparam.0 & 0xFFFF) - 100);
        return LRESULT(0);
    }
    // SAFETY: default handling.
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn rebuild_buttons(list: HWND, buttons: &mut Vec<HWND>, scale: impl Fn(i32) -> i32) {
    for b in buttons.drain(..) {
        destroy(b);
    }
    ICONS.with(|icons| {
        for (i, icon) in icons.borrow().iter().enumerate().take(14) {
            let mut label = format!("{}  {}", icon.exe, icon.tip.replace('\n', " "));
            label.truncate(label.char_indices().nth(70).map_or(label.len(), |(at, _)| at));
            // SAFETY: a child BUTTON of our own list window; the id is the icon's index + 100.
            if let Ok(b) = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("BUTTON"),
                    &HSTRING::from(label),
                    WS_CHILD | WS_VISIBLE | WINDOW_STYLE(BS_PUSHBUTTON as u32),
                    scale(10),
                    scale(10 + i as i32 * 34),
                    scale(440),
                    scale(30),
                    Some(list),
                    Some(HMENU((100 + i) as *mut _)),
                    instance().ok(),
                    None,
                )
            } {
                buttons.push(b);
            }
        }
    });
}

fn mirror(deadline: Deadline, dpi: u32) -> Result<(), String> {
    let s = |px: i32| px * dpi as i32 / 96;
    register(w!("Shell_TrayWnd"), Some(tray_proc), None)?;
    let fake = create(WS_EX_TOOLWINDOW | WS_EX_TOPMOST, w!("Shell_TrayWnd"), "", WS_POPUP, RECT::default())?;
    register(w!("NotchProbeTrayList"), Some(list_proc), Some(COLORREF(0x0040_4040)))?;
    let list = create(
        WS_EX_TOPMOST,
        w!("NotchProbeTrayList"),
        "Tray mirror (trial): click a button = right-click that icon",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        RECT { left: s(100), top: s(100), right: s(580), bottom: s(640) },
    )?;
    let raise = || {
        // SAFETY: our own window.
        let _ = unsafe { SetWindowPos(fake, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    };
    raise();
    // SAFETY: a lookup by class; compared, not used.
    let first = unsafe { FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) }.ok();
    log(&format!(
        "Tray mirror opened. Does FindWindow(Shell_TrayWnd) now find our window: {}.",
        if first == Some(fake) { "YES" } else { "no (Explorer's is first)" }
    ));
    // SAFETY: a registered message broadcast without pointers; posted, so a hung app cannot block us.
    let created = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };
    let _ = unsafe { PostMessageW(Some(HWND_BROADCAST), created, WPARAM(0), LPARAM(0)) };
    log("TaskbarCreated broadcast sent: apps are re-adding their icons (they come to us and are forwarded to Explorer).");
    let mut buttons = vec![];
    let mut next_raise = Instant::now();
    pump(deadline, Duration::from_millis(200), || {
        if Instant::now() >= next_raise {
            raise();
            next_raise += Duration::from_secs(1);
        }
        if ICONS_DIRTY.with(|d| d.replace(false)) {
            rebuild_buttons(list, &mut buttons, s);
        }
    });
    destroy(list);
    destroy(fake);
    // SAFETY: as above.
    let _ = unsafe { PostMessageW(Some(HWND_BROADCAST), created, WPARAM(0), LPARAM(0)) };
    let names = ICONS.with(|icons| icons.borrow().iter().map(|i| i.exe.clone()).collect::<Vec<_>>().join(", "));
    log(&format!(
        "Tray mirror closed ({} messages arrived). Icons seen: {}. TaskbarCreated was broadcast again.",
        MESSAGES.with(Cell::get),
        if names.is_empty() { "none".to_string() } else { names }
    ));
    Ok(())
}

fn tray(dir: &Path) -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    let phase_a = Deadline::after(Instant::now(), Duration::from_secs(25));
    let m = primary()?;
    let marker = taskbar_marker(dir);
    log("Part A (25 s): the taskbar is hidden; the hidden-icons panel is opened through UIA and moved below the strip.");
    {
        let _ops = ops();
        if let Err(error) = taskbar::enable(&Win32Shell, &marker, true) {
            log(&format!("Hiding failed: {error}"));
        }
    }
    wait(Duration::from_millis(1500));
    if let Err(error) = uia_overflow(m.rect.top + strip_height(m.dpi)) {
        log(&format!("Panel trial: {error}"));
    }
    let mut next = Instant::now();
    pump(phase_a, Duration::from_millis(200), || {
        if Instant::now() >= next {
            next += Duration::from_secs(1);
            let _ops = ops();
            if !crate::exiting() {
                let _ = taskbar::rehide(&Win32Shell, &marker);
            }
        }
    });
    {
        let _ops = ops();
        if crate::exiting() {
            return Ok(());
        }
        let back = taskbar::restore(&Win32Shell, &marker);
        log(&format!("Part A finished: taskbar {}.", if back { "restored" } else { "NOT RESTORED" }));
    }
    log("Part B (35 s): tray mirror. Do Discord, Steam, OneDrive show in the list, and does clicking a button open its menu?");
    mirror(deadline, m.dpi)
}
