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
            log("Geri alma tamam. Yukarıda 'Kalan ... işareti' satırı yoksa geri alınacak bir şey yoktu.");
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
            log("Bitti.");
            0
        }
        Err(error) => {
            log(&format!("HATA: {error}"));
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
        log(&format!("Ctrl+C geri alması kurulamadı ({error}); geri alma yine 60 sn'de ve bir sonraki açılışta olur."));
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
        return Err("Monitör bulunamadı".into());
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
            "  Monitör {}{}: {}x{} @ ({},{}), ölçek %{}; çalışma alanı üstü {} px aşağıda, altı {} px yukarıda.",
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
    .map_err(|e| format!("Pencere açılamadı: {e}"))
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
        "yok".into()
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
                0 => "ABN_STATECHANGE (görev çubuğu durumu değişti)".to_string(),
                1 => "ABN_POSCHANGED (başka bir çubuk yer değiştirdi)".to_string(),
                2 => format!(
                    "ABN_FULLSCREENAPP: tam ekran uygulama {}",
                    if lparam.0 != 0 { "AÇILDI" } else { "kapandı" }
                ),
                3 => "ABN_WINDOWARRANGE".to_string(),
                other => format!("bilinmeyen AppBar bildirimi {other}"),
            };
            log(&format!("AppBar bildirimi (pencere {:#x}): {what}", hwnd.0 as isize));
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            log("Ekran düzeni değişti (WM_DISPLAYCHANGE).");
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
                "Bekçi işten (job) ayrılamadı ({error}); iş içinde başlatılıyor, ana süreçle birlikte ölebilir."
            ));
            (spawn(CREATE_NO_WINDOW).map_err(|e| format!("Bekçi başlamadı: {e}"))?, false)
        }
    };
    log(&format!("Bekçi başladı: PID {}, işten ayrıldı: {}.", child.id(), if broke_away { "evet" } else { "hayır" }));
    Ok(child.id())
}

fn appbar(dir: &Path, guard: bool) -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    let mons = monitors();
    if mons.is_empty() {
        return Err("Monitör bulunamadı".into());
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
            "Notch deneme şeridi + bekçi (60 sn sonra kalkar)"
        } else {
            "Notch deneme şeridi (60 sn sonra kalkar)"
        };
        let hwnd = create(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE, class, title, WS_POPUP, r)?;
        windows.push((hwnd, r, Bar { hwnd: hwnd.0 as isize, mon_top: m.rect.top, height }));
    }
    let marker = appbar_marker(dir);
    // Before ABM_NEW: a kill from here on leaves a marker the next start (or the guard) acts on.
    write_json(&marker, &AppBarMarker { appbars: windows.iter().map(|w| w.2).collect() })?;
    log("İşaret yazıldı. Önceki çalışma alanları:");
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
            "AppBar kaydı (ABM_NEW) pencere {:#x}: {}; Windows'un verdiği yer ({},{})-({},{}), yükseklik {} px.",
            bar.hwnd,
            if registered { "kabul edildi" } else { "REDDEDİLDİ" },
            rc.left,
            rc.top,
            rc.right,
            rc.bottom,
            rc.bottom - rc.top
        ));
    }
    wait(Duration::from_millis(1500));
    log("Şerit açıldıktan 1,5 sn sonra çalışma alanları:");
    log_work_areas();
    if guard {
        log(&format!(
            "Şimdi Görev Yöneticisi > Ayrıntılar'da PID'i {} olan notch-probe.exe'yi 'Görevi sonlandır' ile kapat. Bekçinin ne yaptığı günlük dosyasına yazılır.",
            std::process::id()
        ));
    } else {
        log("Büyütülmüş bir pencere şeridin altından mı başlıyor, bak. 60 sn sonra şerit kendiliğinden kalkar.");
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
    log("60 sn doldu, şeritler kaldırıldı. Şimdiki çalışma alanları:");
    log_work_areas();
    Ok(())
}

