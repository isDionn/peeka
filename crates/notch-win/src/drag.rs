//! Drag out of the clipboard: Windows's own drag-and-drop with the shell's data object for the
//! files (an image item drags its PNG), so Explorer and chat apps take it as a file drop. `SHDoDragDrop` supplies
//! the drag image itself for a shell data object (no custom bitmap). It runs on the calling thread, which must be
//! the UI thread that got the mouse press (the sync `clip_drag` command runs there); the call returns when the drop
//! ends. Not tried on a real desktop by an agent.

/// True = something was dropped (copy).
#[cfg(windows)]
pub fn files(paths: &[std::path::PathBuf]) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::IDataObject;
    use windows::Win32::System::Ole::{OleInitialize, DROPEFFECT_COPY};
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use windows::Win32::UI::Shell::{
        BHID_DataObject, ILFree, IShellItemArray, SHCreateShellItemArrayFromIDLists, SHDoDragDrop, SHParseDisplayName,
    };
    if paths.is_empty() {
        return false;
    }
    // SAFETY: OLE on this thread (already on for the UI thread: harmless S_FALSE); every PIDL is freed with ILFree
    // after the array copied it; the data object lives through the drag.
    unsafe {
        let _ = OleInitialize(None);
        let mut pidls: Vec<*const ITEMIDLIST> = vec![];
        for p in paths {
            let mut pidl = std::ptr::null_mut();
            if SHParseDisplayName(&HSTRING::from(p.as_os_str()), None, &mut pidl, 0, None).is_ok() {
                pidls.push(pidl);
            }
        }
        let obj = SHCreateShellItemArrayFromIDLists(&pidls)
            .and_then(|a: IShellItemArray| a.BindToHandler::<_, IDataObject>(None, &BHID_DataObject));
        for p in pidls {
            ILFree(Some(p));
        }
        let Ok(obj) = obj else { return false };
        SHDoDragDrop(None, &obj, None, DROPEFFECT_COPY).is_ok_and(|e| e == DROPEFFECT_COPY)
    }
}

#[cfg(not(windows))]
pub fn files(_paths: &[std::path::PathBuf]) -> bool {
    false
}
