// Peeka — original implementation (MIT).
//! The system monitor card's sampler: one `SysmonTick` a second while the card is open, nothing at all while it is
//! closed. The PDH query lives and dies on the sampler thread. A generation counter retires an old
//! sampler after a quick stop + start, so only one ever feeds the sink.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use notch_core::sysmon::SysmonTick;

/// Start/stop state, separate from PDH so the lifecycle rules are testable anywhere.
struct Life {
    generation: AtomicU64,
    running: AtomicBool,
    period: Duration,
}

/// How often a sleeping sampler looks at the generation (so `stop` takes effect well within a period).
const CHECK: Duration = Duration::from_millis(50);

impl Life {
    const fn new(period: Duration) -> Self {
        Self { generation: AtomicU64::new(0), running: AtomicBool::new(false), period }
    }

    /// `open` runs on the new thread and returns the per-tick reader (None = could not start: give up quietly).
    fn start<S, R>(&'static self, sink: impl Fn(SysmonTick) + Send + 'static, open: S)
    where
        S: FnOnce() -> Option<R> + Send + 'static,
        R: FnMut() -> SysmonTick,
    {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let mine = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            let current = || self.generation.load(Ordering::SeqCst) == mine;
            let Some(mut sample) = open() else {
                if current() {
                    self.running.store(false, Ordering::SeqCst);
                }
                return;
            };
            loop {
                let mut waited = Duration::ZERO;
                while waited < self.period {
                    let step = CHECK.min(self.period - waited);
                    std::thread::sleep(step);
                    waited += step;
                    if !current() {
                        return;
                    }
                }
                let tick = sample();
                if !current() {
                    return;
                }
                sink(tick);
            }
        });
    }

    fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
    }
}

static LIFE: Life = Life::new(Duration::from_secs(1));

/// The card opened: ticks to `sink` (on the sampler thread) every second. Harmless while already running.
pub fn start(sink: impl Fn(SysmonTick) + Send + 'static) {
    LIFE.start(sink, open);
}

/// The card closed (or the app exits): the sampler ends within a moment. Never blocks; harmless when idle.
pub fn stop() {
    LIFE.stop();
}

/// Used physical memory from total and available, never below zero.
fn used_memory(total: u64, available: u64) -> u64 {
    total.saturating_sub(available)
}

#[cfg(not(windows))]
fn open() -> Option<fn() -> SysmonTick> {
    None
}

#[cfg(windows)]
fn open() -> Option<impl FnMut() -> SysmonTick> {
    let pdh = pdh::Query::open()?;
    let mut top = TopTracker::default();
    Some(move || SysmonTick { top_cpu: top.next(), ..pdh.tick() })
}

/// "Which program is busiest" for the card: a baseline snapshot on the first tick, the first answer on the 4th,
/// then one snapshot every `TOP_EVERY` ticks (a snapshot costs ~13 ms in a debug build, measured by
/// `cpu::tests::live_cpu_cost`, so every 10 s stays near 0.1 % of one core); the answer is kept in between. Lives on
/// the sampler thread, so it exists only while the card is open.
#[cfg(windows)]
#[derive(Default)]
struct TopTracker {
    ticks: u32,
    prev: Option<(crate::cpu::Snapshot, std::time::Instant)>,
    last: Option<String>,
}

#[cfg(windows)]
const TOP_EVERY: u32 = 10;

#[cfg(windows)]
impl TopTracker {
    fn next(&mut self) -> Option<String> {
        self.ticks += 1;
        let measure = self.ticks == 1 || self.ticks == 4 || (self.ticks > 4 && (self.ticks - 4) % TOP_EVERY == 0);
        if !measure {
            return self.last.clone();
        }
        let (now, at) = (crate::cpu::snapshot(), std::time::Instant::now());
        if let Some((before, was)) = self.prev.replace((now, at)) {
            let after = &self.prev.as_ref().expect("just set").0;
            self.last = crate::cpu::top(&before, after, at.duration_since(was).as_millis() as u64);
        }
        self.last.clone()
    }
}

