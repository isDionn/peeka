//! Dev measurement (owner's PC, not CI): tap the Windows key alone a few times; each tap prints the time from the
//! low-level hook to the worker that would emit to the page. Windows's Start stays shut while this runs (30 s).
//! `cargo run -p notch-win --example winkey_timing`

#[cfg(windows)]
fn main() {
    notch_win::winkey::set_on(true);
    let ok = notch_win::winkey::start(|at| println!("lone Win tap: hook -> worker {} us", at.elapsed().as_micros()));
    println!("hook installed: {ok}. Tap the Windows key alone (30 s)...");
    std::thread::sleep(std::time::Duration::from_secs(30));
}

#[cfg(not(windows))]
fn main() {}
