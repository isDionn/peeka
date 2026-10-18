//! `window_preview` (Wave 5): one window's picture through `PrintWindow(PW_RENDERFULLCONTENT)` (also DirectComposition
//! / WebView content; some DirectX or DRM-protected windows still come out black), scaled down by
//! `notch_core::preview::downscale` and encoded like the icons. Rate limit and cache: `notch_core::preview`.

/// Is the window minimised (`IsIconic`)? Its picture would be the title bar only: the caller serves its cache.
#[cfg(windows)]
pub fn minimised(hwnd: isize) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::IsIconic;
    // SAFETY: a plain query; a stale handle answers false.
    unsafe { IsIconic(windows::Win32::Foundation::HWND(hwnd as _)) }.as_bool()
}

/// The window as a PNG data URL, at most `notch_core::preview::MAX_EDGE` px; None = Windows would not draw it.
#[cfg(windows)]
pub fn capture(hwnd: isize) -> Option<String> {
    let (buf, w, ht) = grab(hwnd)?;
    let (small, sw, sh) = notch_core::preview::downscale(&buf, w, ht)?;
    crate::icons::bgra_to_data_url(&small, sw, sh)
}

/// The window at full size as PNG bytes (Ctrl+Space's screenshot attachment).
#[cfg(windows)]
pub fn capture_png(hwnd: isize) -> Option<Vec<u8>> {
    let (buf, w, ht) = grab(hwnd)?;
    crate::icons::bgra_to_png(&buf, w, ht)
}

/// `PrintWindow` into top-down BGRA (pixels, width, height).
#[cfg(windows)]
fn grab(hwnd: isize) -> Option<(Vec<u8>, u32, u32)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, PW_RENDERFULLCONTENT};

    let h = HWND(hwnd as _);
    // PrintWindow sends WM_PRINT and would wait forever on a hung window (and every preview after it).
    // SAFETY: a plain query.
    if unsafe { windows::Win32::UI::WindowsAndMessaging::IsHungAppWindow(h) }.as_bool() {
        return None;
    }
    let mut r = RECT::default();
    // SAFETY: an out-param we own.
    unsafe { GetWindowRect(h, &mut r) }.ok()?;
    let (w, ht) = ((r.right - r.left).max(0) as u32, (r.bottom - r.top).max(0) as u32);
    // shortcut: a 8K-wide window is cut off at 8192 px rather than allocating more; nothing on screen is bigger.
    if w == 0 || ht == 0 || w > 8192 || ht > 8192 {
        return None;
    }
    let mut buf = vec![0u8; (w * ht * 4) as usize];
    // SAFETY: a screen DC and a memory DC/bitmap pair made, used and released here; `buf` holds w*h 32-bit pixels
    // as the header says; the old bitmap is selected back before anything is deleted.
    let ok = unsafe {
        let screen = GetDC(None);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w as i32, ht as i32);
        let old = SelectObject(mem, HGDIOBJ(bmp.0));
        let drawn = PrintWindow(h, mem, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
        SelectObject(mem, old);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(ht as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let lines = if drawn {
            GetDIBits(mem, bmp, 0, ht, Some(buf.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS)
        } else {
            0
        };
        let _ = DeleteObject(HGDIOBJ(bmp.0));
        let _ = DeleteDC(mem);
        ReleaseDC(None, screen);
        drawn && lines == ht as i32
    };
    ok.then_some((buf, w, ht))
}
