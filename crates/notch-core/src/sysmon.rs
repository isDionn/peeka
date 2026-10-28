// Peeka — original implementation (MIT).
//! System monitor card numbers, platform-free: the tick the shell receives and the grouping rules that turn raw PDH
//! instance lists into one GPU percentage and one network rate. `notch-win::sysmon` feeds these.

use std::collections::HashMap;

use serde::Serialize;

/// One reading a second. A field Windows cannot give stays `None` (never guessed).
/// Percentages have one decimal; memory and disk are bytes; network is bytes per second.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysmonTick {
    pub cpu: Option<f32>,
    pub gpu: Option<f32>,
    pub mem_used: Option<u64>,
    pub mem_total: Option<u64>,
    pub down: Option<f64>,
    pub up: Option<f64>,
    pub disk_used: Option<u64>,
    pub disk_total: Option<u64>,
    pub uptime_s: Option<u64>,
    /// The program using the most processor now (every process of one exe added up), by exe name without `.exe`;
    /// None until the first measurement or when nothing passes `TOP_MIN_PERCENT`.
    pub top_cpu: Option<String>,
}

/// Below this share of the whole processor no program is named "the busiest".
pub const TOP_MIN_PERCENT: f64 = 1.0;
/// Names that are the machine's bookkeeping, never "the app that is tiring the computer".
const NOT_AN_APP: &[&str] = &["system idle process", "system", "registry", "memory compression", "secure system"];

/// Per-process processor time used in a window -> the busiest program. `samples` = (exe file name, time used in the
/// window in 100 ns units), one row per process: the processes of one exe (a browser's many) are added up.
/// `elapsed` = the window in 100 ns units, `cores` = logical processors. A share is of the whole processor.
pub fn top_process(samples: &[(String, u64)], elapsed: u64, cores: u32) -> Option<String> {
    if elapsed == 0 || cores == 0 {
        return None;
    }
    let mut per_exe: HashMap<String, (u64, &str)> = HashMap::new();
    for (name, used) in samples {
        let key = name.to_lowercase();
        if NOT_AN_APP.contains(&key.as_str()) {
            continue;
        }
        per_exe.entry(key).or_insert((0, name)).0 += used;
    }
    let (used, name) = per_exe.into_values().max_by_key(|(used, name)| (*used, std::cmp::Reverse(name.len())))?;
    let share = used as f64 * 100.0 / (elapsed as f64 * f64::from(cores));
    let app = name.strip_suffix(".exe").or_else(|| name.strip_suffix(".EXE")).unwrap_or(name);
    (share >= TOP_MIN_PERCENT).then(|| app.to_string())
}

/// `GetSystemTimes` totals in 100 ns units: (idle, kernel, user). Kernel time includes idle time.
pub type CpuTimes = (u64, u64, u64);

/// Total processor use between two readings, 0 to 100; None when the clock did not move.
pub fn cpu_percent(prev: CpuTimes, now: CpuTimes) -> Option<f32> {
    let (idle, kernel, user) = (now.0.wrapping_sub(prev.0), now.1.wrapping_sub(prev.1), now.2.wrapping_sub(prev.2));
    let total = kernel.checked_add(user).filter(|t| *t > 0)?;
    Some((total.saturating_sub(idle) as f64 * 100.0 / total as f64).clamp(0.0, 100.0) as f32)
}

pub const CPU_HIGH_PERCENT: f32 = 95.0;
/// How often the background check reads the total (one cheap kernel call each).
pub const CPU_SAMPLE_MS: u64 = 15_000;
/// How long it must stay at or above `CPU_HIGH_PERCENT` before `cpu_high` is said.
pub const CPU_HOLD_MS: u64 = 60_000;
/// After a `cpu_high`, the next one waits this long even if the load stays.
pub const CPU_COOLDOWN_MS: u64 = 10 * 60_000;

/// The background "processor is pinned" check (scenario 31): one reading every `CPU_SAMPLE_MS`, nothing else runs
/// in between. Platform-free; the caller reads `GetSystemTimes` when `due` and hands the totals to `feed`.
#[derive(Debug, Default)]
pub struct CpuWatch {
    /// The previous reading and when it was taken.
    prev: Option<(CpuTimes, u64)>,
    next_at: u64,
    since: Option<u64>,
    last_fire: Option<u64>,
}

impl CpuWatch {
    pub fn due(&self, now: u64) -> bool {
        now >= self.next_at
    }

    /// A reading. True = the load has held at or above `CPU_HIGH_PERCENT` for `CPU_HOLD_MS` (once per episode, and
    /// not within `CPU_COOLDOWN_MS` of the last one). A reading below the line starts the count over.
    pub fn feed(&mut self, times: CpuTimes, now: u64) -> bool {
        self.next_at = now + CPU_SAMPLE_MS;
        let Some((before, at)) = self.prev.replace((times, now)) else { return false };
        if cpu_percent(before, times).is_none_or(|p| p < CPU_HIGH_PERCENT) {
            self.since = None;
            return false;
        }
        // The reading covers the interval that began at the previous one.
        let since = *self.since.get_or_insert(at);
        let cooled = self.last_fire.is_none_or(|t| now.saturating_sub(t) >= CPU_COOLDOWN_MS);
        let fire = now.saturating_sub(since) >= CPU_HOLD_MS && cooled;
        if fire {
            self.last_fire = Some(now);
            self.since = None;
        }
        fire
    }
}

