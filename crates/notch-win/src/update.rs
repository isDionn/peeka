// Peeka — original implementation (MIT).
//! The daily update check's one request (rules: `notch_core::update`). WinHTTP (already part of Windows and of the
//! `windows` crate, so no new dependency) sends a plain GET with only a User-Agent; no cookies, no credentials. Any
//! failure (offline, timeout, not a 200) is None and the caller stays silent.

/// The body of a 200 reply from `https://<host><path>` (at most 64 KiB), or None.
#[cfg(windows)]
pub fn get(host: &str, path: &str, user_agent: &str) -> Option<String> {
    use core::ffi::c_void;
    use windows::core::PCWSTR;
    use windows::Win32::Networking::WinHttp::*;

    /// Closes the handle on every exit path.
    struct H(*mut c_void);
    impl Drop for H {
        fn drop(&mut self) {
            // SAFETY: a non-null handle from WinHttpOpen / Connect / OpenRequest, closed once.
            unsafe { let _ = WinHttpCloseHandle(self.0); }
        }
    }
    fn ok(p: *mut c_void) -> Option<H> {
        (!p.is_null()).then_some(H(p))
    }
    let w = crate::to_wide;
    let (ua, host, path, verb) = (w(user_agent), w(host), w(path), w("GET"));
    // SAFETY: NUL-terminated wide strings that outlive the calls; every handle is checked and closed by `H`.
    unsafe {
        let session = ok(WinHttpOpen(PCWSTR(ua.as_ptr()), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0))?;
        WinHttpSetTimeouts(session.0, 10_000, 10_000, 10_000, 10_000).ok()?;
        let conn = ok(WinHttpConnect(session.0, PCWSTR(host.as_ptr()), 443, 0))?;
        let req = ok(WinHttpOpenRequest(conn.0, PCWSTR(verb.as_ptr()), PCWSTR(path.as_ptr()), PCWSTR::null(), PCWSTR::null(), core::ptr::null(), WINHTTP_FLAG_SECURE))?;
        WinHttpSendRequest(req.0, None, None, 0, 0, 0).ok()?;
        WinHttpReceiveResponse(req.0, core::ptr::null_mut()).ok()?;
        let (mut status, mut len) = (0u32, 4u32);
        WinHttpQueryHeaders(req.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, PCWSTR::null(), Some(&mut status as *mut u32 as *mut c_void), &mut len, core::ptr::null_mut()).ok()?;
        if status != 200 {
            return None;
        }
        let mut body = Vec::new();
        let mut buf = [0u8; 4096];
        while body.len() < 64 * 1024 {
            let mut n = 0u32;
            WinHttpReadData(req.0, buf.as_mut_ptr() as *mut c_void, buf.len() as u32, &mut n).ok()?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&buf[..n as usize]);
        }
        String::from_utf8(body).ok()
    }
}
