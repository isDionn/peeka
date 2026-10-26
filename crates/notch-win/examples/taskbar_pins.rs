//! Dev check for "Import Windows taskbar pins" (not shipped): `cargo run -p notch-win --example taskbar_pins` prints
//! only counts: what the Windows taskbar list holds, how each pin was resolved, and how many match an open window.
fn main() {
    #[cfg(windows)]
    {
        use notch_core::ports::Desktop;
        notch_win::com();
        let raw = notch_win::Win32Desktop.windows();
        let running: Vec<String> = notch_core::apps::merge(&[], &raw).into_iter().map(|i| i.app_id).collect();
        let pins = notch_win::startmenu::taskbar_pins(&running);
        let kind = |p: &str| pins.iter().filter(|x| x.app_id.starts_with(p)).count();
        let unique = notch_core::apps::add_pins(&[], pins.clone()).len();
        let open = pins.iter().filter(|p| running.iter().any(|r| r.eq_ignore_ascii_case(&p.app_id))).count();
        println!("taskbar pins read: {}  (aumid {}, exe {}, shortcut {})", pins.len(), kind("aumid:"), kind("exe:"), kind("lnk:"));
        println!("unique after merge: {unique}  matching an open window now: {open}  open apps: {}", running.len());
    }
}
