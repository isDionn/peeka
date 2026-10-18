//! Peeka'nın görev çubuğu kodundan deneme aracına kopyalandı.
//! Aynen gelenler: `Shell` trait'i ve sahte uygulaması, `Marker` + `write_marker` / `read_marker`, `enable` / `restore` /
//! `rehide`, `wait_for_exit` / `no_such_process`, `Win32Shell`, bekçinin `CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB`
//! bayrakları (win.rs `spawn_guard`). Tek fark: `Win32Shell::tray()` bu sürecin kendi `Shell_TrayWnd` penceresini
//! (tepsi aynası) atlar. Testler de aynen geldi (ayara bağlı olanlar hariç). Uygulamaya özgü olanlar (ayarlar, Tauri, acil kısayol kaydı, işçi döngüsü, `keep_guard`)
//! alınmadı: deneme aracı tek atımlıktır, ayarı yoktur, bekçiyi bir kez başlatır.
//!
//! "tamamen" gizleme: auto-hide AND `SW_HIDE` on `Shell_TrayWnd` and every `Shell_SecondaryTrayWnd`. Auto-hide underneath
//! is what frees the work area, so nothing touches `SPI_SETWORKAREA` for this. The marker is written BEFORE the change,
//! `hidden: true` before any bar is hidden.

use std::path::Path;

/// `ABS_AUTOHIDE`. The other bit (`ABS_ALWAYSONTOP`) is fixed on since Windows 7: kept as read.
pub const ABS_AUTOHIDE: u32 = 1;

