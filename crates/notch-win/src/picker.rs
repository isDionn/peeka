//! Windows's own "Open" dialog (`IFileOpenDialog`) for existing file-system files: Ctrl+Space's paperclip (one file)
//! and the shelf's "Add files" (several).

/// The file the owner picked; None = cancelled or the dialog failed. Call it on the thread that owns `owner`
/// (Tauri's main thread: a sync command), which is already in a COM apartment; the dialog is modal to `owner`.
#[cfg(windows)]
pub fn open_file(owner: isize) -> Option<std::path::PathBuf> {
    pick(owner, false).pop()
}

/// `open_file` with multi-select; empty = cancelled or the dialog failed.
#[cfg(windows)]
pub fn open_files(owner: isize) -> Vec<std::path::PathBuf> {
    pick(owner, true)
}

#[cfg(windows)]
fn pick(owner: isize, multi: bool) -> Vec<std::path::PathBuf> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_ALLOWMULTISELECT, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM,
        SIGDN_FILESYSPATH,
    };

    // A no-op where the thread already has an apartment (the main thread does).
    crate::com();
    // SAFETY: plain COM calls on interfaces we own (released on drop); each returned path string is freed with
    // CoTaskMemFree after it is copied.
    unsafe {
        let run = || -> windows::core::Result<Vec<std::path::PathBuf>> {
            let dlg: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let multi = if multi { FOS_ALLOWMULTISELECT } else { Default::default() };
            dlg.SetOptions(dlg.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST | multi)?;
            dlg.Show(Some(HWND(owner as _)))?; // cancel is an error too
            let items = dlg.GetResults()?;
            let mut out = vec![];
            for i in 0..items.GetCount()? {
                let raw = items.GetItemAt(i)?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let path = raw.to_string().ok();
                CoTaskMemFree(Some(raw.0 as *const _));
                out.extend(path.map(std::path::PathBuf::from));
            }
            Ok(out)
        };
        run().unwrap_or_default()
    }
}
