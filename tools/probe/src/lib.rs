//! notch-probe: Peeka Wave 0 trial tool.
//!
//! Every state-changing command reverts by itself after `HOLD` (60 s). Before it changes anything it writes a marker
//! under `%LOCALAPPDATA%\PeekaProbe\`; every start (any command, except the guard child) first restores whatever
//! a marker says, so a crash or a Task Manager kill is undone by the next run or by `notch-probe restore`.
//! No network, no user files: the only files touched are the markers and `probe.log` in that folder.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub mod taskbar;
#[cfg(windows)]
mod win;
#[cfg(windows)]
mod winrt;

/// How long every state-changing command holds before it reverts by itself.
pub const HOLD: Duration = Duration::from_secs(60);
/// The AppBar strip height at 100 % scaling (30 px × DPI).
pub const STRIP_PX: i32 = 30;
pub const GUARD_CHILD_ARG: &str = "--guard-child";

/// One revert at a time: the Ctrl+C handler and a command's own revert never interleave.
static OPS: Mutex<()> = Mutex::new(());
/// Set by Ctrl+C / console close: from then on a command changes nothing more.
static EXITING: AtomicBool = AtomicBool::new(false);
static LOG: OnceLock<PathBuf> = OnceLock::new();

// ---------------------------------------------------------------- command line

#[derive(Debug, PartialEq, Eq)]
pub enum Cmd {
    Help,
    Restore,
    AppBar(bool),
    Guard,
    Hide(bool),
    Island,
    Tray,
    Radios,
    Topmost,
    VolKeys,
    Exclude,
    Smtc,
    Dpapi,
    /// The watchdog `guard` starts: `--guard-child <pid>`.
    GuardChild(u32),
}

impl Cmd {
    /// The guard child must not restore at start: that would undo the live parent it is watching.
    fn restores_first(&self) -> bool {
        !matches!(self, Cmd::GuardChild(_))
    }
}

pub const USAGE: &str = "notch-probe <command>

  restore        Undo everything left over (taskbar visible, AppBar removed, Wi-Fi/Bluetooth on)
  appbar on|off  A 30 px strip on top of every monitor (AppBar). off: removes a leftover strip
  guard          appbar on + a guard process (tries to give the 30 px back when the main process is killed)
  hide on|off    Hide the taskbar completely (full hide). off: bring it back
  island         A transparent sample island in the middle (click-through and focus trial)
  tray           Hidden-icons panel trial + tray mirror
  radios         Turns Wi-Fi and Bluetooth off for 5 s and back on
  topmost        Fullscreen game trial: wait 15 s, then an always-on-top strip for 4 s (3 times)
  volkeys        Captures the volume keys for 60 s
  exclude        A sample window excluded from screen capture (toggles every 5 s)
  smtc           Prints the playing track (read-only)
  dpapi          Encrypts and decrypts a fixed trial text

Every command that changes something undoes it by itself after 60 s. Ctrl+C undoes it too.
Log and marker files: %LOCALAPPDATA%\\PeekaProbe\\";

fn on_off(arg: Option<&str>, name: &str) -> Result<bool, String> {
    match arg {
        Some("on") => Ok(true),
        Some("off") => Ok(false),
        _ => Err(format!("write 'on' or 'off' for '{name}'")),
    }
}

/// `args` without the program name.
pub fn parse(args: &[String]) -> Result<Cmd, String> {
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    let cmd = match words.as_slice() {
        [] | ["--help"] | ["-h"] | ["help"] => Cmd::Help,
        ["restore"] => Cmd::Restore,
        ["appbar", rest @ ..] if rest.len() <= 1 => Cmd::AppBar(on_off(rest.first().copied(), "appbar")?),
        ["hide", rest @ ..] if rest.len() <= 1 => Cmd::Hide(on_off(rest.first().copied(), "hide")?),
        ["guard"] => Cmd::Guard,
        ["island"] => Cmd::Island,
        ["tray"] => Cmd::Tray,
        ["radios"] => Cmd::Radios,
        ["topmost"] => Cmd::Topmost,
        ["volkeys"] => Cmd::VolKeys,
        ["exclude"] => Cmd::Exclude,
        ["smtc"] => Cmd::Smtc,
        ["dpapi"] => Cmd::Dpapi,
        [GUARD_CHILD_ARG, pid] => Cmd::GuardChild(pid.parse().map_err(|_| "guard: invalid pid".to_string())?),
        _ => return Err(format!("Unknown command: {}", words.join(" "))),
    };
    Ok(cmd)
}

