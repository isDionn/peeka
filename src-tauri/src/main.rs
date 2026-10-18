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
mod pano;
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
        // Claude Code's hook (`peeka.exe --cc-hook`): forwards one sanitized event and exits, before Tauri starts.
        if args.get(1).map(String::as_str) == Some("--cc-hook") {
            plugins::cc_hook_main();
        }
        app::run();
    }
    #[cfg(not(windows))]
    eprintln!("Notch runs on Windows only.");
}
