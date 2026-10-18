//! Putting the Windows taskbar away and always getting it back: the decision logic, with its tests. The Win32 `Shell`, the guard process and the worker
//! thread are in `notch-win::taskbar` and `crates/notch-app`.
//!
//! - "auto" (`HideMode::Auto`): Windows's own auto-hide (`ABM_SETSTATE`, `ABS_AUTOHIDE`).
//! - "full" (`HideMode::Full`, default): auto-hide AND `SW_HIDE` on every taskbar. Auto-hide underneath frees the
//!   work area, so `SPI_SETWORKAREA` is never touched; the only reserved space is the strips' AppBars.
//!
//! Crash safety: the state from before Notch goes to a marker (`<data>/run/taskbar.json`) BEFORE any change,
//! `hidden: true` before any bar is hidden, plus the strips' window handles (`appbars`) so the guard can try
//! `ABM_REMOVE` for them. A marker left at launch means the last run never put the bar back.
//! Kept on purpose: heartbeat (`stale`, `FROZEN`), full -> auto without a way back (`effective`),
//! guard restarts with a budget (`keep_guard`), the marker re-written after an old guard deleted it, `ShowWindowAsync`
//! (in the Win32 shell), and the exiting flag (in the worker).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::settings::HideMode;

/// `ABS_AUTOHIDE`. The other bit (`ABS_ALWAYSONTOP`) is fixed on since Windows 7: kept as read.
pub const ABS_AUTOHIDE: u32 = 1;

pub const UNKNOWN: u8 = 0;
pub const OFF: u8 = 1;
pub const AUTO: u8 = 2;
pub const FULL: u8 = 3;
/// Applied only: full is wanted but the main thread stopped answering, so the bars were put back.
pub const FROZEN: u8 = 4;
/// The main thread (where the emergency key lives) has not answered for this long: frozen.
pub const FROZEN_AFTER_MS: u64 = 5000;
/// A guard that keeps dying is replaced this many times a run, then full falls back to auto.
pub const GUARD_MAX_SPAWNS: u8 = 5;

