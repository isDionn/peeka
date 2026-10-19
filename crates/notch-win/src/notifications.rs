//! The Windows notification mirror's Windows side (Wave 6; rules, mapping and why: `notch_core::mirror`): package
//! identity, notification access, and the poll: the Notification Center through `UserNotificationListener` every 1 s
//! when Notch has identity and Windows's yes, else this user's notification history database (`crate::wpn`) every
//! 2.5 s. Toast text is handed to the callback and kept nowhere here; this file writes no file and no log line
//! (`mirror` test checks).
//!

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::sync::Arc;

#[cfg(windows)]
use notch_core::mirror::{Access, RawToast, Seen, DB_POLL_MS, POLL_MS};

/// This process runs with the sparse package's identity (registered by the owner, then Notch restarted).
#[cfg(windows)]
pub fn registered() -> bool {
    windows::ApplicationModel::Package::Current().is_ok()
}

#[cfg(windows)]
fn access_of(s: windows::UI::Notifications::Management::UserNotificationListenerAccessStatus) -> Access {
    use windows::UI::Notifications::Management::UserNotificationListenerAccessStatus as S;
    match s {
        S::Allowed => Access::Allowed,
        S::Denied => Access::Denied,
        _ => Access::Unspecified,
    }
}

/// What Windows says now, without asking. Without identity only the switch for all apps is read
/// (Settings › Privacy › Notifications): "Deny" there is `Denied`, so the history database is not read either.
#[cfg(windows)]
pub fn access() -> Access {
    use windows::UI::Notifications::Management::UserNotificationListener;
    if !registered() {
        let key = crate::privacy::reg::hkcu(
            r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\userNotificationListener",
            false,
        );
        let deny = key.and_then(|k| crate::privacy::reg::sz(&k, "Value")).is_some_and(|v| v.eq_ignore_ascii_case("Deny"));
        return if deny { Access::Denied } else { Access::Unknown };
    }
    UserNotificationListener::Current().and_then(|l| l.GetAccessStatus()).map_or(Access::Unknown, access_of)
}

/// Windows's one-time prompt (only from `mirror_enable`, on the owner's click). `Unknown` without identity.
#[cfg(windows)]
pub fn request_access() -> Access {
    use windows::UI::Notifications::Management::UserNotificationListener;
    if !registered() {
        return Access::Unknown;
    }
    UserNotificationListener::Current().and_then(|l| l.RequestAccessAsync()?.get()).map_or(Access::Unknown, access_of)
}

#[cfg(windows)]
fn toasts(
    l: &windows::UI::Notifications::Management::UserNotificationListener,
) -> windows::core::Result<Vec<windows::UI::Notifications::UserNotification>> {
    let list = l.GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast)?.get()?;
    let mut out = Vec::new();
    for i in 0..list.Size()? {
        out.push(list.GetAt(i)?);
    }
    Ok(out)
}

/// The text lines of a toast's generic binding (title first); empty when the toast has none.
#[cfg(windows)]
fn toast_lines(n: &windows::UI::Notifications::UserNotification) -> Vec<String> {
    use windows::UI::Notifications::KnownNotificationBindings;
    let mut lines = Vec::new();
    let Ok(binding) = n.Notification().and_then(|t| t.Visual()).and_then(|v| v.GetBinding(&KnownNotificationBindings::ToastGeneric()?))
    else {
        return lines;
    };
    let Ok(elements) = binding.GetTextElements() else { return lines };
    for i in 0..elements.Size().unwrap_or(0) {
        if let Some(text) = elements.GetAt(i).ok().and_then(|e| e.Text().ok()) {
            lines.push(text.to_string());
        }
    }
    lines
}

#[cfg(windows)]
fn read(n: &windows::UI::Notifications::UserNotification) -> Option<RawToast> {
    let id = n.Id().ok()?;
    // A Win32 sender may come without AppInfo; its text is still worth showing, so the names stay empty.
    let (app, aumid) = n.AppInfo().map_or((String::new(), String::new()), |info| {
        let aumid = info.AppUserModelId().map(|s| s.to_string()).unwrap_or_default();
        let app = info.DisplayInfo().and_then(|d| d.DisplayName()).map(|s| s.to_string()).unwrap_or_default();
        (app, aumid)
    });
    let texts = toast_lines(n);
    Some(RawToast { id, app, aumid, texts })
}