/// Nearest tenth, halves away from zero.
pub fn round1(v: f64) -> f32 {
    ((v * 10.0).round() / 10.0) as f32
}

/// "GPU Engine" samples `(instance, percent)` -> the busiest engine's total over all processes, capped at 100.
/// An instance name is `pid_<n>_luid_<adapter>_phys_<n>_eng_<n>_engtype_<kind>`; the engine is everything from
/// `luid` on (a name without `luid` is its own engine). Empty input = no GPU counter data = `None`.
pub fn gpu_usage(instances: &[(String, f64)]) -> Option<f64> {
    if instances.is_empty() {
        return None;
    }
    let mut per_engine: HashMap<&str, f64> = HashMap::new();
    for (name, value) in instances {
        if value.is_nan() {
            continue;
        }
        let engine = name.find("luid").map_or(name.as_str(), |at| &name[at..]);
        *per_engine.entry(engine).or_insert(0.0) += value;
    }
    Some(per_engine.into_values().fold(0.0, f64::max).min(100.0))
}

/// Adapter name fragments (lower case) whose traffic already crosses a physical adapter, so adding them counts it
/// twice: Hyper-V / WSL switches, loopback, old transition tunnels, VPN and tunnel drivers, Bluetooth PAN, the kernel
/// debugger NIC.
const NOT_PHYSICAL: &[&str] = &[
    "vethernet",
    "virtual",
    "loopback",
    "isatap",
    "teredo",
    "6to4",
    "pseudo-interface",
    "wan miniport",
    "tap-",
    "wireguard",
    "vpn",
    "tailscale",
    "zerotier",
    "bluetooth",
    "kernel debug",
];

