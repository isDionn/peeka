//! WinRT and service probes: radios (changes state, always restored), smtc and dpapi (read-only / self-contained).

use std::path::Path;
use std::time::Duration;

use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::{log, ops, radios_marker, read_json, write_json, RadiosMarker};

fn mta() {
    // SAFETY: COM init for this thread (WinRT `.get()` blocks: never on a window thread, none exists here).
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

fn access_text(s: RadioAccessStatus) -> String {
    match s {
        RadioAccessStatus::Allowed => "Allowed (permission granted)".into(),
        RadioAccessStatus::DeniedByUser => "DeniedByUser (the user refused)".into(),
        RadioAccessStatus::DeniedBySystem => "DeniedBySystem (Windows refused)".into(),
        RadioAccessStatus::Unspecified => "Unspecified (unclear)".into(),
        other => format!("unknown {}", other.0),
    }
}

fn kind_text(k: RadioKind) -> &'static str {
    match k {
        RadioKind::WiFi => "Wi-Fi",
        RadioKind::Bluetooth => "Bluetooth",
        RadioKind::MobileBroadband => "Mobile broadband",
        RadioKind::FM => "FM",
        _ => "other",
    }
}

fn state_text(s: windows::core::Result<RadioState>) -> String {
    match s {
        Ok(RadioState::On) => "on".into(),
        Ok(RadioState::Off) => "off".into(),
        Ok(RadioState::Disabled) => "disabled".into(),
        Ok(other) => format!("unknown ({})", other.0),
        Err(error) => format!("could not be read ({error})"),
    }
}

fn radios_now() -> Result<Vec<Radio>, String> {
    let list = Radio::GetRadiosAsync().and_then(|op| op.get()).map_err(|e| format!("Could not read the radios: {e}"))?;
    let n = list.Size().map_err(|e| e.to_string())?;
    Ok((0..n).filter_map(|i| list.GetAt(i).ok()).collect())
}

fn key(r: &Radio) -> Option<(i32, String)> {
    Some((r.Kind().ok()?.0, r.Name().ok()?.to_string()))
}

fn set(r: &Radio, on: bool) -> String {
    match r.SetStateAsync(if on { RadioState::On } else { RadioState::Off }).and_then(|op| op.get()) {
        Ok(status) => access_text(status),
        Err(error) => format!("ERROR ({error})"),
    }
}

/// Turn every radio the marker remembers back on, then delete the marker (kept if one would not come back).
pub fn restore_radios(marker: &Path) {
    mta();
    let m: RadiosMarker = read_json(marker).unwrap_or_default();
    log(&format!("Radio marker: {} radios should be on, checking.", m.on.len()));
    let Ok(radios) = radios_now() else {
        log("The radios could not be read; the marker stays for the next start.");
        return;
    };
    let mut all_back = true;
    for r in &radios {
        let Some(k) = key(r) else { continue };
        if m.on.contains(&k) && r.State().ok() != Some(RadioState::On) {
            let answer = set(r, true);
            let now = r.State().ok();
            all_back &= now == Some(RadioState::On);
            log(&format!(
                "  turning {} '{}' on: {answer}; now {}.",
                kind_text(RadioKind(k.0)),
                k.1,
                state_text(r.State())
            ));
        }
    }
    if all_back {
        let _ = std::fs::remove_file(marker);
    } else {
        log("A radio did not come back on: the marker stays, 'notch-probe restore' retries. If that fails, turn it on in Windows Settings.");
    }
}