// ---------------------------------------------------------------- files and log

/// `%LOCALAPPDATA%\PeekaProbe`.
pub fn data_dir() -> Result<PathBuf, String> {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join("PeekaProbe"))
        .ok_or_else(|| "LOCALAPPDATA is not set".into())
}

pub fn taskbar_marker(dir: &Path) -> PathBuf {
    dir.join("taskbar.json")
}
pub fn appbar_marker(dir: &Path) -> PathBuf {
    dir.join("appbar.json")
}
pub fn radios_marker(dir: &Path) -> PathBuf {
    dir.join("radios.json")
}

/// One line to stdout and to `probe.log` (the guard child has no console: its lines only reach the file).
pub fn log(line: &str) {
    let stamped = format!("{} [{}] {line}", clock(), std::process::id());
    println!("{stamped}");
    if let Some(path) = LOG.get() {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{stamped}");
        }
    }
}

#[cfg(windows)]
fn clock() -> String {
    // SAFETY: GetLocalTime only fills a struct it returns.
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds
    )
}

#[cfg(not(windows))]
fn clock() -> String {
    String::new()
}

// ---------------------------------------------------------------- revert timer

/// The moment a command reverts by itself.
#[derive(Clone, Copy)]
pub struct Deadline(Instant);

impl Deadline {
    pub fn after(from: Instant, hold: Duration) -> Self {
        Self(from + hold)
    }
    /// Time left, None = revert now.
    pub fn left(&self, now: Instant) -> Option<Duration> {
        self.0.checked_duration_since(now).filter(|d| !d.is_zero())
    }
}

/// True from Ctrl+C / console close on: commands stop changing things.
pub fn exiting() -> bool {
    EXITING.load(Ordering::SeqCst)
}

pub(crate) fn ops() -> std::sync::MutexGuard<'static, ()> {
    OPS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `hide on`: hide completely, re-hide every `step` until `hold` is over, then put the bar back. `now` and `sleep` are
/// the clock (fakes in tests). The revert runs even when hiding failed half way.
pub fn hide_for(
    shell: &dyn taskbar::Shell,
    marker: &Path,
    hold: Duration,
    step: Duration,
    mut now: impl FnMut() -> Instant,
    mut sleep: impl FnMut(Duration),
) -> bool {
    let deadline = Deadline::after(now(), hold);
    {
        let _ops = ops();
        match taskbar::enable(shell, marker, true) {
            Ok(()) => log("Taskbar fully hidden (auto-hide + SW_HIDE). Marker written."),
            Err(error) => log(&format!("Hiding failed: {error}")),
        }
    }
    let mut came_back = 0u32;
    while let Some(left) = deadline.left(now()) {
        sleep(left.min(step));
        let _ops = ops();
        if exiting() {
            return false;
        }
        if shell.bars_visible() == Some(true) {
            came_back += 1;
            log("The taskbar reappeared (Win key, Explorer restart or a new monitor); hiding it again.");
        }
        if let Err(error) = taskbar::rehide(shell, marker) {
            log(&format!("Re-hiding failed: {error}"));
        }
    }
    let _ops = ops();
    let back = taskbar::restore(shell, marker);
    log(&format!(
        "60 s are up. Taskbar {}. It reappeared by itself {came_back} times meanwhile.",
        if back { "restored" } else { "NOT RESTORED (try notch-probe restore)" }
    ));
    back
}

// ---------------------------------------------------------------- AppBar marker

/// One registered strip: its window, the monitor's top edge and the strip's height in physical pixels.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bar {
    pub hwnd: isize,
    pub mon_top: i32,
    pub height: i32,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq, Eq)]
pub struct AppBarMarker {
    pub appbars: Vec<Bar>,
}

pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let dir = path.parent().ok_or("No marker folder")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_vec(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// None = no marker. A marker that cannot be read is Some(default): nothing known to undo, but it is deleted.
pub fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    Some(serde_json::from_slice(&bytes).unwrap_or_default())
}

/// `ABM_REMOVE` every strip the marker names (`remove` = the real call or a fake), then delete the marker.
/// Returns how many strips it named; None = there was no marker.
pub fn restore_appbars(marker: &Path, mut remove: impl FnMut(isize) -> bool) -> Option<usize> {
    let m: AppBarMarker = read_json(marker)?;
    for bar in &m.appbars {
        let sent = remove(bar.hwnd);
        log(&format!(
            "AppBar removal (ABM_REMOVE) window {:#x}: {}",
            bar.hwnd,
            if sent { "sent" } else { "could not be sent" }
        ));
    }
    let _ = std::fs::remove_file(marker);
    Some(m.appbars.len())
}

/// Is the space of any strip still reserved? `monitors` = (monitor top, work area top) for every monitor now.
pub fn still_reserved(bars: &[Bar], monitors: &[(i32, i32)]) -> bool {
    bars.iter().any(|bar| {
        monitors.iter().any(|&(mon_top, work_top)| mon_top == bar.mon_top && work_top >= mon_top + bar.height)
    })
}

/// The guard's clean-up: run the steps in order, stop at the first after which `reserved()` is false.
/// Returns the index of the step that worked, None = none did.
pub fn run_steps(steps: &mut [(&str, &mut dyn FnMut())], reserved: &mut dyn FnMut() -> bool) -> Option<usize> {
    for (i, (name, step)) in steps.iter_mut().enumerate() {
        log(&format!("Guard step {}: {name}", i + 1));
        step();
        if !reserved() {
            log(&format!("Guard step {} WORKED: the top 30 px are free.", i + 1));
            return Some(i);
        }
        log(&format!("After guard step {} the 30 px are still reserved.", i + 1));
    }
    None
}

// ---------------------------------------------------------------- tray

/// Is this taskbar button the "show hidden icons" arrow? The name is localised (owner: Turkish), the id is not stable.
pub fn looks_like_chevron(name: &str, automation_id: &str) -> bool {
    let (name, id) = (name.to_lowercase(), automation_id.to_lowercase());
    // "gizli" is the button name on a Turkish Windows.
    ["gizli", "hidden"].iter().any(|w| name.contains(w)) || ["chevron", "overflow"].iter().any(|w| id.contains(w))
}

/// One `Shell_NotifyIcon` call as it reaches a `Shell_TrayWnd` window in `WM_COPYDATA` (`dwData == 1`).
#[derive(Debug, PartialEq, Eq)]
pub struct TrayMsg {
    /// NIM_ADD 0, NIM_MODIFY 1, NIM_DELETE 2, NIM_SETFOCUS 3, NIM_SETVERSION 4.
    pub message: u32,
    pub hwnd: u32,
    pub uid: u32,
    pub flags: u32,
    pub callback: u32,
    /// Only when `flags` has NIF_TIP.
    pub tip: Option<String>,
    /// The `uVersion` union field (meaningful for NIM_SETVERSION).
    pub version: Option<u32>,
}

/// Layout (undocumented, RetroBar/ManagedShell): u32 signature 0x34753423, u32 NIM_*, then NOTIFYICONDATAW with 32-bit
/// handles: cbSize@8 hWnd@12 uID@16 uFlags@20 uCallbackMessage@24 hIcon@28 szTip[128]@32 dwState@288 dwStateMask@292
/// szInfo[256]@296 uVersion@808. Anything shorter or with another signature is not a tray message.
pub fn parse_tray(bytes: &[u8]) -> Option<TrayMsg> {
    const NIF_TIP: u32 = 4;
    let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    if u32_at(0)? != 0x3475_3423 || bytes.len() < 288 {
        return None;
    }
    let flags = u32_at(20)?;
    let tip = (flags & NIF_TIP != 0).then(|| {
        let units: Vec<u16> =
            bytes[32..288].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0).collect();
        String::from_utf16_lossy(&units)
    });
    Some(TrayMsg {
        message: u32_at(4)?,
        hwnd: u32_at(12)?,
        uid: u32_at(16)?,
        flags,
        callback: u32_at(24)?,
        tip,
        version: u32_at(808),
    })
}

