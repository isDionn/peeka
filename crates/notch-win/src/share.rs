//! `share_open` (Wave 5): the Windows share sheet for one of Notch's own items, through `IDataTransferManagerInterop`
//! on the island window (no "Yakın paylaşım" of our own: the sheet offers Windows's). Which items may go and what
//! they carry: `notch_core::shelf::ShareTarget` (`Pano::share_sheet`, `Shelf::path`); never a password.
//! Must run on the thread that owns the window (a sync Tauri command = the main thread).

#[cfg(windows)]
use notch_core::shelf::ShareTarget;

/// What the next `DataRequested` hands over (the handler is registered once per window and reads this).
#[cfg(windows)]
static PENDING: parking_lot::Mutex<Option<(String, ShareTarget)>> = parking_lot::Mutex::new(None);

/// Opens the sheet for `hwnd` with `target`; `title` is the sheet's heading (Windows refuses a package without one).
/// False = Windows refused or a file could not be opened.
#[cfg(windows)]
pub fn open(hwnd: isize, title: &str, target: ShareTarget) -> bool {
    use windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use windows::Foundation::TypedEventHandler;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::IDataTransferManagerInterop;

    static HOOKED: std::sync::OnceLock<isize> = std::sync::OnceLock::new();
    let h = HWND(hwnd as _);
    let Ok(interop) = windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>() else {
        return false;
    };
    // SAFETY: a live top-level window of this process, on its own thread.
    let Ok(manager) = (unsafe { interop.GetForWindow::<DataTransferManager>(h) }) else { return false };
    if HOOKED.get().is_none() {
        let handler = TypedEventHandler::new(|_, args: windows::core::Ref<'_, DataRequestedEventArgs>| {
            let Some((title, target)) = PENDING.lock().take() else { return Ok(()) };
            let data = args.ok()?.Request()?.Data()?;
            data.Properties()?.SetTitle(&title.as_str().into())?;
            match target {
                ShareTarget::Text(t) => data.SetText(&t.as_str().into())?,
                ShareTarget::Files(paths) => data.SetStorageItemsReadOnly(&storage_items(&paths)?)?,
            }
            Ok(())
        });
        if manager.DataRequested(&handler).is_err() {
            return false;
        }
        let _ = HOOKED.set(hwnd);
    }
    if let ShareTarget::Files(p) = &target {
        if p.is_empty() || !p.iter().all(|x| x.exists()) {
            return false;
        }
    }
    *PENDING.lock() = Some((title.to_string(), target));
    // SAFETY: as above.
    let ok = unsafe { interop.ShowShareUIForWindow(h) }.is_ok();
    if !ok {
        PENDING.lock().take();
    }
    ok
}

/// The paths as WinRT storage items (files and folders); a path that no longer opens fails the whole share.
#[cfg(windows)]
fn storage_items(
    paths: &[std::path::PathBuf],
) -> windows::core::Result<windows_collections::IIterable<windows::Storage::IStorageItem>> {
    use windows::core::{Interface, HSTRING};
    use windows::Storage::{IStorageItem, StorageFile, StorageFolder};
    let mut items: Vec<Option<IStorageItem>> = vec![];
    for p in paths {
        let path = HSTRING::from(p.as_os_str());
        let item: IStorageItem = if p.is_dir() {
            StorageFolder::GetFolderFromPathAsync(&path)?.get()?.cast()?
        } else {
            StorageFile::GetFileFromPathAsync(&path)?.get()?.cast()?
        };
        items.push(Some(item));
    }
    Ok(items.into())
}