/// The calls the probe makes on the Windows taskbar. Tests use a fake; the real one is `Win32Shell`.
pub trait Shell {
    /// The current `ABM_GETSTATE` bits; None = no taskbar window (Explorer is not running).
    fn state(&self) -> Option<u32>;
    /// `ABM_SETSTATE`; false = it could not be sent (no taskbar window).
    fn set_state(&self, state: u32) -> bool;
    /// Is any taskbar (main or a secondary monitor's) visible right now? None = no taskbar window.
    fn bars_visible(&self) -> Option<bool>;
    /// `ShowWindow` on every taskbar window; false = there was none.
    fn show_bars(&self, show: bool) -> bool;
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Marker {
    /// The `ABM_GETSTATE` value before the probe turned auto-hide on.
    pub prev: u32,
    /// The probe hid the bars (`SW_HIDE`); a marker with no field = false.
    #[serde(default)]
    pub hidden: bool,
}

pub fn write_marker(marker: &Path, m: &Marker) -> Result<(), String> {
    let dir = marker.parent().ok_or("İşaret klasörü yok")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(marker, serde_json::to_vec(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn read_marker(marker: &Path) -> Option<Marker> {
    std::fs::read(marker).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

/// Mode on. The marker is written first and its `prev` is never overwritten: an existing one already holds the state
/// from before the probe, and the current state may be the probe's own auto-hide. `full` marks it `hidden` first.
/// A marker that vanished meanwhile is written again at the end.
pub fn enable(shell: &dyn Shell, marker: &Path, full: bool) -> Result<(), String> {
    let now = shell.state().ok_or("Görev çubuğu bulunamadı")?;
    let (m, fresh) = match read_marker(marker) {
        Some(m) if m.hidden || !full => (m, false),
        Some(m) => (Marker { prev: m.prev, hidden: true }, true),
        None if marker.exists() => (Marker { prev: now & !ABS_AUTOHIDE, hidden: full }, true),
        None => (Marker { prev: now, hidden: full }, true),
    };
    if fresh {
        write_marker(marker, &m)?;
    }
    if now & ABS_AUTOHIDE == 0 && !shell.set_state(now | ABS_AUTOHIDE) {
        return Err("Görev çubuğu otomatik gizlenemedi".into());
    }
    if full && !shell.show_bars(false) {
        return Err("Görev çubuğu gizlenemedi".into());
    }
    if !marker.exists() {
        write_marker(marker, &m)?;
    }
    Ok(())
}

/// Put back what the marker remembers, then delete it. No marker = the probe changed nothing (true, idempotent).
/// The bars are shown first (an unreadable marker shows them too - showing a visible bar is harmless).
/// A marker that cannot be read means "visible": the auto-hide bit is cleared from the current state.
/// The marker stays when the taskbar cannot be reached, so the next start (or the guard's next try) tries again.
pub fn restore(shell: &dyn Shell, marker: &Path) -> bool {
    let raw = match std::fs::read(marker) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return true,
        other => other.ok(),
    };
    let remembered = raw.and_then(|bytes| serde_json::from_slice::<Marker>(&bytes).ok());
    if remembered.as_ref().is_none_or(|m| m.hidden) && !shell.show_bars(true) {
        return false;
    }
    let Some(target) = remembered.map(|m| m.prev).or_else(|| shell.state().map(|now| now & !ABS_AUTOHIDE)) else {
        return false;
    };
    if !shell.set_state(target) {
        return false;
    }
    let _ = std::fs::remove_file(marker);
    true
}

/// "tamamen" check: a bar that came back (Explorer restart, new monitor) is hidden again with auto-hide re-applied.
pub fn rehide(shell: &dyn Shell, marker: &Path) -> Result<(), String> {
    match shell.bars_visible() {
        Some(visible) if visible || !marker.exists() => enable(shell, marker, true),
        _ => Ok(()),
    }
}

#[cfg(windows)]
pub struct Win32Shell;

#[cfg(windows)]
impl Win32Shell {
    /// Explorer's taskbar - never one of this process's own windows (the `tray` mirror registers the same class).
    pub fn tray() -> Option<windows::Win32::Foundation::HWND> {
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetWindowThreadProcessId};
        let me = std::process::id();
        let mut after = HWND::default();
        for _ in 0..8 {
            // SAFETY: top-level search after the previous match; valid wide strings; the result is checked.
            let next = unsafe { FindWindowExW(None, Some(after), w!("Shell_TrayWnd"), PCWSTR::null()) }.ok()?;
            if next.is_invalid() {
                return None;
            }
            let mut pid = 0u32;
            // SAFETY: a handle just returned by FindWindowExW; pid is a valid out pointer.
            unsafe { GetWindowThreadProcessId(next, Some(&mut pid)) };
            if pid != me {
                return Some(next);
            }
            after = next;
        }
        None
    }

    /// Every taskbar window, found fresh each time (an Explorer restart makes new ones; handles are never cached).
    fn bars() -> Vec<windows::Win32::Foundation::HWND> {
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::FindWindowExW;
        let mut out: Vec<HWND> = Self::tray().into_iter().collect();
        let mut after = HWND::default();
        // shortcut: at most 16 secondary bars (monitors); more is not a desk anyone has.
        for _ in 0..16 {
            // SAFETY: top-level search (null parent) after the previous match; valid wide strings; the result is checked.
            match unsafe { FindWindowExW(None, Some(after), w!("Shell_SecondaryTrayWnd"), PCWSTR::null()) } {
                Ok(next) if !next.is_invalid() => {
                    out.push(next);
                    after = next;
                }
                _ => break,
            }
        }
        out
    }

    fn data() -> Option<windows::Win32::UI::Shell::APPBARDATA> {
        use windows::Win32::UI::Shell::APPBARDATA;
        // ABM_SETSTATE wants cbSize and hWnd (the taskbar) set (Microsoft Learn, ABM_SETSTATE).
        Some(APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: Self::tray()?, ..Default::default() })
    }
}

#[cfg(windows)]
impl Shell for Win32Shell {
    fn state(&self) -> Option<u32> {
        use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE};
        let mut data = Self::data()?;
        // SAFETY: `data` is a fully initialised APPBARDATA with its own size in cbSize.
        Some(unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as u32)
    }

    fn set_state(&self, state: u32) -> bool {
        use windows::Win32::Foundation::LPARAM;
        use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_SETSTATE};
        let Some(mut data) = Self::data() else {
            return false;
        };
        data.lParam = LPARAM(state as isize);
        // SAFETY: as above; ABM_SETSTATE always returns TRUE, so success = the taskbar was found.
        unsafe { SHAppBarMessage(ABM_SETSTATE, &mut data) };
        true
    }

    fn bars_visible(&self) -> Option<bool> {
        use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
        let bars = Self::bars();
        // SAFETY: handles just returned by FindWindow(Ex)W; a stale one only answers false.
        (!bars.is_empty()).then(|| bars.iter().any(|&bar| unsafe { IsWindowVisible(bar) }.as_bool()))
    }

    fn show_bars(&self, show: bool) -> bool {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindowAsync, SW_HIDE, SW_SHOWNA};
        let bars = Self::bars();
        for &bar in &bars {
            // SAFETY: as above. Async: a hung Explorer cannot block the probe (or the guard). SW_SHOWNA shows without
            // taking the focus. The return value only says the request was posted.
            let _ = unsafe { ShowWindowAsync(bar, if show { SW_SHOWNA } else { SW_HIDE }) };
        }
        !bars.is_empty()
    }
}

