// Peeka — original implementation (MIT).
//! The Windows side of the clipboard history: a format listener that reports each copy with its source
//! and privacy flags, and copy-back that marks every write as "keep out of history, cloud and monitors". What the
//! flags mean is `notch_core::clip`'s business; this module only reports them. Clipboard contents are never logged.
//!
//! The byte layouts and the small decision rules are plain functions at the top so tests check them without ever
//! opening the user's clipboard.

/// Registered format names, in the order of the `Formats` fields.
const FORMAT_NAMES: [&str; 6] = [
    "ExcludeClipboardContentFromMonitorProcessing",
    "Clipboard Viewer Ignore",
    "CanIncludeInClipboardHistory",
    "CanUploadToCloudClipboard",
    "PNG",
    "Preferred DropEffect",
];

/// Most paths one file copy reports.
const MAX_FILES: u32 = 1000;
/// Longer side of the history thumbnail.
const THUMB_SIDE: u32 = 240;
/// `DROPFILES`: `pFiles` (u32), `pt` (two i32), `fNC`, `fWide` (two BOOL).
const DROPFILES_SIZE: usize = 20;

/// `CF_HDROP` payload: DROPFILES header, then each path as UTF-16LE + NUL, then one more NUL.
fn drop_files(paths: &[String]) -> Vec<u8> {
    let mut out = Vec::with_capacity(DROPFILES_SIZE + 2);
    out.extend_from_slice(&(DROPFILES_SIZE as u32).to_le_bytes()); // list offset
    out.extend_from_slice(&[0; 8]); // point (0, 0)
    out.extend_from_slice(&0u32.to_le_bytes()); // not non-client
    out.extend_from_slice(&1u32.to_le_bytes()); // wide characters
    for path in paths {
        path.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_le_bytes()));
        out.extend_from_slice(&[0, 0]);
    }
    out.extend_from_slice(&[0, 0]);
    out
}

/// A `CanInclude…` / `CanUpload…` value says "no" only when it is present and its first four bytes are zero.
fn says_no(value: Option<&[u8]>) -> bool {
    matches!(value, Some(v) if v.len() >= 4 && v[..4] == [0; 4])
}

/// `CF_UNICODETEXT` bytes up to the first NUL (or the end), lossy; an odd last byte is ignored. Decodes straight
/// into a buffer sized for the worst case, so no growing copy of a password is left behind.
fn utf16_text(bytes: &[u8]) -> String {
    let units = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&u| u != 0);
    let mut text = String::with_capacity(bytes.len() / 2 * 3);
    text.extend(char::decode_utf16(units).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)));
    text
}

/// UTF-8 (lossy) -> NUL-terminated UTF-16LE bytes for `CF_UNICODETEXT`.
fn utf16_bytes(utf8: &[u8]) -> Vec<u8> {
    let mut lossy = String::from_utf8_lossy(utf8);
    let mut out = Vec::with_capacity((lossy.len() + 1) * 2);
    lossy.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_le_bytes()));
    out.extend_from_slice(&[0, 0]);
    if let std::borrow::Cow::Owned(s) = &mut lossy {
        notch_core::clip::vault::wipe_string(s);
    }
    out
}

/// Windows's screen snip tools put text beside the image; for them the image wins.
fn is_snipping_tool(exe: &str) -> bool {
    let name = exe.rsplit(['\\', '/']).next().unwrap_or(exe).to_lowercase();
    name == "snippingtool.exe" || name == "screenclippinghost.exe"
}

#[cfg(windows)]
pub use win::{clear_if, listen, sequence, write, write_seq};

#[cfg(windows)]
mod win {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::mpsc;
    use std::sync::OnceLock;
    use std::time::Duration;