/// The calls Notch makes on the Windows taskbar. Tests use a fake; the real one is in `notch-win`.
pub trait Shell {
    /// The current `ABM_GETSTATE` bits; None = no taskbar window (Explorer is not running).
    fn state(&self) -> Option<u32>;
    /// `ABM_SETSTATE`; false = it could not be sent (no taskbar window).
    fn set_state(&self, state: u32) -> bool;
    /// Is any taskbar (main or a secondary monitor's) visible right now? None = no taskbar window.
    fn bars_visible(&self) -> Option<bool>;
    /// `ShowWindow` on every taskbar window; false = there was none.
    fn show_bars(&self, show: bool) -> bool;
    /// `ABM_REMOVE` for a strip window, possibly one of a dead Notch (crash cleanup only).
    fn remove_appbar(&self, hwnd: isize);
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marker {
    /// The `ABM_GETSTATE` value before Notch turned auto-hide on.
    pub prev: u32,
    /// Notch hid the bars (`SW_HIDE`).
    #[serde(default)]
    pub hidden: bool,
    /// The strips' window handles (AppBars) at the last write.
    #[serde(default)]
    pub appbars: Vec<isize>,
}

pub fn marker_path(data_dir: &Path) -> PathBuf {
    data_dir.join("run").join("taskbar.json")
}

pub fn want_of(mode: HideMode) -> u8 {
    match mode {
        HideMode::Off => OFF,
        HideMode::Auto => AUTO,
        HideMode::Full => FULL,
    }
}

pub fn write_marker(marker: &Path, m: &Marker) -> Result<(), String> {
    let dir = marker.parent().ok_or("No marker folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(marker, serde_json::to_vec(m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn read_marker(marker: &Path) -> Option<Marker> {
    std::fs::read(marker).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

/// Mode on. The marker is written first and its `prev` is never overwritten: an existing one already holds the state
/// from before Notch, and the current state may be Notch's own auto-hide. `full` marks it `hidden` before any bar
/// goes. A marker that vanished meanwhile (an old guard restoring and deleting it) is written again at the end.
pub fn enable(shell: &dyn Shell, marker: &Path, full: bool, appbars: &[isize]) -> Result<(), String> {
    let now = shell.state().ok_or("Taskbar not found")?;
    let bars = appbars.to_vec();
    let (m, fresh) = match read_marker(marker) {
        Some(m) if (m.hidden || !full) && m.appbars == bars => (m, false),
        Some(m) => (Marker { prev: m.prev, hidden: m.hidden || full, appbars: bars }, true),
        None if marker.exists() => (Marker { prev: now & !ABS_AUTOHIDE, hidden: full, appbars: bars }, true),
        None => (Marker { prev: now, hidden: full, appbars: bars }, true),
    };
    if fresh {
        write_marker(marker, &m)?;
    }
    if now & ABS_AUTOHIDE == 0 && !shell.set_state(now | ABS_AUTOHIDE) {
        return Err("Could not auto-hide the taskbar".into());
    }
    if full && !shell.show_bars(false) {
        return Err("Could not hide the taskbar".into());
    }
    if !marker.exists() {
        write_marker(marker, &m)?;
    }
    Ok(())
}

/// Put back what the marker remembers, then delete it. No marker = Notch changed nothing (true, idempotent).
/// The bars are shown first (an unreadable marker shows them too - showing a visible bar is harmless).
/// A marker that cannot be read means "visible": the auto-hide bit is cleared from the current state.
/// The marker stays when the taskbar cannot be reached, so the next launch (or the guard's next try) tries again.
/// The live strips' AppBars are NOT touched here: a mode switch restores while the strips stay.
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

/// After Notch died (the guard, or the next launch): steps (1) taskbar back, (2) `ABM_REMOVE` for every
/// strip handle in the marker. True = step 1 worked (the marker is gone).
// TODO(Wave 0 test 2): whether step 2 frees the 30 px from ANOTHER process for a dead window, and whether steps
// (3) a `WM_SETTINGCHANGE` / `SPI_SETWORKAREA` refresh and (4) a Windows notification "restart Explorer" are needed,
// is only known after the owner's `probe guard` run. Fill in the order that worked there; until then only 1-2 run.
/// The strips file is read too: it is written in every mode, so after a crash in "Leave the Windows taskbar alone" (no
/// marker, the bar was never touched) the strips' 30 px are still freed and the taskbar is left as it is.
pub fn crash_cleanup(shell: &dyn Shell, marker: &Path) -> bool {
    let mut appbars = read_marker(marker).map(|m| m.appbars).unwrap_or_default();
    let strips = strips_path(marker);
    for h in read_strips(&strips) {
        if !appbars.contains(&h) {
            appbars.push(h);
        }
    }
    if !restore(shell, marker) {
        return false;
    }
    for hwnd in appbars {
        shell.remove_appbar(hwnd);
    }
    let _ = std::fs::remove_file(strips);
    true
}

/// `<data>/run/strips.json`, beside the marker: the live strips' window handles, in every taskbar mode.
pub fn strips_path(marker: &Path) -> PathBuf {
    marker.with_file_name("strips.json")
}

pub fn write_strips(path: &Path, handles: &[isize]) -> Result<(), String> {
    let dir = path.parent().ok_or("No marker folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_vec(handles).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn read_strips(path: &Path) -> Vec<isize> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Full check: a bar that came back (Explorer restart, new monitor) is hidden again with auto-hide re-applied.
/// Hidden bars with no marker (an old guard restored and deleted it after this run hid them) get the marker back,
/// and a marker with old strip handles (a monitor came or went) gets the new ones.
pub fn rehide(shell: &dyn Shell, marker: &Path, appbars: &[isize]) -> Result<(), String> {
    let stale_handles = || read_marker(marker).is_none_or(|m| m.appbars != appbars);
    let visible = shell.bars_visible();
    // A restarting Explorer answers `ABM_SETSTATE` (inside `enable`) only when it is done starting - measured 4 s in
    // the VM - but takes the async hide at once: hide first, then fix the auto-hide state. Only with a `hidden`
    // marker (the crash-safety order: the marker before any bar goes).
    if visible == Some(true) && read_marker(marker).is_some_and(|m| m.hidden) {
        shell.show_bars(false);
    }
    match visible {
        Some(visible) if visible || stale_handles() => enable(shell, marker, true, appbars),
        _ => Ok(()),
    }
}

/// What the worker applies. FULL needs a way back (the emergency key, a running guard), else AUTO; a frozen main
/// thread (the key freezes with it) means the bars come back until it answers again.
pub fn effective(want: u8, safe: bool, frozen: bool) -> u8 {
    match want {
        FULL if !safe => AUTO,
        FULL if frozen => FROZEN,
        other => other,
    }
}

/// How long the full-hide worker sleeps between checks: fast for `BURST_MS` after Explorer announced a new taskbar
/// (`created_ms` = when, on the worker's clock; Explorer shows its bar again a moment after the announcement), the
/// normal pace (250 ms: a bar that came back is seen within a quarter second) otherwise.
pub const BURST_MS: u64 = 2000;
pub fn rehide_wait(created_ms: Option<u64>, now_ms: u64) -> std::time::Duration {
    let burst = created_ms.is_some_and(|t| now_ms.saturating_sub(t) < BURST_MS);
    std::time::Duration::from_millis(if burst { 100 } else { 250 })
}

pub fn stale(beat_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(beat_ms) > FROZEN_AFTER_MS
}

/// One mode change; returns what is applied afterwards. Leaving AUTO/FULL (or going OFF/FROZEN) puts the bars back
/// first - AUTO <-> FULL too, then the new style applies. A failed restore keeps `applied`, so the worker retries.
pub fn switch(shell: &dyn Shell, marker: &Path, applied: u8, want: u8, appbars: &[isize]) -> u8 {
    if (matches!(want, OFF | FROZEN) || matches!(applied, AUTO | FULL)) && !restore(shell, marker) {
        eprintln!("[taskbar] Could not restore the taskbar; will retry");
        return applied;
    }
    if matches!(want, AUTO | FULL) {
        if let Err(error) = enable(shell, marker, want == FULL, appbars) {
            eprintln!("[taskbar] {error}");
        }
    }
    want
}

/// The guard watchdog: true = one is running (alive, or just started). A dead one is replaced, at most
/// `GUARD_MAX_SPAWNS` times a run, so a guard that keeps dying cannot become a new process every second.
pub fn keep_guard<C>(
    slot: &mut Option<C>,
    spawns: &mut u8,
    alive: impl FnOnce(&mut C) -> bool,
    spawn: impl FnOnce() -> Option<C>,
) -> bool {
    if slot.as_mut().is_some_and(alive) {
        return true;
    }
    if *spawns >= GUARD_MAX_SPAWNS {
        *slot = None;
        return false;
    }
    *spawns += 1;
    *slot = spawn();
    slot.is_some()
}

#[cfg(test)]
mod tests {
    #[test]
    fn after_an_explorer_restart_the_bar_is_hidden_before_the_slow_state_call() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true, STRIPS).unwrap();
        shell.order.borrow_mut().clear();
        shell.state.set(ON_TOP); // the new Explorer: auto-hide gone, the bar visible
        shell.shown.set(true);
        rehide(&shell, &marker, STRIPS).unwrap();
        assert_eq!(*shell.order.borrow(), ["hide", "state", "hide"], "async hide first; enable hides again after the state");
        assert!(!shell.shown.get());
    }

    #[test]
    fn rehide_checks_fast_for_two_seconds_after_taskbar_created() {
        let ms = |c, n| rehide_wait(c, n).as_millis();
        assert_eq!(ms(None, 50_000), 250);
        assert_eq!(ms(Some(10_000), 10_000), 100);
        assert_eq!(ms(Some(10_000), 11_999), 100);
        assert_eq!(ms(Some(10_000), 12_000), 250);
        assert_eq!(ms(Some(10_000), 5), 100, "a clock that went back is not a reason to stall");
    }

    use super::*;
    use crate::test_util::Tmp;
    use std::cell::{Cell, RefCell};

    /// A taskbar in memory. `log` records every ABM_SETSTATE, `gone` = Explorer not running, `shown` = the bars.
    struct FakeShell {
        state: Cell<u32>,
        gone: Cell<bool>,
        shown: Cell<bool>,
        log: RefCell<Vec<u32>>,
        removed: RefCell<Vec<isize>>,
        /// The marker path, to prove it exists (and says `hidden`) before the first change.
        marker: PathBuf,
        marker_seen_at_set: Cell<Option<bool>>,
        marker_hidden_at_hide: Cell<Option<bool>>,
        /// An old run's guard restoring meanwhile: the marker is deleted while the bars go.
        drop_marker_at_hide: Cell<bool>,
        /// "hide" / "state" in the order the calls came.
        order: RefCell<Vec<&'static str>>,
    }

    impl FakeShell {
        fn new(state: u32, marker: &Path) -> Self {
            Self {
                state: Cell::new(state),
                gone: Cell::new(false),
                shown: Cell::new(true),
                log: RefCell::new(vec![]),
                removed: RefCell::new(vec![]),
                marker: marker.to_path_buf(),
                marker_seen_at_set: Cell::new(None),
                marker_hidden_at_hide: Cell::new(None),
                drop_marker_at_hide: Cell::new(false),
                order: RefCell::new(vec![]),
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
            self.order.borrow_mut().push("state");
            self.log.borrow_mut().push(state);
            true
        }
        fn bars_visible(&self) -> Option<bool> {
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
            if !show {
                self.order.borrow_mut().push("hide");
            }
            self.shown.set(show);
            true
        }
        fn remove_appbar(&self, hwnd: isize) {
            self.removed.borrow_mut().push(hwnd);
        }
    }

    const ON_TOP: u32 = 2; // ABS_ALWAYSONTOP, always set on Windows 7+
    const STRIPS: &[isize] = &[0x10, 0x20];

    #[test]
    fn the_hide_mode_maps_to_the_worker_states() {
        assert_eq!(want_of(HideMode::Off), OFF);
        assert_eq!(want_of(HideMode::Auto), AUTO);
        assert_eq!(want_of(HideMode::default()), FULL, "full hide is the default (owner decision 2)");
    }

    #[test]
    fn enable_writes_the_marker_before_it_touches_the_taskbar_and_restore_puts_it_back() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, false, STRIPS).unwrap();
        assert_eq!(shell.marker_seen_at_set.get(), Some(true), "crash safety: the marker comes first");
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE);
        assert!(shell.shown.get(), "auto never hides a bar");
        assert!(restore(&shell, &marker));
        assert_eq!(shell.state.get(), ON_TOP, "the state from before Notch, other bits kept");
        assert!(!marker.exists());
        assert!(shell.removed.borrow().is_empty(), "a mode switch never unregisters the live strips");
    }

    #[test]
    fn full_hide_marks_the_marker_hidden_with_the_strip_handles_before_any_bar_goes() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true, STRIPS).unwrap();
        assert_eq!(shell.marker_hidden_at_hide.get(), Some(true), "the guard and the next launch know to show them");
        assert_eq!(read_marker(&marker).unwrap().appbars, STRIPS);
        assert!(!shell.shown.get());
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE, "auto-hide underneath frees the work area");
        assert!(restore(&shell, &marker));
        assert!(shell.shown.get());
        assert_eq!(shell.state.get(), ON_TOP);
        assert!(!marker.exists());
    }

    #[test]
    fn a_new_monitor_updates_the_handles_but_keeps_the_first_state() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, false, &[0x10]).unwrap();
        enable(&shell, &marker, true, STRIPS).unwrap();
        let m = read_marker(&marker).unwrap();
        assert!(m.hidden && m.prev == ON_TOP && m.appbars == STRIPS, "prev is still the state from before Notch");
    }

    #[test]
    fn a_crash_cleanup_restores_then_removes_every_strip_appbar() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        enable(&FakeShell::new(ON_TOP, &marker), &marker, true, STRIPS).unwrap();
        let guard = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        guard.shown.set(false);
        assert!(crash_cleanup(&guard, &marker));
        assert!(guard.shown.get() && guard.state.get() == ON_TOP && !marker.exists());
        assert_eq!(*guard.removed.borrow(), STRIPS);
        assert!(crash_cleanup(&guard, &marker), "nothing left: harmless");
        assert_eq!(guard.removed.borrow().len(), 2);
    }

    #[test]
    fn in_off_mode_a_crash_cleanup_frees_the_strips_without_touching_the_taskbar() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let strips = strips_path(&marker);
        write_strips(&strips, STRIPS).unwrap();
        let guard = FakeShell::new(ON_TOP, &marker);
        assert!(crash_cleanup(&guard, &marker));
        assert_eq!(*guard.removed.borrow(), STRIPS, "the AppBars go in off mode too");
        assert!(guard.log.borrow().is_empty() && guard.shown.get(), "no ABM_SETSTATE, no ShowWindow");
        assert!(!strips.exists());
    }

    #[test]
    fn a_crash_cleanup_with_explorer_gone_keeps_everything_for_the_next_try() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        enable(&FakeShell::new(ON_TOP, &marker), &marker, true, STRIPS).unwrap();
        let guard = FakeShell::new(ON_TOP, &marker);
        guard.gone.set(true);
        assert!(!crash_cleanup(&guard, &marker));
        assert!(marker.exists() && guard.removed.borrow().is_empty());
    }

    #[test]
    fn a_bar_that_comes_back_is_hidden_again_with_auto_hide() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true, STRIPS).unwrap();
        // Explorer restarted: a fresh, visible bar; auto-hide kept (it is a persisted Windows setting) or not.
        shell.shown.set(true);
        shell.state.set(ON_TOP);
        rehide(&shell, &marker, STRIPS).unwrap();
        assert!(!shell.shown.get());
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE);
        assert_eq!(read_marker(&marker).unwrap().prev, ON_TOP, "the remembered state is not Notch's own");
        shell.gone.set(true);
        assert!(rehide(&shell, &marker, STRIPS).is_ok(), "no Explorer = nothing to hide, no error loop");
    }

    #[test]
    fn a_second_enable_keeps_the_first_remembered_state() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, false, STRIPS).unwrap();
        enable(&shell, &marker, false, STRIPS).unwrap(); // the state is now Notch's own auto-hide
        assert_eq!(shell.log.borrow().len(), 1, "already hidden: nothing sent twice");
        restore(&shell, &marker);
        assert_eq!(shell.state.get(), ON_TOP);
    }

    #[test]
    fn an_owner_who_already_used_auto_hide_keeps_it_after_the_mode() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        enable(&shell, &marker, true, STRIPS).unwrap();
        assert!(shell.log.borrow().is_empty());
        restore(&shell, &marker);
        assert_eq!(shell.state.get(), ON_TOP | ABS_AUTOHIDE, "their own setting, not turned off by Notch");
        assert!(shell.shown.get());
    }

    #[test]
    fn restore_without_a_marker_does_nothing_and_twice_is_harmless() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        assert!(restore(&shell, &marker));
        assert!(shell.log.borrow().is_empty(), "no marker = Notch changed nothing, the owner's own setting stays");
        enable(&FakeShell::new(ON_TOP, &marker), &marker, false, STRIPS).unwrap();
        let after_crash = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        assert!(restore(&after_crash, &marker));
        assert!(restore(&after_crash, &marker), "the exit path runs twice (ExitRequested, Exit)");
        assert_eq!(*after_crash.log.borrow(), vec![ON_TOP]);
    }

    #[test]
    fn an_old_marker_without_handles_reads_and_a_corrupt_one_shows_the_bars() {
        let tmp = Tmp::new();
        let marker = tmp.write("run/taskbar.json", b"{\"prev\": 2}");
        let m = read_marker(&marker).unwrap();
        assert!(!m.hidden && m.appbars.is_empty());
        let corrupt = tmp.write("run/taskbar.json", b"{not json");
        let shell = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &corrupt);
        shell.shown.set(false);
        assert!(crash_cleanup(&shell, &corrupt));
        assert!(shell.shown.get(), "unknown = show them, harmless when they were visible");
        assert_eq!(shell.state.get(), ON_TOP, "auto-hide cleared, nothing else");
        assert!(!corrupt.exists());
    }

    #[test]
    fn with_explorer_gone_the_marker_waits_for_the_next_try() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        enable(&shell, &marker, true, STRIPS).unwrap();
        shell.gone.set(true);
        assert!(!restore(&shell, &marker));
        assert!(marker.exists(), "kept, so the guard's next try or the next launch restores");
        assert!(enable(&shell, &marker, true, STRIPS).is_err());
        shell.gone.set(false);
        assert!(restore(&shell, &marker));
        assert_eq!(shell.state.get(), ON_TOP);
        assert!(shell.shown.get());
    }

    #[test]
    fn full_falls_back_to_auto_without_a_way_back_and_a_frozen_main_thread_brings_the_bars_back() {
        assert_eq!(effective(FULL, true, false), FULL);
        assert_eq!(effective(FULL, false, false), AUTO, "no emergency key / no guard: auto");
        assert_eq!(effective(FULL, false, true), AUTO, "auto-hide is safe even frozen");
        assert_eq!(effective(FULL, true, true), FROZEN);
        assert_eq!(effective(AUTO, false, true), AUTO);
        assert_eq!(effective(OFF, false, true), OFF);
        assert_eq!(effective(UNKNOWN, true, false), UNKNOWN);
        assert!(!stale(1_000, 6_000), "5 s exactly is still alive");
        assert!(stale(1_000, 6_001));
        assert!(!stale(9_000, 1_000), "a beat newer than the read is fresh");
    }

    #[test]
    fn freezing_restores_and_thawing_hides_again() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        assert_eq!(switch(&shell, &marker, UNKNOWN, FULL, STRIPS), FULL);
        assert!(!shell.shown.get());
        assert_eq!(switch(&shell, &marker, FULL, FROZEN, STRIPS), FROZEN);
        assert!(shell.shown.get() && shell.state.get() == ON_TOP && !marker.exists(), "fully put back");
        assert_eq!(switch(&shell, &marker, FROZEN, FULL, STRIPS), FULL);
        assert!(!shell.shown.get());
        assert_eq!(read_marker(&marker).unwrap().prev, ON_TOP);
    }

    #[test]
    fn a_failed_restore_is_not_counted_as_off_and_is_retried() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        switch(&shell, &marker, UNKNOWN, FULL, STRIPS);
        shell.gone.set(true);
        assert_eq!(switch(&shell, &marker, FULL, OFF, STRIPS), FULL, "still applied: the worker tries again");
        assert_eq!(switch(&shell, &marker, FULL, AUTO, STRIPS), FULL, "same for a style change");
        shell.gone.set(false);
        assert_eq!(switch(&shell, &marker, FULL, OFF, STRIPS), OFF);
        assert!(shell.shown.get() && shell.state.get() == ON_TOP && !marker.exists());
    }

    #[test]
    fn a_marker_deleted_by_an_old_guard_is_written_again() {
        let tmp = Tmp::new();
        let marker = marker_path(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        shell.drop_marker_at_hide.set(true);
        enable(&shell, &marker, true, STRIPS).unwrap();
        assert!(read_marker(&marker).is_some_and(|m| m.hidden && m.prev == ON_TOP), "enable ends with a marker");
        // The guard deletes it after enable: bars hidden, no marker - the next tick puts it back.
        shell.drop_marker_at_hide.set(false);
        std::fs::remove_file(&marker).unwrap();
        rehide(&shell, &marker, STRIPS).unwrap();
        assert!(read_marker(&marker).is_some_and(|m| m.hidden));
        assert!(!shell.shown.get());
        rehide(&shell, &marker, &[0x30]).unwrap();
        assert_eq!(read_marker(&marker).unwrap().appbars, [0x30], "a new monitor's strip reaches the marker");
    }

    #[test]
    fn a_dead_guard_is_replaced_a_few_times_then_given_up() {
        // C = "is this guard alive"; spawn hands out a live one.
        let (mut slot, mut spawns) = (None::<bool>, 0u8);
        let alive = |c: &mut bool| *c;
        assert!(keep_guard(&mut slot, &mut spawns, alive, || Some(true)));
        assert_eq!(spawns, 1);
        assert!(keep_guard(&mut slot, &mut spawns, alive, || panic!("alive: no new guard")));
        assert_eq!(spawns, 1);
        for _ in 1..GUARD_MAX_SPAWNS {
            slot = Some(false); // it died
            assert!(keep_guard(&mut slot, &mut spawns, alive, || Some(true)));
        }
        assert_eq!(spawns, GUARD_MAX_SPAWNS);
        slot = Some(false);
        assert!(!keep_guard(&mut slot, &mut spawns, alive, || panic!("budget spent")), "falls back, no spawn loop");
        let (mut slot, mut spawns) = (None::<bool>, 0u8);
        assert!(!keep_guard(&mut slot, &mut spawns, alive, || None), "a guard that does not start = no net");
    }
}
