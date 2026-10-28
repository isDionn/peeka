//! An app's "Recent" jump-list files (`IApplicationDocumentLists`, `ADLT_RECENT`), read only.

/// At most `max` file paths the app's jump list holds under `aumid`; empty = none, or Windows refused.
#[cfg(windows)]
pub fn recent(aumid: &str, max: u32) -> Vec<std::path::PathBuf> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::Common::IObjectArray;
    use windows::Win32::UI::Shell::{
        ApplicationDocumentLists, IApplicationDocumentLists, IShellItem, IShellLinkW, ADLT_RECENT, SIGDN_FILESYSPATH,
        SLGP_RAWPATH,
    };

    crate::com();
    // SAFETY: COM objects we own (released on drop); each returned path string is freed after it is copied.
    unsafe {
        let run = || -> windows::core::Result<Vec<std::path::PathBuf>> {
            let lists: IApplicationDocumentLists = CoCreateInstance(&ApplicationDocumentLists, None, CLSCTX_INPROC_SERVER)?;
            let id = crate::to_wide(aumid);
            lists.SetAppID(PCWSTR(id.as_ptr()))?;
            let items: IObjectArray = lists.GetList(ADLT_RECENT, max)?;
            let mut out = vec![];
            for i in 0..items.GetCount()? {
                if let Ok(item) = items.GetAt::<IShellItem>(i) {
                    let raw = item.GetDisplayName(SIGDN_FILESYSPATH)?;
                    out.extend(raw.to_string().ok().map(std::path::PathBuf::from));
                    CoTaskMemFree(Some(raw.0 as *const _));
                } else if let Ok(link) = items.GetAt::<IShellLinkW>(i) {
                    let mut buf = [0u16; 520];
                    if link.GetPath(&mut buf, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32).is_ok() {
                        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                        out.push(String::from_utf16_lossy(&buf[..n]).into());
                    }
                }
            }
            Ok(out)
        };
        run().unwrap_or_default().into_iter().filter(|p| p.is_file()).collect()
    }
}
