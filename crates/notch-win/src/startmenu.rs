//! The Start panel's app list: every `.lnk` under the two Start Menu "Programs" folders (all users, this user),
//! junk names dropped (`notch_core::apps::keep_start_name`), one per name.
//! The shortcut's target exe is read (`IShellLinkW`) only for the
//! shortcut-exception list. shortcut: Store apps without a Start Menu `.lnk` are missing; Wave 2 can enumerate
//! `shell:AppsFolder` instead.

use std::path::{Path, PathBuf};

use notch_core::apps::{exe_name, keep_start_name, ListedApp};

/// How deep a Start Menu folder is walked (real ones are 2-3 levels).
const MAX_DEPTH: usize = 6;

/// The "Programs" folders that exist.
pub fn roots() -> Vec<PathBuf> {
    ["ProgramData", "APPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|b| PathBuf::from(b).join("Microsoft\\Windows\\Start Menu\\Programs"))
        .filter(|p| p.is_dir())
        .collect()
}

/// Every `.lnk` under `root` (a broken folder loses only itself).
pub fn walk(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(dir) = std::fs::read_dir(root) else { return };
    for e in dir.flatten() {
        let path = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() && depth < MAX_DEPTH => walk(&path, depth + 1, out),
            Ok(t) if t.is_file() && path.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) => out.push(path),
            _ => {}
        }
    }
}

/// Shortcut files -> the list, sorted by name, one per (case-folded) name. `target` reads a shortcut's exe path.
pub fn to_list(lnks: Vec<PathBuf>, target: impl Fn(&Path) -> Option<String>) -> Vec<ListedApp> {
    let mut list: Vec<ListedApp> = Vec::new();
    for lnk in lnks {
        let Some(name) = lnk.file_stem().and_then(|s| s.to_str()).map(str::to_string) else { continue };
        if !keep_start_name(&name) || list.iter().any(|a| a.name.to_lowercase() == name.to_lowercase()) {
            continue;
        }
        let exe = target(&lnk).map(|t| exe_name(&t)).filter(|e| e.ends_with(".exe"));
        list.push(ListedApp { app_id: format!("lnk:{}", lnk.display()), name, exe });
    }
    list.sort_by_key(|a| notch_core::apps::fold(&a.name));
    list
}

/// The whole list. Needs COM on the calling thread.
#[cfg(windows)]
pub fn scan() -> Vec<ListedApp> {
    let mut lnks = Vec::new();
    for root in roots() {
        walk(&root, 0, &mut lnks);
    }
    to_list(lnks, target)
}

/// A shortcut's target path (`IShellLinkW::GetPath`, `%vars%` expanded so it matches a window's exe path); None for a
/// non-file target (Store app, URL).
#[cfg(windows)]
pub fn target(lnk: &Path) -> Option<String> {
    target_args(lnk).map(|(t, _)| t)
}

/// The target path and whether the shortcut passes it arguments.
#[cfg(windows)]
fn target_args(lnk: &Path) -> Option<(String, bool)> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let path = crate::to_wide(&lnk.to_string_lossy());
    // SAFETY: plain COM calls on objects released on drop; the path buffer outlives Load; GetPath / GetArguments write
    // into their buffers.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        link.cast::<IPersistFile>().ok()?.Load(PCWSTR(path.as_ptr()), STGM_READ).ok()?;
        let mut buf = [0u16; 1024];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let mut args = [0u16; 1024];
        let has_args = link.GetArguments(&mut args).is_ok() && !crate::wide_to_string(&args).trim().is_empty();
        Some((crate::wide_to_string(&buf), has_args)).filter(|(s, _)| !s.is_empty())
    }
}

/// A shortcut's own AppUserModelID (`PKEY_AppUserModel_ID`), the id Windows groups its windows by.
#[cfg(windows)]
fn shortcut_aumid(lnk: &str) -> Option<String> {
    shell_prop(lnk, &windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID)
}

/// The exe an Apps-folder AUMID starts (`System.Link.TargetParsingPath`): a desktop app's Start Menu shortcut target
/// (Discord's stub, Opera's opera.exe); None for a Store app (the shell gives ""). Needs COM on the calling thread.
#[cfg(windows)]
pub fn app_target(aumid: &str) -> Option<String> {
    let target = shell_prop(&format!("shell:AppsFolder\\{aumid}"), &windows::Win32::Storage::EnhancedStorage::PKEY_Link_TargetParsingPath)?;
    target.to_ascii_lowercase().ends_with(".exe").then_some(target)
}

/// One string property of a shell item, by its parsing name; None = no item, unset or empty.
#[cfg(windows)]
fn shell_prop(parsing: &str, key: &windows::Win32::Foundation::PROPERTYKEY) -> Option<String> {
    use windows::Win32::System::Com::{CoTaskMemFree, StructuredStorage::PropVariantToStringAlloc};
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreFromParsingName, GPS_DEFAULT};
    let path = crate::to_wide(parsing);
    // SAFETY: a NUL-terminated path; the store and value are released on drop; `s` is a CoTaskMem string we free.
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreFromParsingName(windows::core::PCWSTR(path.as_ptr()), None, GPS_DEFAULT).ok()?;
        let value = store.GetValue(key).ok()?;
        let s = PropVariantToStringAlloc(&value).ok()?;
        let out = s.to_string().ok();
        CoTaskMemFree(Some(s.0 as *const _));
        out.filter(|a| !a.trim().is_empty())
    }
}