#[cfg(windows)]
mod pdh {
    use notch_core::sysmon::{gpu_usage, network_total, round1, SysmonTick};
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhGetFormattedCounterValue, PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT,
        PDH_FMT_COUNTERVALUE, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
    };
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};

    /// pdh.h's PDH_FMT_NOCAP100 (not in the windows crate): percentages may pass 100 (CPU utility under turbo).
    const NOCAP100: u32 = 0x0000_8000;
    const FORMAT: PDH_FMT = PDH_FMT(PDH_FMT_DOUBLE.0 | NOCAP100);

    /// One PDH query with its counters; a counter that could not be added stays None for every tick.
    pub(super) struct Query {
        query: PDH_HQUERY,
        cpu: Option<PDH_HCOUNTER>,
        gpu: Option<PDH_HCOUNTER>,
        down: Option<PDH_HCOUNTER>,
        up: Option<PDH_HCOUNTER>,
    }

    impl Query {
        /// Opens the query, adds the counters by their English paths and takes the first sample (rates need two).
        pub(super) fn open() -> Option<Self> {
            let mut query = PDH_HQUERY::default();
            // SAFETY: no data source (live counters), out-pointer to our local.
            if unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut query) } != 0 {
                return None;
            }
            let add = |path: PCWSTR| {
                let mut counter = PDH_HCOUNTER::default();
                // SAFETY: our open query, a static NUL-terminated path, out-pointer to our local.
                (unsafe { PdhAddEnglishCounterW(query, path, 0, &mut counter) } == 0).then_some(counter)
            };
            let cpu = add(w!("\\Processor Information(_Total)\\% Processor Utility"))
                .or_else(|| add(w!("\\Processor(_Total)\\% Processor Time")));
            let q = Self {
                query,
                cpu,
                gpu: add(w!("\\GPU Engine(*)\\Utilization Percentage")),
                down: add(w!("\\Network Interface(*)\\Bytes Received/sec")),
                up: add(w!("\\Network Interface(*)\\Bytes Sent/sec")),
            };
            // SAFETY: our open query.
            unsafe { PdhCollectQueryData(q.query) };
            Some(q)
        }

        pub(super) fn tick(&self) -> SysmonTick {
            // SAFETY: our open query. A failed collect leaves every read below failing, i.e. None fields.
            unsafe { PdhCollectQueryData(self.query) };
            let memory = memory();
            let disk = disk();
            SysmonTick {
                cpu: self.cpu.and_then(value).filter(|v| !v.is_nan()).map(|v| round1(v.clamp(0.0, 100.0))),
                gpu: self.gpu.and_then(array).and_then(|items| gpu_usage(&items)).map(round1),
                mem_used: memory.map(|(used, _)| used),
                mem_total: memory.map(|(_, total)| total),
                down: self.down.and_then(array).map(|items| network_total(&items)),
                up: self.up.and_then(array).map(|items| network_total(&items)),
                disk_used: disk.map(|(used, _)| used),
                disk_total: disk.map(|(_, total)| total),
                // SAFETY: reads the system's monotonic boot timer and has no inputs or ownership.
                uptime_s: Some(unsafe { GetTickCount64() / 1000 }),
                top_cpu: None, // the sampler's `TopTracker` fills it
            }
        }
    }

    impl Drop for Query {
        fn drop(&mut self) {
            // SAFETY: our open query, closed once (counters go with it).
            unsafe { PdhCloseQuery(self.query) };
        }
    }

    fn valid(status: u32) -> bool {
        status == PDH_CSTATUS_VALID_DATA || status == PDH_CSTATUS_NEW_DATA
    }

    fn value(counter: PDH_HCOUNTER) -> Option<f64> {
        let mut v = PDH_FMT_COUNTERVALUE::default();
        // SAFETY: a counter of our query, out-pointer to our local.
        if unsafe { PdhGetFormattedCounterValue(counter, FORMAT, None, &mut v) } != 0 || !valid(v.CStatus) {
            return None;
        }
        // SAFETY: FORMAT asked for doubles, so the double member is the one written.
        Some(unsafe { v.Anonymous.doubleValue })
    }

    /// A wildcard counter's `(instance, value)` pairs. None = the read failed (not "zero instances").
    fn array(counter: PDH_HCOUNTER) -> Option<Vec<(String, f64)>> {
        let (mut bytes, mut count) = (0u32, 0u32);
        // SAFETY: size query: no buffer, out-pointers to our locals.
        if unsafe { PdhGetFormattedCounterArrayW(counter, FORMAT, &mut bytes, &mut count, None) } != PDH_MORE_DATA {
            return None;
        }
        // Items first, their names after them in the same buffer: a Vec of items keeps the item alignment.
        let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
        let mut buf = vec![PDH_FMT_COUNTERVALUE_ITEM_W::default(); (bytes as usize).div_ceil(item).max(1)];
        let mut bytes = (buf.len() * item) as u32;
        // SAFETY: the buffer holds `bytes` bytes, aligned for the item type.
        if unsafe { PdhGetFormattedCounterArrayW(counter, FORMAT, &mut bytes, &mut count, Some(buf.as_mut_ptr())) } != 0
        {
            return None;
        }
        let items = buf.get(..count as usize)?;
        Some(
            items
                .iter()
                .filter(|it| valid(it.FmtValue.CStatus))
                .filter_map(|it| {
                    // SAFETY: PDH points szName at a NUL-terminated string inside `buf`, alive here.
                    let name = unsafe { it.szName.to_string() }.ok()?;
                    // SAFETY: doubles requested, as in `value`.
                    Some((name, unsafe { it.FmtValue.Anonymous.doubleValue }))
                })
                .collect(),
        )
    }

    /// (used, total) physical memory in bytes.
    fn memory() -> Option<(u64, u64)> {
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        // SAFETY: a sized struct of ours.
        unsafe { GlobalMemoryStatusEx(&mut m) }.ok()?;
        Some((super::used_memory(m.ullTotalPhys, m.ullAvailPhys), m.ullTotalPhys))
    }

    /// (used, total) bytes on the system drive. The shell itself is Windows-only, so C: is the system drive.
    fn disk() -> Option<(u64, u64)> {
        let (mut free, mut total) = (0u64, 0u64);
        // SAFETY: static NUL-terminated path and valid out-pointers to our locals.
        unsafe { GetDiskFreeSpaceExW(w!("C:\\"), None, Some(&mut total), Some(&mut free)).ok()? };
        Some((total.saturating_sub(free), total))
    }

    #[cfg(test)]
    mod tests {
        /// Real machine, by hand: `cargo test -p notch-win --lib -- --ignored live_pdh`.
        #[test]
        #[ignore]
        fn live_pdh_numbers_are_sane() {
            let q = super::Query::open().expect("PDH query");
            std::thread::sleep(std::time::Duration::from_secs(1));
            let t = q.tick();
            let cpu = t.cpu.expect("cpu");
            assert!((0.0..=100.0).contains(&cpu));
            let (used, total) = (t.mem_used.unwrap(), t.mem_total.unwrap());
            assert!(total > 0 && used <= total);
            eprintln!("{t:?}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    const P: Duration = Duration::from_millis(100);

    fn leak(period: Duration) -> &'static Life {
        Box::leak(Box::new(Life::new(period)))
    }

    fn counter() -> (Arc<AtomicUsize>, impl Fn(SysmonTick) + Send + 'static) {
        let n = Arc::new(AtomicUsize::new(0));
        let m = n.clone();
        (n, move |_| {
            m.fetch_add(1, Ordering::SeqCst);
        })
    }

    fn fake() -> Option<impl FnMut() -> SysmonTick> {
        Some(SysmonTick::default)
    }

    #[test]
    fn a_second_start_adds_no_sampler_and_stop_ends_it() {
        let life = leak(P);
        let (n, sink) = counter();
        let (n2, sink2) = counter();
        life.start(sink, fake);
        life.start(sink2, fake);
        std::thread::sleep(P * 35 / 10);
        life.stop();
        let ticks = n.load(Ordering::SeqCst);
        assert!((2..=4).contains(&ticks), "{ticks} ticks");
        assert_eq!(n2.load(Ordering::SeqCst), 0);
        std::thread::sleep(P * 3);
        assert_eq!(n.load(Ordering::SeqCst), ticks);
    }

    #[test]
    fn stop_then_start_retires_the_old_sampler() {
        let life = leak(P);
        let (old, sink) = counter();
        life.start(sink, fake);
        std::thread::sleep(P * 15 / 10);
        life.stop();
        let (new, sink2) = counter();
        life.start(sink2, fake);
        let old_ticks = old.load(Ordering::SeqCst);
        std::thread::sleep(P * 35 / 10);
        life.stop();
        assert_eq!(old.load(Ordering::SeqCst), old_ticks);
        assert!(new.load(Ordering::SeqCst) >= 2);
    }

    #[test]
    fn stop_without_start_and_a_failed_open_are_harmless() {
        let life = leak(P);
        life.stop();
        let (n, sink) = counter();
        life.start(sink, || None::<fn() -> SysmonTick>);
        std::thread::sleep(P);
        assert!(!life.running.load(Ordering::SeqCst), "a failed open lets the next start retry");
        assert_eq!(n.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn used_memory_never_goes_negative() {
        const GIB: u64 = 1 << 30;
        assert_eq!(used_memory(16 * GIB, 6 * GIB), 10 * GIB);
        assert_eq!(used_memory(4 * GIB, 5 * GIB), 0);
    }
}