/// "Network Interface" samples `(adapter name, bytes/s)` -> the physical adapters' sum (negatives count as 0).
pub fn network_total(instances: &[(String, f64)]) -> f64 {
    instances
        .iter()
        .filter(|(name, _)| {
            let name = name.to_lowercase();
            !NOT_PHYSICAL.iter().any(|frag| name.contains(frag))
        })
        .map(|(_, v)| v.max(0.0))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(list: &[(&str, f64)]) -> Vec<(String, f64)> {
        list.iter().map(|(n, v)| (n.to_string(), *v)).collect()
    }

    #[test]
    fn processes_on_one_engine_add_up_and_the_busiest_engine_wins() {
        let v = s(&[
            ("pid_4120_luid_0x00000000_0x0000C1A0_phys_0_eng_0_engtype_3D", 12.0),
            ("pid_9001_luid_0x00000000_0x0000C1A0_phys_0_eng_0_engtype_3D", 18.0),
            ("pid_9001_luid_0x00000000_0x0000C1A0_phys_0_eng_5_engtype_VideoEncode", 25.0),
        ]);
        assert_eq!(gpu_usage(&v), Some(30.0));
    }

    #[test]
    fn two_adapters_with_the_same_engine_number_are_two_engines() {
        let v = s(&[
            ("pid_10_luid_0x00000000_0x0000A001_phys_0_eng_0_engtype_3D", 40.0),
            ("pid_10_luid_0x00000000_0x0000B002_phys_0_eng_0_engtype_3D", 35.0),
        ]);
        assert_eq!(gpu_usage(&v), Some(40.0));
    }

    #[test]
    fn gpu_edges_empty_cap_no_luid_zero_and_nan() {
        assert_eq!(gpu_usage(&[]), None);
        let over =
            s(&[("pid_1_luid_0x1_phys_0_eng_0_engtype_3D", 70.0), ("pid_2_luid_0x1_phys_0_eng_0_engtype_3D", 60.0)]);
        assert_eq!(gpu_usage(&over), Some(100.0));
        assert_eq!(gpu_usage(&s(&[("odd_engine_name", 7.0)])), Some(7.0));
        assert_eq!(gpu_usage(&s(&[("pid_1_luid_a", 0.0), ("pid_2_luid_b", 0.0)])), Some(0.0));
        assert_eq!(gpu_usage(&s(&[("pid_1_luid_a", f64::NAN), ("pid_2_luid_a", 3.0)])), Some(3.0));
    }

    #[test]
    fn only_physical_adapters_count() {
        let v = s(&[
            ("Qualcomm Wi-Fi 7", 2400.0),
            ("Hyper-V Virtual Ethernet Adapter", 5000.0),
            ("WireGuard Tunnel", 3000.0),
            ("Loopback Pseudo-Interface 1", 9.0),
            ("Intel Ethernet I225-V", 600.0),
        ]);
        assert_eq!(network_total(&v), 3000.0);
        assert_eq!(network_total(&s(&[("Realtek PCIe GbE", -5.0)])), 0.0);
        assert_eq!(network_total(&s(&[("ISATAP.example", 10.0), ("TEREDO TUNNELING PSEUDO-INTERFACE", 20.0)])), 0.0);
        assert_eq!(network_total(&[]), 0.0);
    }

    #[test]
    fn round1_goes_to_the_nearest_tenth() {
        assert_eq!(round1(7.25), 7.3);
        assert_eq!(round1(7.249), 7.2);
        assert_eq!(round1(0.04), 0.0);
        assert_eq!(round1(99.96), 100.0);
    }

    #[test]
    fn an_empty_tick_is_ten_camel_case_nulls() {
        let json = serde_json::to_value(SysmonTick::default()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "cpu": null, "gpu": null, "memUsed": null, "memTotal": null, "down": null, "up": null,
                "diskUsed": null, "diskTotal": null, "uptimeS": null, "topCpu": null
            })
        );
    }

    fn procs(list: &[(&str, u64)]) -> Vec<(String, u64)> {
        list.iter().map(|(n, v)| (n.to_string(), *v)).collect()
    }

    #[test]
    fn the_busiest_program_adds_up_all_its_processes() {
        // 8 logical processors, a 10 s window = 100_000_000 units each; 100 % of the machine = 800_000_000.
        let window = 100_000_000;
        let v = procs(&[
            ("chrome.exe", 150_000_000),
            ("chrome.exe", 200_000_000),
            ("Chrome.exe", 100_000_000),
            ("Code.exe", 380_000_000),
            ("System Idle Process", 9_000_000_000),
            ("System", 700_000_000),
        ]);
        assert_eq!(top_process(&v, window, 8).as_deref(), Some("chrome"), "450 vs 380, idle and System never");
        assert_eq!(top_process(&procs(&[("a.exe", 1_000_000)]), window, 8), None, "0.1 % is nobody");
        assert_eq!(top_process(&[], window, 8), None);
        assert_eq!(top_process(&v, 0, 8), None);
        assert_eq!(top_process(&v, window, 0), None);
        assert_eq!(top_process(&procs(&[("svc", 400_000_000)]), window, 8).as_deref(), Some("svc"), "no .exe to cut");
    }

    #[test]
    fn total_cpu_is_busy_over_total_between_two_readings() {
        // kernel includes idle: 100 kernel, 60 of it idle, 100 user -> busy 140 of 200.
        assert_eq!(cpu_percent((0, 0, 0), (60, 100, 100)), Some(70.0));
        assert_eq!(cpu_percent((10, 20, 30), (10, 20, 30)), None, "the clock did not move");
        assert_eq!(cpu_percent((0, 0, 0), (0, 100, 0)), Some(100.0));
        assert_eq!(cpu_percent((0, 0, 0), (150, 100, 0)), Some(0.0), "never below zero");
    }

    /// A reading every 15 s whose busy share is `percent` of the 15 s that passed.
    fn feed(w: &mut CpuWatch, t: &mut CpuTimes, now: u64, percent: u64) -> bool {
        let total = 150_000 * 2; // kernel + user units for the window (the scale does not matter)
        let busy = total * percent / 100;
        t.1 += total / 2;
        t.2 += total / 2;
        t.0 += total - busy;
        w.feed(*t, now)
    }

    #[test]
    fn cpu_high_needs_sixty_seconds_at_or_above_95_and_says_it_once() {
        let (mut w, mut t) = (CpuWatch::default(), (0, 0, 0));
        assert!(w.due(0));
        assert!(!feed(&mut w, &mut t, 0, 100), "the first reading has nothing to compare with");
        assert!(!w.due(14_999) && w.due(15_000));
        let says: Vec<bool> = (1..=6).map(|i| feed(&mut w, &mut t, i * CPU_SAMPLE_MS, 99)).collect();
        assert_eq!(says, [false, false, false, true, false, false], "95 % held 60 s at the 4th reading, then once");
    }

    #[test]
    fn a_dip_below_95_starts_the_count_over_and_the_cooldown_holds() {
        let (mut w, mut t) = (CpuWatch::default(), (0, 0, 0));
        let mut now = 0;
        let mut run = |w: &mut CpuWatch, t: &mut CpuTimes, pcts: &[u64]| {
            pcts.iter()
                .map(|p| {
                    now += CPU_SAMPLE_MS;
                    feed(w, t, now, *p)
                })
                .collect::<Vec<_>>()
        };
        run(&mut w, &mut t, &[100]); // baseline
        assert_eq!(run(&mut w, &mut t, &[97, 97, 97, 80, 97, 97, 97]), [false; 7], "the dip reset it");
        assert_eq!(run(&mut w, &mut t, &[97, 97]), [true, false], "60 s since the dip ended");
        assert_eq!(run(&mut w, &mut t, &[97; 20]), [false; 20], "within the 10 minute cooldown");
        let later = run(&mut w, &mut t, &[97; 25]);
        assert_eq!(later.iter().filter(|x| **x).count(), 1, "after the cooldown it says it again, once");
    }
}
