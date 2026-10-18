//! The read-only tray list's registry side (**PENDING Wave 0 test 4**; rules and why: `notch_core::tray`).

#[cfg(windows)]
use crate::privacy::reg;

#[cfg(windows)]
const KEY: &str = r"Control Panel\NotifyIconSettings";

/// Every subkey of `HKCU\Control Panel\NotifyIconSettings`; empty before Windows 11 22H2 (no such key).
#[cfg(windows)]
pub fn read() -> Vec<notch_core::tray::RawIcon> {
    let Some(root) = reg::hkcu(KEY, false) else { return vec![] };
    reg::subkeys(&root)
        .into_iter()
        .filter_map(|key| {
            let k = reg::open(root.0, &key, false)?;
            Some(notch_core::tray::RawIcon {
                exe: reg::sz(&k, "ExecutablePath"),
                tooltip: reg::sz(&k, "InitialTooltip"),
                promoted: reg::dword(&k, "IsPromoted"),
                key,
            })
        })
        .collect()
}

/// `notch_core::tray::parse` with this machine's folders and files.
#[cfg(windows)]
pub fn list() -> Vec<notch_core::tray::TrayIcon> {
    notch_core::tray::parse(
        read(),
        |v| std::env::var(v).ok().filter(|s| !s.is_empty()),
        |p| std::path::Path::new(p).is_file(),
    )
}