// ---------------------------------------------------------------- radios marker

/// The radios that were on before `radios` turned them off: (kind as number, name).
#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq, Eq)]
pub struct RadiosMarker {
    pub on: Vec<(i32, String)>,
}

// ---------------------------------------------------------------- entry

/// Undo everything any marker remembers. Logs only what it found.
pub fn restore_all(dir: &Path) {
    #[cfg(windows)]
    {
        let tb = taskbar_marker(dir);
        if tb.exists() {
            let ok = taskbar::restore(&taskbar::Win32Shell, &tb);
            log(&format!(
                "Leftover taskbar marker found: taskbar {}.",
                if ok { "restored" } else { "NOT RESTORED (is Explorer running?)" }
            ));
        }
        if let Some(n) = restore_appbars(&appbar_marker(dir), win::appbar_remove) {
            log(&format!("Leftover AppBar marker found: removal sent for {n} strips."));
            win::log_work_areas();
        }
        let rm = radios_marker(dir);
        if rm.exists() {
            winrt::restore_radios(&rm);
        }
    }
    #[cfg(not(windows))]
    let _ = dir;
}

/// `main()`. Returns the process exit code.
pub fn run(args: &[String]) -> i32 {
    let cmd = match parse(args) {
        Ok(cmd) => cmd,
        Err(error) => {
            eprintln!("{error}\n\n{USAGE}");
            return 2;
        }
    };
    if cmd == Cmd::Help {
        println!("{USAGE}");
        return 0;
    }
    let dir = match data_dir() {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!("{error}");
            return 1;
        }
    };
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG.set(dir.join("probe.log"));
    log(&format!("---- notch-probe {} ----", args.join(" ")));
    if cmd.restores_first() {
        let _ops = ops();
        restore_all(&dir);
    }
    #[cfg(windows)]
    return win::dispatch(cmd, &dir);
    #[cfg(not(windows))]
    {
        let _ = cmd;
        eprintln!("notch-probe only runs on Windows.");
        1
    }
}

/// Ctrl+C / console close: stop, undo everything, end.
#[cfg(windows)]
pub(crate) fn on_ctrl(dir: &Path) {
    EXITING.store(true, Ordering::SeqCst);
    let _ops = ops();
    log("Ctrl+C or closing the window: everything is being undone.");
    restore_all(dir);
}

#[cfg(test)]
pub(crate) mod test_util {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    /// A fresh temp folder, deleted on drop (never the live `%LOCALAPPDATA%` one).
    pub struct Tmp(PathBuf);

    impl Tmp {
        pub fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "notch-probe-test-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        pub fn path(&self) -> &Path {
            &self.0
        }
        pub fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::taskbar::tests::{FakeShell, ON_TOP};
    use crate::taskbar::ABS_AUTOHIDE;
    use crate::test_util::Tmp;
    use std::cell::Cell;

    fn args(words: &[&str]) -> Vec<String> {
        words.iter().map(|w| w.to_string()).collect()
    }

