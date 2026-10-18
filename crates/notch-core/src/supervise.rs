//! "Always on" (owner decision 2026-10-16): Notch starts with Windows (the per-user Run key) and the guard
//! (`peeka.exe --guard <pid>`) brings it back after a crash. Only the decisions live here; the registry, the wait
//! and the relaunch are in `notch_win::taskbar` / `notch_win::autostart`.
//!
//! Clean or not is one file, independent of the taskbar mode: `<data>/run/alive` is written at launch and removed
//! by a clean exit ("Quit", `RunEvent::Exit`, which tao also raises on `WM_ENDSESSION`) and by `WM_QUERYENDSESSION`.
//! Still there after Notch ended = it crashed or was killed.

use std::path::{Path, PathBuf};

/// Launched by the Run key or by the guard: start quietly.
pub const AUTOSTART_ARG: &str = "--autostart";
/// The value name under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
pub const RUN_VALUE_NAME: &str = "notch";
pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Back-off before relaunch number 1, 2, 3+ (counted over `HISTORY_MS`).
pub const BACKOFF_MS: [u64; 3] = [1_000, 5_000, 30_000];
/// This many crashes inside `STOP_WINDOW_MS` and the guard stops relaunching.
pub const STOP_AFTER: usize = 3;
pub const STOP_WINDOW_MS: u64 = 120_000;
/// Crashes older than this are forgotten (the back-off starts over at 1 s).
pub const HISTORY_MS: u64 = 600_000;

/// The Run key's data: the exe path always quoted (spaces in `Program Files`, `AppData\Local\Peeka App`).
pub fn run_value(exe: &Path) -> String {
    format!("\"{}\" {AUTOSTART_ARG}", exe.display())
}

pub fn is_autostart(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == AUTOSTART_ARG)
}

pub fn alive_path(data_dir: &Path) -> PathBuf {
    data_dir.join("run").join("alive")
}

pub fn crashes_path(data_dir: &Path) -> PathBuf {
    data_dir.join("run").join("crashes.json")
}

/// Written when the guard gives up; the next launch shows it as an alert and deletes it.
pub fn gave_up_path(data_dir: &Path) -> PathBuf {
    data_dir.join("run").join("stopped.txt")
}

pub const GAVE_UP_TEXT: &str =
    "Peeka closed 3 times in 2 minutes; it was not restarted. The Windows taskbar was restored.";

#[derive(Debug, PartialEq, Eq)]
pub enum Next {
    /// Clean quit or Windows is shutting down / logging off: nothing to do.
    Done,
    Relaunch {
        after_ms: u64,
    },
    /// Too many crashes: leave the Windows taskbar restored and write the reason file.
    GiveUp,
}

/// What the guard does after Notch ended. `crashed` = the alive file was still there; `history` = earlier crash
/// times (unix ms), pruned and extended in place when this one is a crash.
pub fn after_exit(crashed: bool, shutting_down: bool, history: &mut Vec<u64>, now_ms: u64) -> Next {
    if !crashed || shutting_down {
        return Next::Done;
    }
    history.retain(|&t| t <= now_ms && now_ms - t < HISTORY_MS);
    let recent = history.iter().filter(|&&t| now_ms - t < STOP_WINDOW_MS).count();
    let step = history.len().min(BACKOFF_MS.len() - 1);
    history.push(now_ms);
    if recent + 1 >= STOP_AFTER {
        Next::GiveUp
    } else {
        Next::Relaunch { after_ms: BACKOFF_MS[step] }
    }
}

pub fn read_history(path: &Path) -> Vec<u64> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn write_history(path: &Path, history: &[u64]) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, serde_json::to_vec(history).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::Tmp;

    #[test]
    fn the_run_value_quotes_the_path() {
        assert_eq!(run_value(Path::new(r"C:\peeka.exe")), r#""C:\peeka.exe" --autostart"#);
        assert_eq!(
            run_value(Path::new(r"C:\Users\Ali Veli\AppData\Local\Peeka App\peeka.exe")),
            r#""C:\Users\Ali Veli\AppData\Local\Peeka App\peeka.exe" --autostart"#
        );
        assert!(is_autostart(&["peeka.exe".into(), AUTOSTART_ARG.into()]));
        assert!(!is_autostart(&["peeka.exe".into()]));
        assert!(!is_autostart(&[AUTOSTART_ARG.into()]), "argv[0] is the exe, never a flag");
    }

    #[test]
    fn clean_quit_and_shutdown_never_relaunch() {
        let mut h = vec![];
        assert_eq!(after_exit(false, false, &mut h, 1_000_000), Next::Done);
        assert_eq!(after_exit(true, true, &mut h, 1_000_000), Next::Done, "a kill during logoff is not a crash");
        assert_eq!(after_exit(false, true, &mut h, 1_000_000), Next::Done);
        assert!(h.is_empty(), "nothing counted");
    }

    #[test]
    fn backoff_then_stop_after_three_in_two_minutes() {
        let mut h = vec![];
        let t = 10_000_000;
        assert_eq!(after_exit(true, false, &mut h, t), Next::Relaunch { after_ms: 1_000 });
        assert_eq!(after_exit(true, false, &mut h, t + 10_000), Next::Relaunch { after_ms: 5_000 });
        assert_eq!(after_exit(true, false, &mut h, t + 30_000), Next::GiveUp);
        assert_eq!(h.len(), 3);
    }

    #[test]
    fn slow_crashes_reach_thirty_seconds_and_old_ones_are_forgotten() {
        let mut h = vec![];
        let t = 10_000_000;
        after_exit(true, false, &mut h, t);
        after_exit(true, false, &mut h, t + 130_000);
        // Third crash 4 min in: only one other inside 2 min, so no stop; two in the last 10 min -> 30 s.
        assert_eq!(after_exit(true, false, &mut h, t + 240_000), Next::Relaunch { after_ms: 30_000 });
        // An hour later the history is gone: back to 1 s.
        assert_eq!(after_exit(true, false, &mut h, t + 3_600_000), Next::Relaunch { after_ms: 1_000 });
        assert_eq!(h, [t + 3_600_000]);
    }

    #[test]
    fn a_clock_set_back_drops_future_entries() {
        let mut h = vec![50_000_000, 50_001_000];
        assert_eq!(after_exit(true, false, &mut h, 1_000), Next::Relaunch { after_ms: 1_000 });
    }

    #[test]
    fn history_round_trip_and_a_bad_file_is_empty() {
        let tmp = Tmp::new();
        let path = crashes_path(tmp.path());
        assert!(read_history(&path).is_empty());
        write_history(&path, &[1, 2]);
        assert_eq!(read_history(&path), [1, 2]);
        tmp.write("run/crashes.json", b"{nope");
        assert!(read_history(&path).is_empty());
    }
}
