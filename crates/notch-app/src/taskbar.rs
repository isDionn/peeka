//! The taskbar worker (logic in `notch_core::taskbar`, Win32 in
//! `notch_win::taskbar`). The wanted mode comes from Notch's own settings file.
//! Kept as-is: the main-thread heartbeat (a frozen Notch puts the bars back), full -> auto when
//! the emergency key or the guard is missing, guard restarts, the marker re-written after an old guard deleted it,
//! `ShowWindowAsync`, and `EXITING` (nothing re-hides during shutdown).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use notch_core::settings::HideMode;
use notch_core::taskbar::{self as logic, AUTO, FROZEN, FULL, OFF, UNKNOWN};
use notch_win::taskbar::Win32Shell;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// When Explorer last announced a new taskbar (`TaskbarCreated`), ms on `CLOCK` + 1; 0 = never. The worker checks
/// every 100 ms for two seconds after it (`logic::rehide_wait`), else every 2 s as a backstop: a bar Explorer shows again
/// (Win-key peek, new monitor) wakes it at once (`taskbar_shown`).
static CREATED: AtomicU64 = AtomicU64::new(0);

/// What the settings say (UNKNOWN until read).
static WANT: AtomicU8 = AtomicU8::new(UNKNOWN);
/// The emergency key was pressed: the mode stays off until the owner sets a mode again.
static SUSPENDED: AtomicBool = AtomicBool::new(false);
/// Set by the exit path: from then on `apply()` changes nothing.
static EXITING: AtomicBool = AtomicBool::new(false);
/// The main thread's last heartbeat, ms on `CLOCK`.
static BEAT: AtomicU64 = AtomicU64::new(0);
static CLOCK: OnceLock<Instant> = OnceLock::new();
/// One taskbar change at a time: the worker and the exit path never interleave.
static OPS: Mutex<()> = Mutex::new(());
static WORKER: OnceLock<thread::Thread> = OnceLock::new();
static MARKER: OnceLock<PathBuf> = OnceLock::new();
/// The strips' window handles, written into the marker (the guard's `ABM_REMOVE` list).
static APPBARS: Mutex<Vec<isize>> = Mutex::new(Vec::new());

fn now_ms() -> u64 {
    CLOCK.get_or_init(Instant::now).elapsed().as_millis() as u64
}

fn wake() {
    if let Some(worker) = WORKER.get() {
        worker.unpark();
    }
}

/// Explorer announced a new taskbar (restart): re-hide at once, then retry quickly while it finishes starting.
pub fn taskbar_created() {
    CREATED.store(now_ms() + 1, Ordering::SeqCst);
    wake();
}

/// When a taskbar-shown event last woke the worker (ms on `CLOCK`).
static SHOWN: AtomicU64 = AtomicU64::new(0);

/// Explorer showed a taskbar window (`notch_win::foreground`): re-hide now. At most every 250 ms (the old poll's pace),
/// so an Explorer that keeps showing it cannot spin the worker; the 2 s backstop catches the rest.
pub fn taskbar_shown() {
    let now = now_ms();
    if now.saturating_sub(SHOWN.load(Ordering::SeqCst)) >= 250 {
        SHOWN.store(now, Ordering::SeqCst);
        wake();
    }
}

/// When Explorer last (re)created the taskbar (0 = not since launch). A new Explorer forgets every AppBar, so the
/// app tick re-reserves the strips when this changes (VM run 2: the 30 px were gone for good after a restart).
pub fn created_at() -> u64 {
    CREATED.load(Ordering::SeqCst)
}

/// The strips changed (launch, monitor change): the strips file gets them now, in every mode (the guard frees the
/// AppBars after a crash in "leave alone" too); the next tick writes them into the marker when there is one.
pub fn set_appbars(handles: Vec<isize>) {
    if let Some(marker) = MARKER.get() {
        if let Err(error) = logic::write_strips(&logic::strips_path(marker), &handles) {
            eprintln!("[taskbar] {error}");
        }
    }
    *APPBARS.lock() = handles;
    wake();
}

/// A clean exit removed the AppBars itself: nothing left for the guard to free.
pub fn forget_strips() {
    if let Some(marker) = MARKER.get() {
        let _ = std::fs::remove_file(logic::strips_path(marker));
    }
}

/// The settings' mode. A suspended mode (emergency) stays off until the owner picks a mode by hand.
pub fn apply(mode: HideMode, by_hand: bool) {
    if EXITING.load(Ordering::SeqCst) {
        return;
    }
    if by_hand {
        SUSPENDED.store(false, Ordering::SeqCst);
    }
    let want = if SUSPENDED.load(Ordering::SeqCst) { OFF } else { logic::want_of(mode) };
    // Peeka's Start takes the Win key only while Windows's taskbar is hidden (restored = Windows's Start again).
    #[cfg(windows)]
    notch_win::winkey::set_on(want != OFF);
    if WANT.swap(want, Ordering::SeqCst) != want {
        wake();
    }
}

/// The exit path (`ExitRequested`, `Exit`, a panic): put the bar back now and keep the mode off.
pub fn restore_now() {
    EXITING.store(true, Ordering::SeqCst);
    put_back();
}

