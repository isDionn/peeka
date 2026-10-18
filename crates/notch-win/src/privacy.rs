//! Microphone / camera in use (Wave 5): Windows's `ConsentStore` under HKCU, read with the registry API and watched
//! with `RegNotifyChangeKeyValue` (no polling). What "in use" means and the names: `notch_core::privacy`.

#[cfg(windows)]
const ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

/// The two capabilities, as their `ConsentStore` key names.
pub const MIC: &str = "microphone";
pub const CAMERA: &str = "webcam";

#[cfg(windows)]
pub(crate) mod reg {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ,
        REG_DWORD, REG_SZ, REG_VALUE_TYPE,
    };

    /// An open key, closed on drop.
    pub struct Key(pub HKEY);

    // SAFETY: a registry handle is not tied to the thread that opened it; the watcher thread owns its one key.
    unsafe impl Send for Key {}

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: a key this module opened; closed once.
            let _ = unsafe { RegCloseKey(self.0) };
        }
    }

    pub fn open(parent: HKEY, path: &str, notify: bool) -> Option<Key> {
        let p = crate::to_wide(path);
        let mut out = HKEY::default();
        let access = if notify { KEY_READ | KEY_NOTIFY } else { KEY_READ };
        // SAFETY: a NUL-terminated path that outlives the call; `out` is ours.
        unsafe { RegOpenKeyExW(parent, PCWSTR(p.as_ptr()), None, access, &mut out) }.is_ok().then_some(Key(out))
    }

    pub fn hkcu(path: &str, notify: bool) -> Option<Key> {
        open(HKEY_CURRENT_USER, path, notify)
    }

    pub fn subkeys(k: &Key) -> Vec<String> {
        let mut out = vec![];
        for i in 0u32.. {
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            // SAFETY: `buf` holds `len` u16s; other out-params unused.
            let r = unsafe {
                RegEnumKeyExW(k.0, i, Some(windows::core::PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None)
            };
            if r.is_err() {
                break;
            }
            out.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        out
    }

    /// A REG_DWORD value; None when missing or another type.
    pub fn dword(k: &Key, name: &str) -> Option<u32> {
        let n = crate::to_wide(name);
        let (mut v, mut size, mut ty) = (0u32, 4u32, REG_VALUE_TYPE::default());
        // SAFETY: a 4-byte out buffer as `size` says; the name outlives the call.
        let r = unsafe {
            RegQueryValueExW(
                k.0,
                PCWSTR(n.as_ptr()),
                None,
                Some(&mut ty),
                Some(&mut v as *mut u32 as *mut u8),
                Some(&mut size),
            )
        };
        (r.is_ok() && ty == REG_DWORD && size == 4).then_some(v)
    }

    /// A REG_SZ value up to 2 KB; None when missing, empty or longer.
    pub fn sz(k: &Key, name: &str) -> Option<String> {
        let n = crate::to_wide(name);
        let mut buf = [0u16; 1024];
        let (mut size, mut ty) = ((buf.len() * 2) as u32, REG_VALUE_TYPE::default());
        // SAFETY: `buf` holds `size` bytes; the name outlives the call.
        let r = unsafe {
            RegQueryValueExW(
                k.0,
                PCWSTR(n.as_ptr()),
                None,
                Some(&mut ty),
                Some(buf.as_mut_ptr() as *mut u8),
                Some(&mut size),
            )
        };
        if r.is_err() || ty != REG_SZ {
            return None;
        }
        let s = crate::wide_to_string(&buf[..(size as usize / 2).min(buf.len())]);
        (!s.is_empty()).then_some(s)
    }

    /// A REG_QWORD value; 0 when missing.
    pub fn qword(k: &Key, name: &str) -> u64 {
        let n = crate::to_wide(name);
        let mut v = 0u64;
        let mut size = 8u32;
        // SAFETY: an 8-byte out buffer as `size` says; the name outlives the call.
        let r = unsafe {
            RegQueryValueExW(k.0, PCWSTR(n.as_ptr()), None, None, Some(&mut v as *mut u64 as *mut u8), Some(&mut size))
        };
        if r.is_ok() && size == 8 {
            v
        } else {
            0
        }
    }
}

/// Every app key under one capability (packaged ones and `NonPackaged`).
#[cfg(windows)]
pub fn read(capability: &str) -> Vec<notch_core::privacy::Usage> {
    use notch_core::privacy::Usage;
    let Some(root) = reg::hkcu(&format!(r"{ROOT}\{capability}"), false) else { return vec![] };
    let usage = |parent: &reg::Key, name: String, packaged: bool| {
        let k = reg::open(parent.0, &name, false)?;
        Some(Usage {
            start: reg::qword(&k, "LastUsedTimeStart"),
            stop: reg::qword(&k, "LastUsedTimeStop"),
            key: name,
            packaged,
        })
    };
    let mut out = vec![];
    for name in reg::subkeys(&root) {
        if name.eq_ignore_ascii_case("NonPackaged") {
            if let Some(np) = reg::open(root.0, &name, false) {
                out.extend(reg::subkeys(&np).into_iter().filter_map(|n| usage(&np, n, false)));
            }
        } else {
            out.extend(usage(&root, name, true));
        }
    }
    out
}

/// Watches the `ConsentStore` tree on its own thread for the process's life: `on_change` runs once at start and
/// again after every change Windows signals. False = the key could not be opened (nothing is shown then).
#[cfg(windows)]
pub fn watch(on_change: impl Fn() + Send + 'static) -> bool {
    use windows::Win32::System::Registry::{
        RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET, REG_NOTIFY_CHANGE_NAME,
    };
    let Some(root) = reg::hkcu(ROOT, true) else { return false };
    std::thread::spawn(move || {
        let root = root; // the whole key moves here (and closes when the loop ends), not just its handle
        loop {
            on_change();
            // SAFETY: a key opened with KEY_NOTIFY and kept for the loop's life; synchronous, so no event handle. It is
            // one-shot: the loop arms it again after each change.
            let r = unsafe {
                RegNotifyChangeKeyValue(root.0, true, REG_NOTIFY_CHANGE_LAST_SET | REG_NOTIFY_CHANGE_NAME, None, false)
            };
            if r.is_err() {
                eprintln!("[notch] cannot watch ConsentStore: microphone indicator stopped");
                return;
            }
            // Windows writes Start and Stop as two values: a short pause reads them together.
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    });
    true
}
