//! Ctrl+Space's paperclip: Windows's own "Open" dialog (`IFileOpenDialog`), one existing file-system file.

/// The file the owner picked; None = cancelled or the dialog failed. Call it on the thread that owns `owner`
/// (Tauri's main thread: a sync command), which is already in a COM apartment; the dialog is modal to `owner`.
#[cfg(windows)]
pub fn open_file(owner: isize) -> Option<std::path::PathBuf> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, SIGDN_FILESYSPATH,
    };

    // A no-op where the thread already has an apartment (the main thread does).
    crate::com();
    // SAFETY: plain COM calls on interfaces we own (released on drop); the returned path string is freed with
    // CoTaskMemFree after it is copied.
    unsafe {
        let dlg: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
        let opts = dlg.GetOptions().ok()?;
        dlg.SetOptions(opts | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST).ok()?;
        dlg.Show(Some(HWND(owner as _))).ok()?; // cancel is an error too
        let raw = dlg.GetResult().ok()?.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let path = raw.to_string().ok();
        CoTaskMemFree(Some(raw.0 as *const _));
        path.map(std::path::PathBuf::from)
    }
}