    use notch_core::clip::secret::{Flags, Origin};
    use notch_core::clip::vault::wipe;
    use notch_core::clip::{Clip, Copied, ImageData, Payload};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::DataExchange::{
        AddClipboardFormatListener, CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardOwner,
        GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
        SetClipboardData,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{CF_DIB, CF_HDROP, CF_UNICODETEXT};
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE, MSG,
        WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLIPBOARDUPDATE, WNDCLASSW,
    };

    use super::*;
    use crate::{apps, clip_image};

    const _: () = assert!(std::mem::size_of::<windows::Win32::UI::Shell::DROPFILES>() == DROPFILES_SIZE);

    static STARTED: AtomicBool = AtomicBool::new(false);
    /// The listener window: clipboard owner for copy-back (0 = none yet).
    static LISTENER: AtomicIsize = AtomicIsize::new(0);
    /// Wakes the reader thread; the window procedure only signals, it never reads.
    static CHANGED: OnceLock<mpsc::Sender<()>> = OnceLock::new();

    /// Registered format ids (0 = registration failed; treated as absent).
    pub(super) struct Formats {
        pub exclude: u32,
        pub viewer_ignore: u32,
        pub history: u32,
        pub cloud: u32,
        pub png: u32,
        pub drop_effect: u32,
    }