/// `--guard-child <pid>`: wait for the `guard` process to end; if it left an AppBar marker (killed), watch whether
/// Windows frees the 30 px by itself, then try the four recovery steps in order and log which one worked.
fn guard_child(dir: &Path, pid: u32) -> Result<(), String> {
    log(&format!("Bekçi: PID {pid} izleniyor."));
    if !taskbar::wait_for_exit(pid) {
        return Err("Bekçi ana süreci izleyemedi; hiçbir şeye dokunmadan çıkıyor.".into());
    }
    let t0 = Instant::now();
    let (am, tm) = (appbar_marker(dir), taskbar_marker(dir));
    let Some(marker) = crate::read_json::<AppBarMarker>(&am) else {
        log("Bekçi: ana süreç temiz kapandı (işaret yok); bekçi hiçbir şey yapmadı.");
        return Ok(());
    };
    let bars = marker.appbars;
    log(&format!(
        "Bekçi: ana süreç işaret bırakarak öldü (çökme ya da Görev Yöneticisi). {} şerit. Şimdiki durum:",
        bars.len()
    ));
    log_work_areas();
    let ms = || t0.elapsed().as_millis();
    let watch = Deadline::after(t0, Duration::from_secs(10));
    while watch.left(Instant::now()).is_some() {
        if !still_reserved(&bars, &work_tops()) {
            log(&format!("Bekçi: Windows 30 px'i KENDİSİ bıraktı, ölümden {} ms sonra. Adımlara gerek kalmadı.", ms()));
            restore_appbars(&am, appbar_remove);
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    log("Bekçi: 10 sn geçti, 30 px hâlâ ayrılmış. Adımlar başlıyor.");

    let mut step1 = || {
        let had = tm.exists();
        let ok = taskbar::restore(&Win32Shell, &tm);
        log(&format!(
            "  Windows görev çubuğu: {}",
            if !had {
                "işaret yok, dokunulmadı".to_string()
            } else {
                format!("geri getirme {}", if ok { "tamam" } else { "başarısız" })
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
        log(&format!("  WM_SETTINGCHANGE yayını: {}", if sent.0 != 0 { "gönderildi" } else { "zaman aşımı" }));
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
                "  SPI_SETWORKAREA (üst kenar {} -> {}): {}",
                m.work.top,
                m.rect.top,
                if ok { "kabul" } else { "ret" }
            ));
        }
    };
    let mut step4 = || {
        log("  Explorer'ı yeniden başlatma önerisi gösteriliyor (bekçi Explorer'ı kendisi kapatmaz).");
        // SAFETY: a message box with live HSTRINGs; blocks only the guard until the owner clicks.
        unsafe {
            MessageBoxW(
                None,
                &HSTRING::from("Notch deneme aracı üstteki 30 px'i geri veremedi.\n\nGörev Yöneticisi > Windows Gezgini > Yeniden başlat ile düzelir."),
                &HSTRING::from("Notch deneme bekçisi"),
                MB_OK | MB_ICONWARNING | MB_TOPMOST | MB_SETFOREGROUND,
            )
        };
    };
    let mut steps: [(&str, &mut dyn FnMut()); 5] = [
        ("1) Windows görev çubuğunu göster, otomatik gizleyi geri yaz", &mut step1),
        ("2) işaretteki her şerit için ABM_REMOVE", &mut step2),
        ("3a) WM_SETTINGCHANGE (SPI_SETWORKAREA) yayını", &mut step3a),
        ("3b) SPI_SETWORKAREA ile üst kenarı geri yaz", &mut step3b),
        ("4) 'Explorer'ı yeniden başlat' önerisi", &mut step4),
    ];
    let mut reserved = || {
        std::thread::sleep(Duration::from_millis(1500));
        log_work_areas();
        still_reserved(&bars, &work_tops())
    };
    match run_steps(&mut steps, &mut reserved) {
        Some(_) => log(&format!("Bekçi: 30 px ölümden {} ms sonra serbest.", ms())),
        None => log("Bekçi: hiçbir adım 30 px'i geri vermedi."),
    }
    let _ = restore_appbars(&am, appbar_remove); // the marker goes even when step 1 already freed the space
    Ok(())
}

// ---------------------------------------------------------------- hide

fn hide(dir: &Path) -> Result<(), String> {
    log("Görev çubuğu 60 sn tamamen gizlenecek. Dene: Win tuşu, Win+A, Win+N.");
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
        Err("Görev çubuğu geri getirilemedi: 'notch-probe restore' yaz ya da Explorer'ı yeniden başlat.".into())
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
                "Adaya tıklama geldi ({}), mod {}. Öndeki uygulama: {}.",
                if inside(boxr, p) { "kutunun içi" } else { "SAYDAM ALAN: tıklama alttaki pencereye GEÇMEDİ" },
                ISLAND_MODE.with(Cell::get),
                foreground_exe()
            ));
            LRESULT(0)
        }
        WM_MOUSEACTIVATE => {
            log("WM_MOUSEACTIVATE geldi (Windows adayı etkinleştirmek istiyor mu, bakılıyor).");
            // SAFETY: default handling (WS_EX_NOACTIVATE is the thing under test, not this answer).
            unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
        }
        WM_ACTIVATE => {
            log(&format!(
                "Ada {}.",
                if wparam.0 & 0xFFFF == 0 {
                    "odağı bıraktı"
                } else {
                    "ODAK ALDI (öndeki pencere odağını kaybetti)"
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
                let mut label: Vec<u16> = "Kutu: buraya tıkla".encode_utf16().collect();
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
        "Mod 1 (ilk 30 sn): HTTRANSPARENT. Gri alana tıkla: alttaki pencere tıklamayı alıyor mu?",
        WS_POPUP,
        RECT { left, top, right: left + w, bottom: top + h },
    )?;
    // SAFETY: our own layered window; uniform alpha so the grey area is NOT click-through by itself.
    unsafe {
        SetLayeredWindowAttributes(hwnd, COLORREF(0), 200, LWA_ALPHA).map_err(|e| e.to_string())?;
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    log(&format!("Örnek ada açıldı (WS_EX_NOACTIVATE, hep üstte). Öndeki uygulama: {}.", foreground_exe()));
    log("Mod 1: saydam (gri) alan WM_NCHITTEST -> HTTRANSPARENT ile geçiriliyor.");
    let mut toggles = 0u32;
    let mut transparent = false;
    pump(deadline, Duration::from_millis(16), || {
        if ISLAND_MODE.with(Cell::get) == 1 {
            if half.left(Instant::now()).is_none() {
                ISLAND_MODE.with(|c| c.set(2));
                set_label(hwnd, "Mod 2 (son 30 sn): imleç izleme + WS_EX_TRANSPARENT. Gri alana yine tıkla.");
                log("Mod 2: imleç 60 Hz izleniyor; kutunun dışında WS_EX_TRANSPARENT açılıyor.");
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
        "60 sn doldu, ada kapandı. Mod 2'de tıklama geçirme {toggles} kez açılıp kapandı. Öndeki uygulama: {}.",
        foreground_exe()
    ));
    Ok(())
}

// ---------------------------------------------------------------- topmost

fn notification_state() -> String {
    // SAFETY: no arguments.
    match unsafe { SHQueryUserNotificationState() } {
        Ok(s) => match s.0 {
            1 => "QUNS_NOT_PRESENT (ekran koruyucu / kilit)".into(),
            2 => "QUNS_BUSY (tam ekran uygulama)".into(),
            3 => "QUNS_RUNNING_D3D_FULL_SCREEN (ÖZEL TAM EKRAN oyun)".into(),
            4 => "QUNS_PRESENTATION_MODE (sunum)".into(),
            5 => "QUNS_ACCEPTS_NOTIFICATIONS (normal masaüstü)".into(),
            6 => "QUNS_QUIET_TIME".into(),
            7 => "QUNS_APP (Mağaza uygulaması tam ekran)".into(),
            other => format!("bilinmeyen durum {other}"),
        },
        Err(error) => format!("okunamadı ({error})"),
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
        "Notch deneme: 4 sn hep üstte şerit",
        WS_POPUP,
        r,
    )?;
    for round in 1..=3 {
        log(&format!("Tur {round}/3: 15 sn içinde oyuna geç. Şerit 15 sn sonra 4 sn görünecek."));
        for left in [15, 10, 5] {
            log(&format!("  {left} sn..."));
            wait(Duration::from_secs(5));
        }
        log(&format!(
            "  Şerit gösteriliyor. Windows'a göre şu an: {}. Öndeki uygulama: {}.",
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
        log(&format!("  Şerit gizlendi. Şimdi: {}. Öndeki uygulama: {}.", notification_state(), foreground_exe()));
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
            0xAD => Some("Sessiz"),
            0xAE => Some("Ses azalt"),
            0xAF => Some("Ses artır"),
            _ => None,
        };
        if let Some(name) = name {
            if matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN) {
                SWALLOWED.with(|c| c.set(c.get() + 1));
                log(&format!("Ses tuşu yakalandı ve yutuldu: {name}. Windows'un ses göstergesi çıktı mı?"));
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
        .map_err(|e| format!("Klavye kancası kurulamadı: {e}"))?;
    log("Ses tuşları 60 sn yakalanıyor (yalnız Sessiz / Ses azalt / Ses artır; başka tuşa dokunulmuyor). Ses bu sürede değişmez.");
    pump(deadline, Duration::from_millis(250), || {});
    // SAFETY: the hook installed above.
    let _ = unsafe { UnhookWindowsHookEx(hook) };
    log(&format!("60 sn doldu, kanca kaldırıldı. {} ses tuşu basışı yutuldu.", SWALLOWED.with(Cell::get)));
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
        "ŞU AN: GÖRÜNÜR (ekran paylaşımında görünmeli)",
        WS_OVERLAPPEDWINDOW | WS_VISIBLE,
        RECT { left, top, right: left + w, bottom: top + h },
    )?;
    log("Örnek pencere açıldı. Bayrak 5 sn'de bir açılıp kapanacak.");
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
                "ŞU AN: YAKALAMADAN GİZLİ (paylaşımda görünmemeli)"
            } else {
                "ŞU AN: GÖRÜNÜR (ekran paylaşımında görünmeli)"
            },
        );
        log(&format!(
            "WDA_EXCLUDEFROMCAPTURE {}: {}; Windows'un okuduğu değer {:#x}.",
            if hidden { "AÇILDI" } else { "kapandı" },
            match result {
                Ok(()) => "kabul".to_string(),
                Err(error) => format!("RET ({error})"),
            },
            now
        ));
    });
    destroy(hwnd);
    log("60 sn doldu, pencere kapandı.");
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
    let tray = Win32Shell::tray().ok_or("Explorer'ın görev çubuğu bulunamadı")?;
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
        log(&format!("UIA: görev çubuğunda {n} öğe. Düğmeler:"));
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
                "  düğme: ad='{name}' kimlik='{id}' sınıf='{class}'{}",
                if hit && chosen.is_none() { "  <- ok düğmesi sayıldı" } else { "" }
            ));
            if hit && chosen.is_none() {
                chosen = Some(el);
            }
        }
        let Some(button) = chosen else {
            return Err("Gizli simgeler ok düğmesi UIA'da bulunamadı (çubuk gizliyken görünmüyor olabilir).".into());
        };
        let before = top_windows();
        let invoked =
            button.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).and_then(|p| p.Invoke());
        log(&format!(
            "Ok düğmesine UIA ile basıldı: {}",
            match &invoked {
                Ok(()) => "kabul".to_string(),
                Err(error) => format!("RET ({error})"),
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
            log("Basıştan sonra yeni bir panel penceresi görünmedi: panel çubuk gizliyken açılmıyor olabilir.");
        }
        for h in panels {
            let Some(r) = window_rect(h) else { continue };
            log(&format!(
                "Yeni pencere: sınıf '{}', yer ({},{})-({},{}). Şeridin altına (y={strip_bottom}) taşınıyor.",
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
                    Ok(()) => "kabul".to_string(),
                    Err(error) => format!("RET ({error})"),
                }
            ));
            wait(Duration::from_millis(1000));
            match window_rect(h) {
                Some(after) if !IsWindowVisible(h).as_bool() => {
                    log(&format!("  1 sn sonra: panel KAPANDI (yer {},{}).", after.left, after.top))
                }
                Some(after) if after.top == strip_bottom => log("  1 sn sonra: panel taşındığı yerde DURUYOR."),
                Some(after) => log(&format!("  1 sn sonra: Explorer paneli GERİ ÇEKTİ (y={}).", after.top)),
                None => log("  1 sn sonra: pencere artık yok."),
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
                log(&format!("Tepsi aynası: simge eklendi: {exe} (ipucu: '{}').", msg.tip.as_deref().unwrap_or("")));
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
                log(&format!("Tepsi aynası: simge kaldırıldı: {}.", icons[i].exe));
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
                "Tepsi aynası: {} simgesine sağ tık gönderildi (sürüm {}): {}. Uygulamanın kendi menüsü açıldı mı?",
                icon.exe,
                icon.version,
                if posted { "iletildi" } else { "İLETİLEMEDİ" }
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
        "Tepsi aynası (deneme): bir düğmeye tıkla = o simgeye sağ tık",
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
        "Tepsi aynası açıldı. FindWindow(Shell_TrayWnd) artık bizim pencereyi mi buluyor: {}.",
        if first == Some(fake) { "EVET" } else { "hayır (Explorer'ınki önde)" }
    ));
    // SAFETY: a registered message broadcast without pointers; posted, so a hung app cannot block us.
    let created = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };
    let _ = unsafe { PostMessageW(Some(HWND_BROADCAST), created, WPARAM(0), LPARAM(0)) };
    log("TaskbarCreated yayını gönderildi: uygulamalar simgelerini yeniden ekliyor (bize gelir, Explorer'a iletilir).");
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
        "Tepsi aynası kapandı ({} ileti geldi). Görülen simgeler: {}. TaskbarCreated yeniden yayınlandı.",
        MESSAGES.with(Cell::get),
        if names.is_empty() { "yok".to_string() } else { names }
    ));
    Ok(())
}

fn tray(dir: &Path) -> Result<(), String> {
    let deadline = Deadline::after(Instant::now(), HOLD);
    let phase_a = Deadline::after(Instant::now(), Duration::from_secs(25));
    let m = primary()?;
    let marker = taskbar_marker(dir);
    log("Bölüm A (25 sn): görev çubuğu gizleniyor, gizli simgeler paneli UIA ile açılıp şeridin altına taşınacak.");
    {
        let _ops = ops();
        if let Err(error) = taskbar::enable(&Win32Shell, &marker, true) {
            log(&format!("Gizleme başarısız: {error}"));
        }
    }
    wait(Duration::from_millis(1500));
    if let Err(error) = uia_overflow(m.rect.top + strip_height(m.dpi)) {
        log(&format!("Panel denemesi: {error}"));
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
        log(&format!("Bölüm A bitti: görev çubuğu geri {}.", if back { "getirildi" } else { "GETİRİLEMEDİ" }));
    }
    log("Bölüm B (35 sn): tepsi aynası. Açılan listede Discord, Steam, OneDrive görünüyor mu, düğmeye tıklayınca menüsü açılıyor mu?");
    mirror(deadline, m.dpi)
}