/// The Windows taskbar's `Favorites` value (read-only), or empty.
#[cfg(windows)]
fn taskband() -> Vec<u8> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
    let (key, value) = (w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband"), w!("Favorites"));
    let mut size = 0u32;
    // SAFETY: the first call asks for the size; the second writes at most `size` bytes into `buf`.
    unsafe {
        if RegGetValueW(HKEY_CURRENT_USER, key, value, RRF_RT_REG_BINARY, None, None, Some(&mut size)).is_err() {
            return vec![];
        }
        let mut buf = vec![0u8; size as usize];
        if RegGetValueW(HKEY_CURRENT_USER, key, value, RRF_RT_REG_BINARY, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)).is_err() {
            return vec![];
        }
        buf.truncate(size as usize);
        buf
    }
}

/// The shell item's desktop parsing name (an Apps-folder item or a file path).
#[cfg(windows)]
fn parsing_name(item: &[u8]) -> Option<String> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetNameFromIDList, SIGDN_DESKTOPABSOLUTEPARSING};
    // a valid ITEMIDLIST ends with a zero u16; never hand the shell one that doesn't
    if item.len() < 2 || item[item.len() - 2..] != [0, 0] {
        return None;
    }
    let owned = item.to_vec(); // aligned copy kept alive for the call
    // SAFETY: a terminated ID list that outlives the call; the returned CoTaskMem string is freed after reading.
    unsafe {
        let s = SHGetNameFromIDList(owned.as_ptr().cast(), SIGDN_DESKTOPABSOLUTEPARSING).ok()?;
        let out = s.to_string().ok();
        CoTaskMemFree(Some(s.0 as *const _));
        out
    }
}

/// The apps pinned on the Windows taskbar, in its order, as strip pins (owner RC5). `running` = the strip's current app
/// ids (a shortcut takes the id its open window already has). Without the `Favorites` value: the `User Pinned\TaskBar`
/// shortcuts by name. Needs COM on the calling thread. Reads only; nothing is written or sent anywhere.
#[cfg(windows)]
pub fn taskbar_pins(running: &[String]) -> Vec<notch_core::apps::Pin> {
    use notch_core::apps::{fallback_name, shortcut_id, taskband_items, taskbar_pin, Pin, TaskbarPin};
    let blob = taskband();
    let mut found: Vec<TaskbarPin> = taskband_items(&blob).into_iter().filter_map(parsing_name).filter_map(|p| taskbar_pin(&p)).collect();
    if found.is_empty() {
        let dir = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"));
        let mut lnks = Vec::new();
        if let Some(dir) = dir {
            walk(&dir, MAX_DEPTH, &mut lnks); // depth MAX_DEPTH: this folder only
        }
        lnks.sort();
        found = lnks.into_iter().map(|l| TaskbarPin::Shortcut(l.to_string_lossy().into_owned())).collect();
    }
    found
        .into_iter()
        .map(|f| match f {
            TaskbarPin::App(aumid) => {
                let app_id = format!("aumid:{aumid}");
                Pin { name: fallback_name(&app_id), app_id, relaunch: None }
            }
            TaskbarPin::Shortcut(lnk) => {
                let p = Path::new(&lnk);
                let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let name = stem.strip_suffix(".exe").unwrap_or(&stem).to_string(); // "Tool.exe.lnk" names "Tool"
                let aumid = shortcut_aumid(&lnk);
                // File Explorer's shortcut points at a shell folder; the strip knows its windows as explorer.exe's
                let explorer = (aumid.as_deref() == Some("Microsoft.Windows.Explorer"))
                    .then(|| std::env::var("WINDIR").ok().map(|w| format!(r"{w}\explorer.exe")))
                    .flatten();
                let target = target_args(p).filter(|(_, args)| !args).map(|(t, _)| t).or(explorer);
                let app_id = shortcut_id(&lnk, aumid.as_deref(), target.as_deref(), running);
                Pin { app_id, name, relaunch: None }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn junk_dropped_one_per_name_sorted_and_exe_kept_only_for_exes() {
        let lnks = ["Zoom.lnk", "Uninstall Zoom.lnk", "code\\Visual Studio Code.lnk", "zoom.lnk", "Site.lnk"]
            .iter()
            .map(|p| PathBuf::from("C:\\SM").join(p))
            .collect();
        let list = to_list(lnks, |p| match p.file_stem()?.to_str()? {
            "Visual Studio Code" => Some("C:\\VS\\Code.exe".into()),
            "Site" => Some("https://x".into()),
            _ => None,
        });
        let shape: Vec<_> = list.iter().map(|a| (a.name.as_str(), a.exe.as_deref())).collect();
        assert_eq!(shape, [("Site", None), ("Visual Studio Code", Some("code.exe")), ("Zoom", None)]);
        assert!(list[1].app_id.starts_with("lnk:C:\\SM\\code\\") && list[1].app_id.ends_with(".lnk"));
    }
}