    pub(super) fn formats() -> &'static Formats {
        static CACHE: OnceLock<Formats> = OnceLock::new();
        CACHE.get_or_init(|| {
            let id = |name: &str| {
                let wide = crate::to_wide(name);
                // SAFETY: a NUL-terminated UTF-16 string that outlives the call.
                unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) }
            };
            let [exclude, viewer_ignore, history, cloud, png, drop_effect] = FORMAT_NAMES.map(id);
            Formats { exclude, viewer_ignore, history, cloud, png, drop_effect }
        })
    }

    /// The three "keep out" markers every copy-back carries, in write order. `viewer_ignore` is read, never written.
    pub(super) fn keep_out() -> [(u32, &'static [u8]); 3] {
        let f = formats();
        [(f.exclude, &[0]), (f.history, &[0; 4]), (f.cloud, &[0; 4])]
    }

    /// Open clipboard; closed on drop, on every path.
    struct Opened;

    impl Opened {
        /// Another app may hold it briefly: 8 tries, waiting 20 ms, 35 ms, 50 ms, ... in between.
        fn new(owner: Option<HWND>) -> Option<Self> {
            for attempt in 0..8u64 {
                // SAFETY: plain call; the owner is our own window or none.
                if unsafe { OpenClipboard(owner) }.is_ok() {
                    return Some(Self);
                }
                if attempt < 7 {
                    std::thread::sleep(Duration::from_millis(20 + 15 * attempt));
                }
            }
            None
        }
    }

    impl Drop for Opened {
        fn drop(&mut self) {
            // SAFETY: we opened it (Opened exists only after a successful OpenClipboard).
            let _ = unsafe { CloseClipboard() };
        }
    }

    /// A locked global memory block, unlocked on drop.
    struct Locked {
        mem: HGLOBAL,
        ptr: *mut u8,
        len: usize,
    }

    impl Locked {
        fn new(mem: HGLOBAL) -> Option<Self> {
            // SAFETY: `mem` is a live global handle (from the clipboard or our own GlobalAlloc).
            let (ptr, len) = unsafe { (GlobalLock(mem) as *mut u8, GlobalSize(mem)) };
            if ptr.is_null() {
                return None;
            }
            Some(Self { mem, ptr, len })
        }

        fn bytes(&self) -> &[u8] {
            // SAFETY: GlobalLock returned a pointer to `len` (GlobalSize) readable bytes, valid until unlock.
            unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
        }

        fn bytes_mut(&mut self) -> &mut [u8] {
            // SAFETY: as above, and the block is ours to write (only used on blocks we allocated).
            unsafe { std::slice::from_raw_parts_mut(self.ptr, self.len) }
        }
    }

    impl Drop for Locked {
        fn drop(&mut self) {
            // SAFETY: matching the GlobalLock in `new`; its "now unlocked" error result is expected and ignored.
            let _ = unsafe { GlobalUnlock(self.mem) };
        }
    }

    fn available(format: u32) -> bool {
        // SAFETY: plain query, works without opening the clipboard.
        format != 0 && unsafe { IsClipboardFormatAvailable(format) }.is_ok()
    }

    /// The clipboard's block for `format` (clipboard must be open), or None.
    fn handle(format: u32) -> Option<HANDLE> {
        // SAFETY: the clipboard is open (callers hold `Opened`); the handle stays the clipboard's.
        unsafe { GetClipboardData(format) }.ok()
    }

    fn locked(format: u32) -> Option<Locked> {
        Locked::new(HGLOBAL(handle(format)?.0))
    }

    fn some_path(s: String) -> Option<String> {
        (!s.is_empty()).then_some(s)
    }

    /// Who copied and what was in front; needs no open clipboard. Flags are filled in once it is open.
    fn source() -> (Origin, bool) {
        // SAFETY: plain query; Err = no owner window (e.g. Print Screen).
        let owner = unsafe { GetClipboardOwner() }.ok().map(|h| h.0 as isize).filter(|&h| h != 0);
        let own = owner.is_some_and(|h| apps::pid_of_window(h) == std::process::id());
        let fg = apps::foreground();
        let origin = Origin {
            flags: Flags::default(),
            owner_exe: owner.and_then(|h| some_path(apps::exe_of_window(h))),
            foreground_exe: (fg != 0).then(|| apps::exe_of_window(fg)).and_then(some_path),
            foreground_title: (fg != 0).then(|| apps::title_of_window(fg)),
        };
        (origin, own)
    }

    /// The four privacy markers (clipboard open).
    fn flags(f: &Formats) -> Flags {
        let marker = |id: u32| if available(id) { locked(id) } else { None };
        Flags {
            exclude: available(f.exclude),
            viewer_ignore: available(f.viewer_ignore),
            no_history: available(f.history) && says_no(marker(f.history).as_ref().map(Locked::bytes)),
            no_cloud: available(f.cloud) && says_no(marker(f.cloud).as_ref().map(Locked::bytes)),
        }
    }

    fn files() -> Option<Clip> {
        let drop = HDROP(handle(CF_HDROP.0 as u32)?.0);
        // SAFETY: a live CF_HDROP handle; 0xFFFFFFFF asks for the count.
        let count = unsafe { DragQueryFileW(drop, u32::MAX, None) }.min(MAX_FILES);
        let mut paths = Vec::new();
        for i in 0..count {
            // SAFETY: as above; no buffer = length query.
            let len = unsafe { DragQueryFileW(drop, i, None) } as usize;
            let mut buf = vec![0u16; len + 1];
            // SAFETY: as above; the buffer holds `len` characters plus the NUL.
            let got = unsafe { DragQueryFileW(drop, i, Some(&mut buf)) } as usize;
            if got > 0 {
                paths.push(crate::wide_to_string(&buf[..got.min(len)]));
            }
        }
        (!paths.is_empty()).then_some(Clip::Files(paths))
    }

    fn text() -> Option<Clip> {
        let block = locked(CF_UNICODETEXT.0 as u32)?;
        // Decoded straight from the clipboard's own memory: no raw copy of a password exists to wipe.
        Some(Clip::Text(utf16_text(block.bytes())))
    }

    /// PNG encoding runs after the clipboard is closed, so other apps are not locked out meanwhile.
    fn image(pic: clip_image::Picture) -> Option<Clip> {
        let png = clip_image::encode_png(&pic).ok()?;
        let thumb_png = clip_image::encode_png(&clip_image::thumbnail(&pic, THUMB_SIDE)).ok()?;
        let fp = clip_image::fingerprint(&pic);
        Some(Clip::Image(ImageData { png, thumb_png, width: pic.width, height: pic.height, fp }))
    }

    /// One clipboard change -> what was copied, or None (nothing usable, or the clipboard stayed locked).
    fn read() -> Option<Copied> {
        let f = formats();
        let (mut origin, own) = source();
        let snip = origin.owner_exe.as_deref().is_some_and(is_snipping_tool);
        let open = Opened::new(None)?;
        origin.flags = flags(f);
        // Files beat their names as text; text beats the picture Office adds beside it, except for snip tools.
        let clip = if available(CF_HDROP.0 as u32) {
            files()?
        } else if available(CF_UNICODETEXT.0 as u32) && !snip {
            text()?
        } else if available(CF_DIB.0 as u32) {
            let pic = clip_image::from_dib(locked(CF_DIB.0 as u32)?.bytes())?;
            drop(open);
            image(pic)?
        } else {
            return None;
        };
        Some(Copied { clip, origin, own })
    }

    extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_CLIPBOARDUPDATE {
            if let Some(tx) = CHANGED.get() {
                let _ = tx.send(());
            }
            return LRESULT(0);
        }
        // SAFETY: default handling for every other message of our own window.
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    /// Starts the clipboard listener once per process. False = Windows refused it (the history stays empty).
    pub fn listen(sink: impl Fn(Copied) + Send + Sync + 'static) -> bool {
        if STARTED.swap(true, Ordering::SeqCst) {
            return true;
        }
        let (tx, rx) = mpsc::channel();
        if CHANGED.set(tx).is_err() {
            // A previous attempt failed after wiring the channel; its reader thread is still waiting on it.
            return start_window();
        }
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                // Apps put several formats in a row: let them settle, then read once for the whole burst.
                std::thread::sleep(Duration::from_millis(120));
                while rx.try_recv().is_ok() {}
                if let Some(copied) = read() {
                    sink(copied);
                }
            }
        });
        start_window()
    }

    /// The message-only window and its loop on their own thread; waits at most 5 s for the result.
    fn start_window() -> bool {
        let (done, result) = mpsc::channel();
        std::thread::spawn(move || {
            let class = w!("PeekaClipboardListener");
            // SAFETY: our own module, a static class name and a plain window procedure that lives forever.
            let hwnd = unsafe {
                let instance = GetModuleHandleW(None).ok().map(Into::into);
                let wc = WNDCLASSW {
                    lpfnWndProc: Some(window_proc),
                    hInstance: instance.unwrap_or_default(),
                    lpszClassName: class,
                    ..Default::default()
                };
                RegisterClassW(&wc); // 0 on a retry (class exists) is fine
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    class,
                    w!(""),
                    WINDOW_STYLE(0),
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    instance,
                    None,
                )
            };
            let Ok(hwnd) = hwnd else {
                let _ = done.send(false);
                return;
            };
            // SAFETY: our own live window.
            if unsafe { AddClipboardFormatListener(hwnd) }.is_err() {
                let _ = done.send(false);
                return;
            }
            LISTENER.store(hwnd.0 as isize, Ordering::SeqCst);
            let _ = done.send(true);
            let mut msg = MSG::default();
            // SAFETY: the window's own message loop, for the life of the process.
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                unsafe { DispatchMessageW(&msg) };
            }
        });
        let ok = result.recv_timeout(Duration::from_secs(5)).unwrap_or(false);
        if !ok {
            STARTED.store(false, Ordering::SeqCst);
        }
        ok
    }

    /// One format onto the open clipboard. The clipboard owns the block on success; on failure it is zeroed (it may
    /// hold a password) and freed.
    fn put(format: u32, data: &[u8]) -> bool {
        if format == 0 {
            return false;
        }
        // SAFETY: a fresh movable block of at least one byte.
        let Ok(mem) = (unsafe { GlobalAlloc(GMEM_MOVEABLE, data.len().max(1)) }) else {
            return false;
        };
        let filled = match Locked::new(mem) {
            Some(mut block) => {
                let dst = block.bytes_mut();
                let n = data.len().min(dst.len());
                dst[..n].copy_from_slice(&data[..n]);
                n == data.len()
            }
            None => false,
        };
        // SAFETY: the clipboard is open and emptied by us (callers hold `Opened`); the block is unlocked.
        if filled && unsafe { SetClipboardData(format, Some(HANDLE(mem.0))) }.is_ok() {
            return true;
        }
        if let Some(mut block) = Locked::new(mem) {
            wipe(block.bytes_mut());
        }
        // SAFETY: still ours: SetClipboardData did not take it.
        let _ = unsafe { GlobalFree(Some(mem)) };
        false
    }

    /// Copy-back: content plus the three keep-out markers. Seen by the listener as `own`.
    pub fn write(payload: &Payload) -> bool {
        let f = formats();
        let markers = keep_out();
        if markers.iter().any(|(id, _)| *id == 0) {
            return false;
        }
        // Everything is prepared before the clipboard is opened, so it is held only for the copying.
        let mut items: Vec<(u32, Vec<u8>)> = match payload {
            Payload::Text(secret) => vec![(CF_UNICODETEXT.0 as u32, utf16_bytes(secret.bytes()))],
            Payload::Image(path) => {
                let Some(png) = std::fs::read(path).ok() else { return false };
                let Some(pic) = clip_image::decode_png(&png) else { return false };
                vec![(CF_DIB.0 as u32, clip_image::to_dib(&pic)), (f.png, png)]
            }
            Payload::Files(paths) => {
                vec![(CF_HDROP.0 as u32, drop_files(paths)), (f.drop_effect, 1u32.to_le_bytes().to_vec())]
            }
        };
        let ok = put_all(&items, &markers);
        items.iter_mut().for_each(|(_, data)| wipe(data));
        ok
    }

    /// The clipboard's change counter (it moves on every copy, by anyone; no need to open the clipboard).
    pub fn sequence() -> u32 {
        // SAFETY: no arguments.
        unsafe { GetClipboardSequenceNumber() }
    }

    /// `write`, and the change counter right after it (read once the clipboard is closed again, so the counter has
    /// surely moved on). `clear_if` takes it back. None = the write failed.
    pub fn write_seq(payload: &Payload) -> Option<u32> {
        write(payload).then(sequence)
    }

    /// Empties the clipboard if and only if its change counter is still `seq`: nothing was copied since, so it still
    /// holds what `write_seq` put there (a one-time code goes 60 s after). False = something else was copied meanwhile
    /// (left alone), or the clipboard stayed locked by another app.
    pub fn clear_if(seq: u32) -> bool {
        let owner = match LISTENER.load(Ordering::SeqCst) {
            0 => None,
            h => Some(HWND(h as _)),
        };
        let Some(_open) = Opened::new(owner) else { return false };
        // Checked again with the clipboard held: no one can copy between this look and the emptying.
        // SAFETY: the clipboard is open (held by `_open`).
        sequence() == seq && unsafe { EmptyClipboard() }.is_ok()
    }

    fn put_all(items: &[(u32, Vec<u8>)], markers: &[(u32, &[u8])]) -> bool {
        let owner = match LISTENER.load(Ordering::SeqCst) {
            0 => None,
            h => Some(HWND(h as _)),
        };
        let Some(_open) = Opened::new(owner) else { return false };
        // SAFETY: the clipboard is open (held by `_open`).
        if unsafe { EmptyClipboard() }.is_err() {
            return false;
        }
        items.iter().all(|(id, data)| put(*id, data)) && markers.iter().all(|(id, data)| put(*id, data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn drop_files_layout() {
        let paths = vec![r"E:\a\b.txt".to_string(), r"F:\Belgeler\x y.doc".to_string()];
        let out = drop_files(&paths);
        assert_eq!(&out[0..4], &(DROPFILES_SIZE as u32).to_le_bytes());
        assert_eq!(&out[4..12], &[0; 8]);
        assert_eq!(&out[12..16], &0u32.to_le_bytes());
        assert_eq!(&out[16..20], &1u32.to_le_bytes());
        let mut list = utf16le(r"E:\a\b.txt");
        list.extend_from_slice(&[0, 0]);
        list.extend(utf16le(r"F:\Belgeler\x y.doc"));
        list.extend_from_slice(&[0, 0, 0, 0]);
        assert_eq!(&out[DROPFILES_SIZE..], list.as_slice());
    }

    #[test]
    fn an_empty_file_list_is_header_and_one_nul() {
        assert_eq!(drop_files(&[]).len(), DROPFILES_SIZE + 2);
    }

    #[test]
    fn turkish_paths_are_utf16_little_endian() {
        let out = drop_files(&[r"G:\Çalışma\şifre.txt".to_string()]);
        assert_eq!(&out[DROPFILES_SIZE..DROPFILES_SIZE + 2], &[b'G', 0]);
        let c = DROPFILES_SIZE + 3 * 2; // "G:\" then Ç
        assert_eq!(&out[c..c + 2], &[0xC7, 0x00]);
    }

    #[test]
    fn only_four_zero_bytes_say_no() {
        assert!(!says_no(None));
        assert!(says_no(Some(&[0, 0, 0, 0])));
        assert!(says_no(Some(&[0, 0, 0, 0, 7])));
        assert!(!says_no(Some(&[1, 0, 0, 0])));
        assert!(!says_no(Some(&[0, 0])));
    }

    #[test]
    fn utf16_text_stops_at_nul_and_ignores_a_stray_byte() {
        assert_eq!(utf16_text(&utf16le("ab\0cd")), "ab");
        assert_eq!(utf16_text(&utf16le("şifre")), "şifre");
        let mut odd = utf16le("xy");
        odd.push(0x41);
        assert_eq!(utf16_text(&odd), "xy");
        assert_eq!(utf16_text(&[0x00, 0xD8]), "\u{FFFD}"); // lone surrogate
    }

    #[test]
    fn utf16_bytes_round_trips_and_terminates() {
        let out = utf16_bytes("Çay ☕".as_bytes());
        assert_eq!(&out[out.len() - 2..], &[0, 0]);
        assert_eq!(utf16_text(&out), "Çay ☕");
        assert_eq!(utf16_text(&utf16_bytes(&[0x61, 0xFF])), "a\u{FFFD}");
    }

    #[test]
    fn snipping_tools_by_file_name() {
        assert!(is_snipping_tool(r"C:\Windows\System32\SnippingTool.exe"));
        assert!(is_snipping_tool(r"C:\Windows\SystemApps\X\ScreenClippingHost.exe"));
        assert!(!is_snipping_tool(r"C:\Apps\mysnippingtool.exe.bak"));
        assert!(!is_snipping_tool(r"C:\Apps\mysnippingtool.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn keep_out_markers_are_exclude_history_cloud() {
        let f = win::formats();
        let m = win::keep_out();
        assert_eq!(m.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![f.exclude, f.history, f.cloud]);
        assert!(m.iter().all(|(id, _)| *id != 0 && *id != f.viewer_ignore));
        assert!(m[0].0 != m[1].0 && m[1].0 != m[2].0 && m[0].0 != m[2].0);
        assert_eq!((m[1].1, m[2].1), (&[0u8; 4][..], &[0u8; 4][..]));
    }

    #[cfg(windows)]
    #[test]
    fn the_six_registered_formats_are_distinct() {
        let f = win::formats();
        let mut ids = vec![f.exclude, f.viewer_ignore, f.history, f.cloud, f.png, f.drop_effect];
        assert!(ids.iter().all(|&id| id != 0));
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 6);
    }
}
