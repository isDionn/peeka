//! Dev check for the screen tint (not shipped): `cargo run -p notch-win --example tint [--colors]` samples each
//! monitor area 50 times and prints the cost per sample; `--colors` also prints the three colours (VM checks only).
#[cfg(windows)]
fn cpu_ms() -> f64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::{GetCurrentThread, GetThreadTimes};
    let (mut a, mut b, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
    // SAFETY: the current thread's pseudo handle and our out-params.
    let _ = unsafe { GetThreadTimes(GetCurrentThread(), &mut a, &mut b, &mut k, &mut u) };
    let t = |f: FILETIME| ((u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime)) as f64 / 10_000.0;
    t(k) + t(u)
}

fn main() {
    #[cfg(windows)]
    {
        // Peeka itself is per-monitor DPI aware (Tauri); without this a scaled monitor's GDI coordinates are virtualised
        // SAFETY: a process-wide flag set once before any window or DC exists.
        let _ = unsafe { windows::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        let colors = std::env::args().any(|a| a == "--colors");
        for m in notch_win::monitors::list() {
            let band = notch_core::tint::region(&m);
            let mut times = vec![];
            let mut last = None;
            let cpu0 = cpu_ms();
            for _ in 0..50 {
                let t = std::time::Instant::now();
                last = notch_win::tint::sample(band);
                times.push(t.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(f64::total_cmp);
            println!("cpu {:.2} ms per sample", (cpu_ms() - cpu0) / 50.0);
            let avg = times.iter().sum::<f64>() / times.len() as f64;
            print!("monitor {} area {}x{}: min {:.2} ms, median {:.2} ms, avg {:.2} ms, max {:.2} ms", m.index, band.width(), band.height(), times[0], times[25], avg, times[49]);
            match (colors, last.as_deref().and_then(notch_core::tint::average)) {
                (true, Some(c)) => println!(" colors {c:?}"),
                (_, None) if last.is_none() => println!(" SAMPLE FAILED"),
                (_, None) => println!(" all dull and dark: default glow colour"),
                _ => println!(),
            }
        }
    }
}
