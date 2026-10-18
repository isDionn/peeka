//! Files for Ctrl+K from the Windows Search index (Wave 4): read-only OLE DB (`Search.CollatorDSO`, resolved by
//! ProgID at run time), one `SELECT` built and escaped by `notch_core::search::files_sql`, each row's URL from
//! `IGetRow::GetURLFromHROW` (no accessor bindings). It runs on its own COM thread; past `timeout` the caller gets
//! what it has (nothing) and the thread finishes on its own. The index off (the `WSearch` service not running)
//! is a typed state, not an error. Not run on a real desktop by an agent.

use std::time::Duration;

/// Is the Windows Search service running? False = the index is off ("index off").
#[cfg(windows)]
pub fn index_on() -> bool {
    use windows::core::w;
    use windows::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus, SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS,
        SERVICE_RUNNING, SERVICE_STATUS,
    };
    // SAFETY: both handles are checked and closed; the status out-param is ours.
    unsafe {
        let Ok(scm) = OpenSCManagerW(None, None, SC_MANAGER_CONNECT) else { return false };
        let on = match OpenServiceW(scm, w!("WSearch"), SERVICE_QUERY_STATUS) {
            Ok(svc) => {
                let mut st = SERVICE_STATUS::default();
                let ok = QueryServiceStatus(svc, &mut st).is_ok() && st.dwCurrentState == SERVICE_RUNNING;
                let _ = CloseServiceHandle(svc);
                ok
            }
            Err(_) => false,
        };
        let _ = CloseServiceHandle(scm);
        on
    }
}

/// Local file paths for `sql` (from `files_sql`), at most `max`, within `timeout`.
#[cfg(windows)]
pub fn files(sql: String, max: usize, timeout: Duration) -> Vec<String> {
    with_timeout(timeout, move || {
        crate::com();
        run(&sql, max).unwrap_or_default()
    })
}

/// `f` on its own thread; past `timeout` the default comes back and the thread finishes on its own.
pub fn with_timeout<T: Default + Send + 'static>(timeout: Duration, f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(timeout).unwrap_or_default()
}

#[cfg(windows)]
fn run(sql: &str, max: usize) -> windows::core::Result<Vec<String>> {
    use windows::core::{w, Interface, GUID, HSTRING};
    use windows::Win32::System::Com::{CLSIDFromProgID, CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Search::{
        ICommandText, IDBCreateCommand, IDBCreateSession, IDBInitialize, IGetRow, IRowset, DB_NULL_HCHAPTER,
    };
    /// `DBGUID_DEFAULT` (oledb.h); the crate has no constant for it.
    const DBGUID_DEFAULT: GUID = GUID::from_u128(0xc8b521fb_5cf3_11ce_ade5_00aa0044773d);
    // SAFETY: plain COM calls on this thread's MTA; every out-pointer is ours; the row handles the provider gave
    // are released and their array freed with CoTaskMemFree.
    unsafe {
        let clsid = CLSIDFromProgID(w!("Search.CollatorDSO"))?;
        let init: IDBInitialize = CoCreateInstance(&clsid, None, CLSCTX_INPROC_SERVER)?;
        init.Initialize()?;
        let session: IDBCreateSession = init.cast()?;
        let create: IDBCreateCommand = session.CreateSession(None, &IDBCreateCommand::IID)?.cast()?;
        let text: ICommandText = create.CreateCommand(None, &ICommandText::IID)?.cast()?;
        text.SetCommandText(&DBGUID_DEFAULT, &HSTRING::from(sql))?;
        let mut rowset = None;
        text.Execute(None, &IRowset::IID, None, None, Some(&mut rowset))?;
        let rowset: IRowset = rowset.ok_or_else(windows::core::Error::empty)?.cast()?;
        let get: IGetRow = rowset.cast()?;
        let mut out = vec![];
        loop {
            let mut got = 0usize;
            // The provider allocates the HROW array and writes its address into the first slot.
            let mut slot = vec![std::ptr::null_mut::<usize>(); max.clamp(1, 50)];
            if rowset.GetNextRows(DB_NULL_HCHAPTER as usize, 0, &mut got, &mut slot).is_err() || got == 0 {
                break;
            }
            let rows = std::slice::from_raw_parts(slot[0] as *const usize, got);
            for &h in rows {
                if let Ok(url) = get.GetURLFromHROW(h) {
                    if let Ok(s) = url.to_string() {
                        out.extend(notch_core::search::url_to_path(&s));
                    }
                    CoTaskMemFree(Some(url.0 as *const _));
                }
            }
            let _ =
                rowset.ReleaseRows(got, rows.as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut());
            CoTaskMemFree(Some(slot[0] as *const _));
            if out.len() >= max {
                break;
            }
        }
        out.truncate(max);
        Ok(out)
    }
}

#[cfg(not(windows))]
pub fn index_on() -> bool {
    false
}

#[cfg(not(windows))]
pub fn files(_sql: String, _max: usize, _timeout: Duration) -> Vec<String> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slow_index_query_gives_up_at_the_timeout() {
        let t = std::time::Instant::now();
        let got: Vec<String> = with_timeout(Duration::from_millis(50), || {
            std::thread::sleep(Duration::from_millis(2000));
            vec!["late".into()]
        });
        assert!(got.is_empty() && t.elapsed() < Duration::from_millis(1000));
        assert_eq!(with_timeout(Duration::from_secs(1), || vec![1]), vec![1]);
    }
}
