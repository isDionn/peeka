// Peeka — original implementation (MIT).
//! Two cheap processor readings (scenario 31); what they mean is `notch_core::sysmon` (tested there).
//! - `system_times`: `GetSystemTimes`, three numbers from the kernel, no handle, no allocation. The background
//!   "pinned" check reads it every 15 s and nothing else runs in between.
//! - `snapshot` / `top`: which program is using the most. Reads every process's processor time (a Toolhelp list and
//!   one `GetProcessTimes` each), so it runs only when the sysmon card is open or when `cpu_high` is about to be said,
//!   never as a standing poll. Names only; nothing is read from inside a process.

use notch_core::sysmon::CpuTimes;

#[cfg(windows)]
fn ticks(t: windows::Win32::Foundation::FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}

/// (idle, kernel, user) since boot in 100 ns units; None if Windows refuses.
#[cfg(windows)]
pub fn system_times() -> Option<CpuTimes> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    // SAFETY: three out-pointers to our own locals.
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.ok()?;
    Some((ticks(idle), ticks(kernel), ticks(user)))
}

/// Logical processors Windows schedules on (never 0).
pub fn cores() -> u32 {
    std::thread::available_parallelism().map_or(1, |n| n.get() as u32)
}

/// Every process's exe name and the processor time it has used so far (100 ns units).
#[cfg(windows)]
pub struct Snapshot(std::collections::HashMap<u32, (String, u64)>);

#[cfg(windows)]
pub fn snapshot() -> Snapshot {
    use windows::Win32::Foundation::{CloseHandle, FILETIME};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    let mut out = std::collections::HashMap::new();
    // SAFETY: a snapshot handle closed below; the entry carries its own size as Toolhelp requires; each process
    // handle is opened read-only (limited query) and closed right after its times are read.
    unsafe {
        let Ok(list) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return Snapshot(out) };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut more = Process32FirstW(list, &mut entry).is_ok();
        while more {
            let pid = entry.th32ProcessID;
            if pid != 0 {
                if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    let (mut created, mut exited, mut kernel, mut user) =
                        (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
                    if GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user).is_ok() {
                        out.insert(pid, (crate::wide_to_string(&entry.szExeFile), ticks(kernel) + ticks(user)));
                    }
                    let _ = CloseHandle(h);
                }
            }
            more = Process32NextW(list, &mut entry).is_ok();
        }
        let _ = CloseHandle(list);
    }
    Snapshot(out)
}

/// The busiest program between two snapshots `elapsed_ms` apart. A process that is in only one of them (started or
/// ended in between) is skipped.
#[cfg(windows)]
pub fn top(before: &Snapshot, after: &Snapshot, elapsed_ms: u64) -> Option<String> {
    let used: Vec<(String, u64)> = after
        .0
        .iter()
        .filter_map(|(pid, (name, now))| {
            let (_, was) = before.0.get(pid)?;
            Some((name.clone(), now.saturating_sub(*was)))
        })
        .collect();
    notch_core::sysmon::top_process(&used, elapsed_ms * 10_000, cores())
}

/// One measurement that waits `window` between its two snapshots (blocks the calling thread; call it from a spawned
/// one).
#[cfg(windows)]
pub fn top_blocking(window: std::time::Duration) -> Option<String> {
    let (first, t0) = (snapshot(), std::time::Instant::now());
    std::thread::sleep(window);
    let second = snapshot();
    top(&first, &second, t0.elapsed().as_millis() as u64)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn the_kernel_gives_three_numbers_that_only_grow() {
        let a = system_times().expect("GetSystemTimes");
        std::thread::sleep(Duration::from_millis(30));
        let b = system_times().unwrap();
        assert!(b.1 + b.2 >= a.1 + a.2 && b.0 >= a.0);
        assert!(cores() >= 1);
    }

    #[test]
    fn a_snapshot_lists_this_test_process() {
        let me = std::process::id();
        assert!(snapshot().0.contains_key(&me));
    }

    /// Real machine, by hand: `cargo test -p notch-win --lib -- --ignored live_cpu --nocapture`.
    /// Measures what the background check and the top-process read cost, so the "under 0.1 %" claim is a number.
    #[test]
    #[ignore]
    fn live_cpu_cost() {
        const N: u32 = 2000;
        let t = Instant::now();
        for _ in 0..N {
            std::hint::black_box(system_times());
        }
        let per_call = t.elapsed() / N;
        // The background check: one call every 15 s.
        let background_pct = per_call.as_secs_f64() / 15.0 * 100.0;
        eprintln!("system_times: {per_call:?} per call, background check = {background_pct:.7} % of one core");

        const M: u32 = 20;
        let t = Instant::now();
        let mut last = None;
        for _ in 0..M {
            last = Some(snapshot());
        }
        let per_snapshot = t.elapsed() / M;
        let count = last.as_ref().map_or(0, |s| s.0.len());
        eprintln!("snapshot: {per_snapshot:?} for {count} processes");
        // The sysmon card's top-process, one snapshot every 10 s while the card is open.
        let card_pct = per_snapshot.as_secs_f64() / 10.0 * 100.0;
        eprintln!("card open, a snapshot every 10 s = {card_pct:.4} % of one core");
        // The cpu_high episode: two snapshots, once per episode (cooldown 10 min).
        let episode_pct = 2.0 * per_snapshot.as_secs_f64() / 600.0 * 100.0;
        eprintln!("cpu_high episode (2 snapshots per 10 min at most) = {episode_pct:.5} % of one core");
        eprintln!("top over 1 s right now: {:?}", top_blocking(Duration::from_secs(1)));
        assert!(background_pct < 0.1, "the standing background check must stay under 0.1 %");
    }
}
