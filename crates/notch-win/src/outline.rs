// Peeka — original implementation (MIT).
//! F7: the thin frame drawn around the window the mascot is dragged over. A top-most popup that never activates and
//! lets every click through (`WS_EX_TRANSPARENT`, so `WindowFromPoint` never returns it), clipped to a frame-shaped
//! region. It belongs to the thread that makes it, which must call `pump` while it lives. Not tried on a real desktop
//! by an agent.

/// Frame width in physical px.
#[cfg(windows)]
const THICK: i32 = 3;

#[cfg(windows)]
pub struct Outline(windows::Win32::Foundation::HWND);

#[cfg(windows)]
impl Outline {
    pub fn new() -> Option<Self> {
        use windows::core::w;
        use windows::Win32::Foundation::COLORREF;
        use windows::Win32::Graphics::Gdi::{CreateSolidBrush, DeleteObject, HGDIOBJ};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, RegisterClassW, SetLayeredWindowAttributes, LWA_ALPHA, WNDCLASSW,
            WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
        };
        unsafe extern "system" fn frame_proc(
            h: windows::Win32::Foundation::HWND,
            m: u32,
            w: windows::Win32::Foundation::WPARAM,
            l: windows::Win32::Foundation::LPARAM,
        ) -> windows::Win32::Foundation::LRESULT {
            // SAFETY: the default handling for every message of our own window.
            unsafe { DefWindowProcW(h, m, w, l) }
        }
        let class = w!("PeekaPickOutline");
        // SAFETY: our own module, a static class name and the default window procedure; the brush (the island's
        // composer cyan #63E6E2, BGR) lives as long as the class, i.e. the process; a spare one is deleted.
        unsafe {
            let instance = GetModuleHandleW(None).ok().map(Into::into);
            let wc = WNDCLASSW {
                lpfnWndProc: Some(frame_proc),
                hInstance: instance.unwrap_or_default(),
                lpszClassName: class,
                hbrBackground: CreateSolidBrush(COLORREF(0x00E2_E663)),
                ..Default::default()
            };
            if RegisterClassW(&wc) == 0 {
                let _ = DeleteObject(HGDIOBJ(wc.hbrBackground.0)); // the class exists (a later pick) with its own brush
            }
            let ex = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST;
            let h = CreateWindowExW(ex, class, w!(""), WS_POPUP, 0, 0, 0, 0, None, None, instance, None).ok()?;
            let _ = SetLayeredWindowAttributes(h, COLORREF(0), 200, LWA_ALPHA);
            Some(Self(h))
        }
    }

    /// Frames `target` (its visible bounds, without the invisible resize border), or hides the frame for None.
    pub fn show(&self, target: Option<isize>) {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ, RGN_DIFF};
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE,
        };
        let mut r = RECT::default();
        // SAFETY: DWMWA_EXTENDED_FRAME_BOUNDS writes one RECT into `r`; a stale handle fails and hides the frame.
        let ok = target.is_some_and(|t| unsafe {
            DwmGetWindowAttribute(
                HWND(t as _),
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut r as *mut RECT as *mut _,
                size_of::<RECT>() as u32,
            )
            .is_ok()
        });
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        // SAFETY: our own window; the outer region goes to the window (which then owns it), the inner one is deleted.
        unsafe {
            if !ok || w <= 2 * THICK || h <= 2 * THICK {
                let _ = ShowWindow(self.0, SW_HIDE);
                return;
            }
            let outer = CreateRectRgn(0, 0, w, h);
            let inner = CreateRectRgn(THICK, THICK, w - THICK, h - THICK);
            CombineRgn(Some(outer), Some(outer), Some(inner), RGN_DIFF);
            let _ = DeleteObject(HGDIOBJ(inner.0));
            if SetWindowRgn(self.0, Some(outer), true) == 0 {
                let _ = DeleteObject(HGDIOBJ(outer.0));
            }
            let _ = SetWindowPos(self.0, Some(HWND_TOPMOST), r.left, r.top, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }

    /// Handles this thread's pending window messages (paint, the region change).
    pub fn pump(&self) {
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
        };
        let mut m = MSG::default();
        // SAFETY: a plain message loop over this thread's queue.
        unsafe {
            while PeekMessageW(&mut m, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&m);
                DispatchMessageW(&m);
            }
        }
    }
}

#[cfg(windows)]
impl Drop for Outline {
    fn drop(&mut self) {
        // SAFETY: our own window, destroyed on the thread that made it.
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::DestroyWindow(self.0);
        }
    }
}