/// `OpenProcess` on a pid with no process answers ERROR_INVALID_PARAMETER (87); anything else (access denied...) is
/// not proof that the process ended.
#[cfg(windows)]
pub fn no_such_process(code: windows::core::HRESULT) -> bool {
    code == windows::Win32::Foundation::ERROR_INVALID_PARAMETER.to_hresult()
}

/// True = the process ended (or was already gone); false = it cannot be watched.
#[cfg(windows)]
pub fn wait_for_exit(pid: u32) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE};
    // SAFETY: OpenProcess with a plain pid; the result is checked.
    let process = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(process) => process,
        Err(error) => return no_such_process(error.code()),
    };
    // SAFETY: a valid handle we own; closed right after.
    unsafe {
        let ended = WaitForSingleObject(process, INFINITE) == WAIT_OBJECT_0;
        let _ = CloseHandle(process);
        ended
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::test_util::Tmp;
    use std::cell::{Cell, RefCell};
    use std::path::PathBuf;

    fn marker_path(dir: &Path) -> PathBuf {
        dir.join("taskbar.json")
    }

    /// A taskbar in memory. `log` records every ABM_SETSTATE, `gone` = Explorer not running, `shown` = the bars.
    pub struct FakeShell {
        pub state: Cell<u32>,
        pub gone: Cell<bool>,
        pub shown: Cell<bool>,
        pub log: RefCell<Vec<u32>>,
        /// The marker path, to prove it exists (and says `hidden`) before the first change.
        marker: PathBuf,
        marker_seen_at_set: Cell<Option<bool>>,
        marker_hidden_at_hide: Cell<Option<bool>>,
        /// An old run's guard restoring meanwhile: the marker is deleted while the bars go.
        drop_marker_at_hide: Cell<bool>,
        /// Every bars_visible() call, so a timer test can count the re-hide ticks.
        pub checks: Cell<u32>,
    }

    impl FakeShell {
        pub fn new(state: u32, marker: &Path) -> Self {
            Self {
                state: Cell::new(state),
                gone: Cell::new(false),
                shown: Cell::new(true),
                log: RefCell::new(vec![]),
                marker: marker.to_path_buf(),
                marker_seen_at_set: Cell::new(None),
                marker_hidden_at_hide: Cell::new(None),
                drop_marker_at_hide: Cell::new(false),
                checks: Cell::new(0),
            }
        }
    }

    impl Shell for FakeShell {
        fn state(&self) -> Option<u32> {
            (!self.gone.get()).then(|| self.state.get())
        }
        fn set_state(&self, state: u32) -> bool {
            if self.gone.get() {
                return false;
            }
            if self.marker_seen_at_set.get().is_none() {
                self.marker_seen_at_set.set(Some(self.marker.exists()));
            }
            self.state.set(state);
            self.log.borrow_mut().push(state);
            true
        }
        fn bars_visible(&self) -> Option<bool> {
            self.checks.set(self.checks.get() + 1);
            (!self.gone.get()).then(|| self.shown.get())
        }
        fn show_bars(&self, show: bool) -> bool {
            if self.gone.get() {
                return false;
            }
            if !show && self.marker_hidden_at_hide.get().is_none() {
                self.marker_hidden_at_hide.set(Some(read_marker(&self.marker).is_some_and(|m| m.hidden)));
            }
            if !show && self.drop_marker_at_hide.get() {
                let _ = std::fs::remove_file(&self.marker);
            }
            self.shown.set(show);
            true
        }
    }

    pub const ON_TOP: u32 = 2; // ABS_ALWAYSONTOP, always set on Windows 7+

    #[test]
    fn enable_writes_the_marker_before_it_touches_the_taskbar_and_restore_puts_it_back() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, false).unwrap();
        assert_eq!(shell.marker_seen_at_set.get(), Some(true), "crash safety: the marker comes first");
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE);
        assert!(shell.shown.get(), "otomatik never hides a bar");
        assert!(restore(&shell, &marker));
        assert_eq!(shell.state.get(), ON_TOP, "the state from before the probe, other bits kept");
        assert!(!marker.exists());
    }

    #[test]
    fn full_hide_marks_the_marker_hidden_before_any_bar_goes_and_restore_shows_them() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true).unwrap();
        assert_eq!(shell.marker_hidden_at_hide.get(), Some(true), "the guard and the next start know to show them");
        assert!(!shell.shown.get());
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE, "auto-hide underneath frees the work area");
        assert!(restore(&shell, &marker));
        assert!(shell.shown.get());
        assert_eq!(shell.state.get(), ON_TOP);
        assert!(!marker.exists());
    }

    #[test]
    fn otomatik_then_tamamen_keeps_the_first_state_and_upgrades_the_marker() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, false).unwrap();
        enable(&shell, &marker, true).unwrap();
        let m = read_marker(&marker).unwrap();
        assert!(m.hidden && m.prev == ON_TOP, "prev is still the state from before the probe");
    }

    #[test]
    fn a_bar_that_comes_back_is_hidden_again_with_auto_hide() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true).unwrap();
        // Explorer restarted: a fresh, visible bar; auto-hide kept (it is a persisted Windows setting) or not.
        shell.shown.set(true);
        shell.state.set(ON_TOP);
        rehide(&shell, &marker).unwrap();
        assert!(!shell.shown.get());
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE);
        assert_eq!(read_marker(&marker).unwrap().prev, ON_TOP, "the remembered state is not the probe's own");
        shell.gone.set(true);
        assert!(rehide(&shell, &marker).is_ok(), "no Explorer = nothing to hide, no error loop");
    }

    #[test]
    fn a_second_enable_keeps_the_first_remembered_state() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, false).unwrap();
        enable(&shell, &marker, false).unwrap();
        assert_eq!(shell.log.borrow().len(), 1, "already hidden: nothing sent twice");
        restore(&shell, &marker);
        assert_eq!(shell.state.get(), ON_TOP);
    }

    #[test]
    fn an_owner_who_already_used_auto_hide_keeps_it_after_the_mode() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        enable(&shell, &marker, true).unwrap();
        assert!(shell.log.borrow().is_empty());
        restore(&shell, &marker);
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE, "their own setting, not turned off");
        assert!(shell.shown.get());
    }

    #[test]
    fn restore_without_a_marker_does_nothing_and_twice_is_harmless() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        assert!(restore(&shell, &marker));
        assert!(shell.log.borrow().is_empty(), "no marker = nothing changed, the owner's own setting stays");
        enable(&FakeShell::new(ON_TOP, &marker), &marker, false).unwrap();
        let after_crash = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        assert!(restore(&after_crash, &marker));
        assert!(restore(&after_crash, &marker), "a second restore is harmless");
        assert_eq!(*after_crash.log.borrow(), vec![ON_TOP]);
    }

    #[test]
    fn a_start_or_the_guard_after_a_crash_restores_from_the_marker() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        // The crashed run: marker written, bars hidden, auto-hide on, no restore.
        enable(&FakeShell::new(ON_TOP, &marker), &marker, true).unwrap();
        let next = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        next.shown.set(false);
        assert!(restore(&next, &marker));
        assert!(next.shown.get());
        assert_eq!(next.state.get(), ON_TOP);
        assert!(!marker.exists());
    }

    #[test]
    fn an_old_marker_reads_as_not_hidden_and_a_corrupt_one_shows_the_bars() {
        let tmp = Tmp::new();
        let marker = tmp.write("taskbar.json", b"{\"prev\": 2}");
        assert!(!read_marker(&marker).unwrap().hidden);
        let corrupt = tmp.write("taskbar.json", b"{not json");
        let shell = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &corrupt);
        shell.shown.set(false);
        assert!(restore(&shell, &corrupt));
        assert!(shell.shown.get(), "unknown = show them, harmless when they were visible");
        assert_eq!(shell.state.get(), ON_TOP, "auto-hide cleared, nothing else");
        assert!(!corrupt.exists());
    }

    #[test]
    fn with_explorer_gone_the_marker_waits_for_the_next_try() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true).unwrap();
        shell.gone.set(true);
        assert!(!restore(&shell, &marker));
        assert!(marker.exists(), "kept, so the guard's next try or the next start restores");
        assert!(enable(&shell, &marker, true).is_err());
        shell.gone.set(false);
        assert!(restore(&shell, &marker));
        assert_eq!(shell.state.get(), ON_TOP);
        assert!(shell.shown.get());
    }

    #[test]
    fn a_marker_deleted_by_an_old_guard_is_written_again() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        shell.drop_marker_at_hide.set(true);
        enable(&shell, &marker, true).unwrap();
        assert!(read_marker(&marker).is_some_and(|m| m.hidden && m.prev == ON_TOP), "enable ends with a marker");
        shell.drop_marker_at_hide.set(false);
        std::fs::remove_file(&marker).unwrap();
        rehide(&shell, &marker).unwrap();
        assert!(read_marker(&marker).is_some_and(|m| m.hidden));
        assert!(!shell.shown.get());
    }

    #[cfg(windows)]
    #[test]
    fn only_a_missing_process_counts_as_ended() {
        use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER};
        assert!(no_such_process(ERROR_INVALID_PARAMETER.to_hresult()));
        assert!(!no_such_process(ERROR_ACCESS_DENIED.to_hresult()));
    }
}