/// The sender's name as Start shows it (`shell:AppsFolder\<AUMID>`); "" when the shell does not know it. Needs COM.
#[cfg(windows)]
fn app_name(aumid: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromParsingName, SIGDN_NORMALDISPLAY};
    if !notch_core::mirror::aumid_ok(aumid) {
        return String::new();
    }
    let name = crate::to_wide(&format!(r"shell:AppsFolder\{aumid}"));
    // SAFETY: a NUL-terminated wide string that outlives the call; the item is released on drop and the returned
    // string is freed with CoTaskMemFree after it is copied.
    unsafe {
        let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(name.as_ptr()), None) else {
            return String::new();
        };
        let Ok(raw) = item.GetDisplayName(SIGDN_NORMALDISPLAY) else { return String::new() };
        let out = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as *const _));
        out
    }
}

/// One look at the history database (None: missing, busy or another layout).
#[cfg(windows)]
fn history() -> Option<Vec<crate::wpn::Row>> {
    let c = crate::wpn::open(&crate::wpn::path()?)?;
    crate::wpn::rows(&c, crate::wpn::now())
}

/// Polls on its own thread until `stop` is set: the Notification Center every `POLL_MS` when `listener`, else the
/// history database every `DB_POLL_MS`. `on(arrived, gone)` after each look that changed something (the first look
/// only remembers what is already there). Returns the stop flag.
#[cfg(windows)]
pub fn watch(listener: bool, mut on: impl FnMut(Vec<RawToast>, Vec<u32>) + Send + 'static) -> Arc<AtomicBool> {
    use windows::UI::Notifications::Management::UserNotificationListener;
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    std::thread::spawn(move || {
        crate::com();
        let mut seen = Seen::default();
        if !listener {
            while !flag.load(Ordering::Relaxed) {
                // A failed look is skipped, not read as "everything is gone".
                if let Some(list) = history() {
                    let present: Vec<(u32, i64)> = list.iter().map(|r| (r.id, r.at)).collect();
                    let (arrived, gone) = seen.step(&present);
                    let raws: Vec<RawToast> = arrived
                        .iter()
                        .filter_map(|id| list.iter().find(|r| r.id == *id))
                        .map(|r| RawToast {
                            id: r.id,
                            app: app_name(&r.aumid),
                            aumid: r.aumid.clone(),
                            texts: notch_core::mirror::toast_texts(&r.payload),
                        })
                        .collect();
                    if !raws.is_empty() || !gone.is_empty() {
                        on(raws, gone);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(DB_POLL_MS));
            }
            return;
        }
        let Ok(listener) = UserNotificationListener::Current() else { return };
        while !flag.load(Ordering::Relaxed) {
            if let Ok(list) = toasts(&listener) {
                let present: Vec<(u32, i64)> = list
                    .iter()
                    .filter_map(|n| Some((n.Id().ok()?, n.CreationTime().map_or(0, |t| t.UniversalTime))))
                    .collect();
                let (arrived, gone) = seen.step(&present);
                let raws: Vec<RawToast> = arrived
                    .iter()
                    .filter_map(|id| list.iter().find(|n| n.Id().ok() == Some(*id)).and_then(read))
                    .collect();
                if !raws.is_empty() || !gone.is_empty() {
                    on(raws, gone);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(POLL_MS));
        }
    });
    stop
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::UI::Notifications::Management::UserNotificationListenerAccessStatus as S;

    /// Windows's three answers map to ours; "no answer yet" must not read as a refusal (the switch may ask again).
    #[test]
    fn windows_access_answers_map_without_turning_unspecified_into_denied() {
        assert_eq!(access_of(S::Allowed), Access::Allowed);
        assert_eq!(access_of(S::Denied), Access::Denied);
        assert_eq!(access_of(S::Unspecified), Access::Unspecified);
        assert_eq!(access_of(S(99)), Access::Unspecified, "an answer from a newer Windows is not a no");
        assert!(!notch_core::mirror::state(true, access_of(S::Unspecified), false, true).listener());
        assert_eq!(notch_core::mirror::state(true, access_of(S::Unspecified), false, true).blocker, None);
    }
}