    #[test]
    fn every_command_parses_and_nothing_else_does() {
        let ok = [
            (&[][..], Cmd::Help),
            (&["--help"][..], Cmd::Help),
            (&["restore"][..], Cmd::Restore),
            (&["appbar", "on"][..], Cmd::AppBar(true)),
            (&["appbar", "off"][..], Cmd::AppBar(false)),
            (&["hide", "on"][..], Cmd::Hide(true)),
            (&["hide", "off"][..], Cmd::Hide(false)),
            (&["guard"][..], Cmd::Guard),
            (&["island"][..], Cmd::Island),
            (&["tray"][..], Cmd::Tray),
            (&["radios"][..], Cmd::Radios),
            (&["topmost"][..], Cmd::Topmost),
            (&["volkeys"][..], Cmd::VolKeys),
            (&["exclude"][..], Cmd::Exclude),
            (&["smtc"][..], Cmd::Smtc),
            (&["dpapi"][..], Cmd::Dpapi),
            (&["--guard-child", "1234"][..], Cmd::GuardChild(1234)),
        ];
        for (words, want) in ok {
            assert_eq!(parse(&args(words)), Ok(want), "{words:?}");
        }
        for bad in [
            &["appbar"][..],
            &["appbar", "maybe"],
            &["hide", "on", "x"],
            &["nuke"],
            &["--guard-child", "x"],
            &["smtc", "extra"],
        ] {
            assert!(parse(&args(bad)).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn only_the_guard_child_skips_the_restore_at_start() {
        assert!(!Cmd::GuardChild(1).restores_first(), "it would undo the parent it watches");
        assert!(Cmd::Smtc.restores_first() && Cmd::Restore.restores_first() && Cmd::Guard.restores_first());
    }

    #[test]
    fn the_deadline_says_when_to_revert() {
        let t0 = Instant::now();
        let d = Deadline::after(t0, HOLD);
        assert_eq!(d.left(t0), Some(HOLD));
        assert_eq!(d.left(t0 + Duration::from_secs(59)), Some(Duration::from_secs(1)));
        assert_eq!(d.left(t0 + HOLD), None, "60 s exactly = revert");
        assert_eq!(d.left(t0 + Duration::from_secs(61)), None);
    }

    #[test]
    fn hide_reverts_by_itself_after_the_hold_and_rehides_meanwhile() {
        let tmp = Tmp::new();
        let marker = taskbar_marker(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        let t0 = Instant::now();
        let clock = Cell::new(t0);
        let mut slept = Duration::ZERO;
        let mut ticks = 0;
        let back = hide_for(
            &shell,
            &marker,
            HOLD,
            Duration::from_secs(1),
            || clock.get(),
            |d| {
                slept += d;
                ticks += 1;
                clock.set(clock.get() + d);
                if ticks == 10 {
                    shell.shown.set(true); // a Win-key peek in the middle
                }
                if ticks == 20 {
                    assert!(!shell.shown.get(), "re-hidden on the next tick");
                    assert!(marker.exists(), "the marker stays while hidden");
                }
            },
        );
        assert!(back);
        assert_eq!(slept, HOLD, "exactly the hold, then revert");
        assert_eq!(ticks, 60);
        assert!(shell.shown.get() && shell.state.get() == ON_TOP, "fully put back");
        assert!(!marker.exists());
    }

    #[test]
    fn a_hide_that_crashed_is_undone_by_the_next_start() {
        let tmp = Tmp::new();
        let marker = taskbar_marker(tmp.path());
        let shell = FakeShell::new(ON_TOP, &marker);
        taskbar::enable(&shell, &marker, true).unwrap(); // killed right after
        assert!(taskbar::read_marker(&marker).is_some_and(|m| m.hidden && m.prev == ON_TOP));
        let next = FakeShell::new(ON_TOP | ABS_AUTOHIDE, &marker);
        next.shown.set(false);
        assert!(taskbar::restore(&next, &marker));
        assert!(next.shown.get() && next.state.get() == ON_TOP && !marker.exists());
    }

    #[test]
    fn the_appbar_marker_round_trips_and_restore_removes_each_strip_once() {
        let tmp = Tmp::new();
        let marker = appbar_marker(tmp.path());
        assert_eq!(restore_appbars(&marker, |_| panic!("no marker, nothing to remove")), None);
        let bars = vec![Bar { hwnd: 0x1234, mon_top: 0, height: 30 }, Bar { hwnd: 0x5678, mon_top: 0, height: 45 }];
        write_json(&marker, &AppBarMarker { appbars: bars.clone() }).unwrap();
        assert_eq!(read_json::<AppBarMarker>(&marker), Some(AppBarMarker { appbars: bars }));
        let mut removed = vec![];
        assert_eq!(
            restore_appbars(&marker, |h| {
                removed.push(h);
                true
            }),
            Some(2)
        );
        assert_eq!(removed, vec![0x1234, 0x5678]);
        assert!(!marker.exists());
        assert_eq!(restore_appbars(&marker, |_| panic!("twice is harmless")), None);
    }

    #[test]
    fn a_corrupt_appbar_marker_is_deleted_without_guessing() {
        let tmp = Tmp::new();
        let marker = tmp.write("appbar.json", b"{oops");
        assert_eq!(restore_appbars(&marker, |_| panic!("nothing known")), Some(0));
        assert!(!marker.exists());
    }

    #[test]
    fn the_radios_marker_round_trips() {
        let tmp = Tmp::new();
        let marker = radios_marker(tmp.path());
        let m = RadiosMarker { on: vec![(1, "Wi-Fi".into()), (2, "Bluetooth".into())] };
        write_json(&marker, &m).unwrap();
        assert_eq!(read_json::<RadiosMarker>(&marker), Some(m));
    }

    #[test]
    fn reserved_space_is_seen_per_monitor() {
        let bars = [Bar { hwnd: 1, mon_top: 0, height: 30 }, Bar { hwnd: 2, mon_top: -1080, height: 45 }];
        assert!(still_reserved(&bars, &[(0, 30), (-1080, -1080)]));
        assert!(still_reserved(&bars, &[(0, 0), (-1080, -1035)]), "second monitor, 150 %");
        assert!(!still_reserved(&bars, &[(0, 0), (-1080, -1080)]));
        assert!(!still_reserved(&bars, &[(0, 10)]), "less than a strip is not ours");
    }

    #[test]
    fn the_overflow_arrow_is_found_by_name_or_id() {
        assert!(looks_like_chevron("Show hidden icons", ""));
        assert!(looks_like_chevron("Show Hidden Icons", ""));
        assert!(looks_like_chevron("", "SystemTrayOverflowChevron"));
        assert!(!looks_like_chevron("Discord", "NotifyItemIcon"));
    }

    #[test]
    fn a_tray_message_is_parsed_and_junk_is_refused() {
        let mut b = vec![0u8; 812];
        b[0..4].copy_from_slice(&0x3475_3423u32.to_le_bytes());
        b[4..8].copy_from_slice(&0u32.to_le_bytes()); // NIM_ADD
        b[12..16].copy_from_slice(&0xABCDu32.to_le_bytes());
        b[16..20].copy_from_slice(&7u32.to_le_bytes());
        b[20..24].copy_from_slice(&(1u32 | 4).to_le_bytes()); // NIF_MESSAGE | NIF_TIP
        b[24..28].copy_from_slice(&0x8001u32.to_le_bytes());
        for (i, u) in "Steam".encode_utf16().enumerate() {
            b[32 + i * 2..34 + i * 2].copy_from_slice(&u.to_le_bytes());
        }
        b[808..812].copy_from_slice(&4u32.to_le_bytes());
        let m = parse_tray(&b).unwrap();
        assert_eq!((m.message, m.hwnd, m.uid, m.callback, m.version), (0, 0xABCD, 7, 0x8001, Some(4)));
        assert_eq!(m.tip.as_deref(), Some("Steam"));
        b[20..24].copy_from_slice(&1u32.to_le_bytes());
        assert_eq!(parse_tray(&b).unwrap().tip, None, "no NIF_TIP, no tip");
        assert_eq!(parse_tray(&b[..300]).unwrap().version, None, "short = no version field");
        assert!(parse_tray(&b[..100]).is_none());
        b[0] = 0;
        assert!(parse_tray(&b).is_none(), "wrong signature (an AppBar message, dwData 0)");
    }

    #[test]
    fn the_guard_stops_at_the_first_step_that_frees_the_space() {
        let runs = Cell::new(0);
        let (mut a, mut b, mut c) =
            (|| runs.set(runs.get() + 1), || runs.set(runs.get() + 10), || panic!("never reached"));
        let mut steps: [(&str, &mut dyn FnMut()); 3] = [("one", &mut a), ("two", &mut b), ("three", &mut c)];
        let mut checks = 0;
        assert_eq!(
            run_steps(&mut steps, &mut || {
                checks += 1;
                checks < 2
            }),
            Some(1)
        );
        assert_eq!(runs.get(), 11);
        let mut none: [(&str, &mut dyn FnMut()); 1] = [("one", &mut || {})];
        assert_eq!(run_steps(&mut none, &mut || true), None);
    }
}