/// Put the bar back now, on the calling thread. Bounded wait for the lock: a panic inside a change must not hang.
fn put_back() {
    WANT.store(OFF, Ordering::SeqCst);
    #[cfg(windows)]
    notch_win::winkey::set_on(false);
    let Some(marker) = MARKER.get() else { return };
    if let Some(_guard) = OPS.try_lock_for(Duration::from_millis(500)) {
        logic::restore(&Win32Shell, marker);
    }
}

/// The emergency key, "Restore taskbar" (Start panel, strip right-click): the bar comes back now and the
/// mode goes off in the settings file too, so the next launch does not hide it again.
pub fn emergency(app: &AppHandle) {
    SUSPENDED.store(true, Ordering::SeqCst);
    put_back();
    wake();
    let notch = app.try_state::<crate::app::Notch>();
    let saved = notch.as_ref().is_some_and(|n| n.set_hide_mode(HideMode::Off).is_ok());
    if let Some(n) = notch {
        let _ = app.emit("settings_changed", crate::commands::ui_settings(&n));
    }
    crate::app::notice(
        app,
        if saved {
            "Taskbar restored; hiding is off."
        } else {
            "Taskbar restored. Hiding is off for this session; settings could not be saved."
        },
    );
}

/// Starts the worker. `emergency_key` = the emergency key (or its spare) is registered.
pub fn init(app: &AppHandle, data_dir: &std::path::Path, emergency_key: bool) {
    let marker = logic::marker_path(data_dir);
    let _ = MARKER.set(marker.clone());
    notch_win::foreground::on_taskbar_shown(taskbar_shown);
    // `layout` made the strips before this ran: their handles go into the strips file now.
    let strips = APPBARS.lock().clone();
    set_appbars(strips);

    // Only where a panic ends the process (release: `panic = "abort"`).
    #[cfg(panic = "abort")]
    {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            restore_now();
            previous(info);
        }));
    }

    let handle = app.clone();
    let worker = thread::spawn(move || {
        let body = || {
            let mut applied = UNKNOWN;
            let mut warned = false;
            let mut frozen_since: Option<u64> = None;
            loop {
                let asked = WANT.load(Ordering::SeqCst);
                if asked == FULL {
                    if !matches!(applied, FULL | FROZEN) {
                        BEAT.store(now_ms(), Ordering::SeqCst); // entering full: count from now
                    }
                    // Non-blocking (an event-loop proxy post); a frozen main thread just never runs it.
                    let _ = handle.run_on_main_thread(|| BEAT.store(now_ms(), Ordering::SeqCst));
                }
                // The guard starts before the first bar is hidden.
                let safe = emergency_key && (asked != FULL || notch_win::taskbar::ensure_guard());
                let target = logic::effective(asked, safe, logic::stale(BEAT.load(Ordering::SeqCst), now_ms()));
                if asked == FULL && target == AUTO && !warned {
                    warned = true;
                    crate::app::notice(
                        &handle,
                        if emergency_key {
                            "The taskbar guard is not running; the taskbar is auto-hidden instead of fully hidden."
                        } else {
                            "The emergency shortcut (Ctrl+Alt+Shift+T or G) could not be registered; the taskbar is auto-hidden instead of fully hidden."
                        },
                    );
                }
                let appbars = APPBARS.lock().clone();
                if target != UNKNOWN && target != applied {
                    let _guard = OPS.lock();
                    let target = if EXITING.load(Ordering::SeqCst) { OFF } else { target };
                    applied = logic::switch(&Win32Shell, &marker, applied, target, &appbars);
                } else if applied == FULL {
                    let _guard = OPS.lock();
                    if WANT.load(Ordering::SeqCst) == FULL && !EXITING.load(Ordering::SeqCst) {
                        if let Err(error) = logic::rehide(&Win32Shell, &marker, &appbars) {
                            eprintln!("[taskbar] {error}");
                        }
                    }
                }
                // Still frozen after the bars came back: end, so the guard starts a fresh Notch (its crash budget applies).
                // Release only: dev builds are never relaunched.
                frozen_since = (applied == FROZEN).then(|| frozen_since.unwrap_or_else(now_ms));
                if logic::restart_frozen(frozen_since, now_ms()) && !cfg!(debug_assertions) {
                    eprintln!("[taskbar] main thread frozen; ending so the guard restarts Notch");
                    notch_win::taskbar::end_now();
                }
                // Full ticks (re-hide, heartbeat, guard); a failed change retries; otherwise sleep until woken.
                if asked == FULL || (target != UNKNOWN && target != applied) {
                    let created = CREATED.load(Ordering::SeqCst).checked_sub(1);
                    thread::park_timeout(logic::rehide_wait(created, now_ms()));
                } else {
                    thread::park();
                }
            }
        };
        // Also where a panic does not end the process (dev builds): a dead worker must not leave the bars hidden.
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(body)).is_err() {
            eprintln!("[taskbar] worker panicked; putting the taskbar back");
            put_back();
        }
    });
    let _ = WORKER.set(worker.thread().clone());
}