pub fn radios(dir: &Path) -> Result<(), String> {
    mta();
    let access = Radio::RequestAccessAsync().and_then(|op| op.get());
    log(&format!(
        "Radio.RequestAccessAsync answer: {}",
        match access {
            Ok(s) => access_text(s),
            Err(ref e) => format!("ERROR ({e})"),
        }
    ));
    let radios = radios_now()?;
    log(&format!("{} radios found:", radios.len()));
    for r in &radios {
        let name = r.Name().map(|n| n.to_string()).unwrap_or_default();
        log(&format!("  {} '{name}': {}", r.Kind().map(kind_text).unwrap_or("?"), state_text(r.State())));
    }
    let targets: Vec<&Radio> = radios
        .iter()
        .filter(|r| {
            matches!(r.Kind(), Ok(RadioKind::WiFi | RadioKind::Bluetooth)) && r.State().ok() == Some(RadioState::On)
        })
        .collect();
    if targets.is_empty() {
        log("No Wi-Fi or Bluetooth is on: nothing was turned off. (To try it, first turn both on in Windows.)");
        return Ok(());
    }
    let marker = radios_marker(dir);
    // Before the first SetStateAsync(Off): a kill from here on is undone by the next start.
    write_json(&marker, &RadiosMarker { on: targets.iter().filter_map(|r| key(r)).collect() })?;
    {
        let _ops = ops();
        for r in &targets {
            let name = r.Name().map(|n| n.to_string()).unwrap_or_default();
            log(&format!(
                "  turning {} '{name}' off: {}; now {}.",
                r.Kind().map(kind_text).unwrap_or("?"),
                set(r, false),
                state_text(r.State())
            ));
        }
    }
    log("Waiting 5 s (check whether the icons went off in Windows)...");
    std::thread::sleep(Duration::from_secs(5));
    let _ops = ops();
    if crate::exiting() {
        return Ok(());
    }
    for r in &targets {
        let name = r.Name().map(|n| n.to_string()).unwrap_or_default();
        log(&format!(
            "  turning {} '{name}' back on: {}; now {}.",
            r.Kind().map(kind_text).unwrap_or("?"),
            set(r, true),
            state_text(r.State())
        ));
    }
    // Whatever is still off is retried from the marker (and the marker stays if it still fails).
    restore_radios(&marker);
    Ok(())
}

pub fn smtc() -> Result<(), String> {
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    mta();
    let manager =
        Manager::RequestAsync().and_then(|op| op.get()).map_err(|e| format!("Could not read the media sessions: {e}"))?;
    let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
    log(&format!("{} media sessions.", sessions.Size().unwrap_or(0)));
    let Ok(session) = manager.GetCurrentSession() else {
        log("No track is playing right now (no current session).");
        return Ok(());
    };
    let app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
    let props = session
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.get())
        .map_err(|e| format!("Could not read the track info: {e}"))?;
    let status = match session.GetPlaybackInfo().and_then(|p| p.PlaybackStatus()) {
        Ok(Status::Playing) => "playing",
        Ok(Status::Paused) => "paused",
        Ok(Status::Stopped) => "stopped",
        Ok(_) => "other",
        Err(_) => "unknown",
    };
    log(&format!(
        "Playing: '{}' — '{}' (album '{}'), app {app}, state: {status}.",
        props.Title().map(|s| s.to_string()).unwrap_or_default(),
        props.Artist().map(|s| s.to_string()).unwrap_or_default(),
        props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
    ));
    Ok(())
}

pub fn dpapi() -> Result<(), String> {
    use windows::core::w;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    // A fixed test string: never user data.
    const SAMPLE: &[u8] = b"Peeka DPAPI trial text 2026";
    let input = CRYPT_INTEGER_BLOB { cbData: SAMPLE.len() as u32, pbData: SAMPLE.as_ptr() as *mut u8 };
    let mut sealed = CRYPT_INTEGER_BLOB::default();
    let mut opened = CRYPT_INTEGER_BLOB::default();
    // SAFETY: input points at a static buffer; the outputs are allocated by Windows and freed with LocalFree below.
    unsafe {
        CryptProtectData(&input, w!("notch-probe"), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut sealed)
            .map_err(|e| format!("Encryption failed: {e}"))?;
        let unsealed = CryptUnprotectData(&sealed, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut opened);
        let same = unsealed.is_ok() && std::slice::from_raw_parts(opened.pbData, opened.cbData as usize) == SAMPLE;
        log(&format!(
            "DPAPI: a {}-byte trial text was encrypted to {} bytes; decryption {}; result {}.",
            SAMPLE.len(),
            sealed.cbData,
            match &unsealed {
                Ok(()) => "ok".to_string(),
                Err(e) => format!("FAILED ({e})"),
            },
            if same { "same (correct)" } else { "DIFFERENT" }
        ));
        let _ = LocalFree(Some(HLOCAL(sealed.pbData as *mut _)));
        if !opened.pbData.is_null() {
            let _ = LocalFree(Some(HLOCAL(opened.pbData as *mut _)));
        }
        if !same {
            return Err("The DPAPI round trip did not match".into());
        }
    }
    Ok(())
}
