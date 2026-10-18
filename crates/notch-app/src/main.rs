//! Notch: the strip, the island and the Windows taskbar's way back.
// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod commands;
#[cfg(windows)]
mod downloads;
mod extras;
#[cfg(windows)]
mod live;
#[cfg(windows)]
mod mirror;
#[cfg(windows)]
mod clip_history;
#[cfg(windows)]
mod plugins;
#[cfg(windows)]
mod taskbar;

fn main() {
    #[cfg(windows)]
    {
        // The guard (`peeka.exe --guard <pid>`) runs before Tauri: the single-instance plugin never sees it.
        let args: Vec<String> = std::env::args().collect();
        if let Some(code) = notch_win::taskbar::guard_main(&args) {
            std::process::exit(code);
        }
        // A coding agent's hook (`peeka.exe --cc-hook [agent [event]]`): forwards one sanitized event and exits, before Tauri starts.
        if args.get(1).map(String::as_str) == Some("--cc-hook") {
            plugins::cc_hook_main();
        }
        // A restart from Settings > About (`demo_restart`): the old Peeka must be gone first, or single-instance
        // sends this one away. If it cannot be watched or is still there after 15 s, start anyway: at worst
        // single-instance does just that.
        if let Some(pid) = notch_core::supervise::after_pid(&args) {
            notch_win::taskbar::wait_for_exit(pid, Some(15_000));
        }
        app::run();
    }
    #[cfg(not(windows))]
    eprintln!("Notch runs on Windows only.");
}
