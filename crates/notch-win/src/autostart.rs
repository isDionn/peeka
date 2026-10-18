//! Start with Windows: the per-user Run key only (`HKCU\...\Run`, value `notch`). Never HKLM. The value text comes
//! from `notch_core::supervise::run_value` (tested there); this is just the registry call.

/// On: write `"<this exe>" --autostart`. Off: delete the value (already gone is fine).
#[cfg(windows)]
pub fn set(on: bool) -> Result<(), String> {
    use notch_core::supervise::{run_value, RUN_KEY, RUN_VALUE_NAME};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let key = crate::to_wide(RUN_KEY);
    let name = crate::to_wide(RUN_VALUE_NAME);
    let code = if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let data = crate::to_wide(&run_value(&exe));
        // SAFETY: NUL-terminated wide strings that outlive the call; cbData is the byte length including the NUL.
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(key.as_ptr()),
                PCWSTR(name.as_ptr()),
                REG_SZ.0,
                Some(data.as_ptr().cast()),
                (data.len() * 2) as u32,
            )
        }
    } else {
        // SAFETY: as above.
        match unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, PCWSTR(key.as_ptr()), PCWSTR(name.as_ptr())) } {
            ERROR_FILE_NOT_FOUND => ERROR_SUCCESS,
            other => other,
        }
    };
    if code == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("Run key: {}", code.0))
    }
}

#[cfg(not(windows))]
pub fn set(_on: bool) -> Result<(), String> {
    Ok(())
}
