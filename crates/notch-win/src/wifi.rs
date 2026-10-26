//! The Wi-Fi picker through the Native Wifi API (wlanapi.dll): scan, list, connect. What a row or an error means:
//! `notch_core::pickers`. A password goes only into the profile XML handed to `WlanSetProfile` (Windows stores it, as
//! its own Wi-Fi flyout does); it is never logged. After a failed connection a profile Peeka made is deleted again and a
//! known network's overwritten profile is put back (`pickers::undo`), so a wrong password never replaces a working one. Blocking (a scan waits up to 4 s, a connection up to 20 s).

#[cfg(windows)]
mod sys {
    use notch_core::pickers::{self, WifiError, WifiNetwork};
    use std::ptr::{addr_of, null_mut};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::time::{Duration, Instant};
    use windows::core::{GUID, HSTRING, PCWSTR};
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::{
        dot11_BSS_type_infrastructure, wlan_connection_mode_profile, wlan_notification_acm_connection_attempt_fail,
        wlan_notification_acm_connection_complete, wlan_notification_acm_scan_complete,
        wlan_notification_acm_scan_fail, WlanCloseHandle, WlanConnect, WlanDeleteProfile, WlanEnumInterfaces,
        WlanFreeMemory, WlanGetAvailableNetworkList, WlanGetProfile, WlanOpenHandle, WlanRegisterNotification, WlanScan,
        WlanSetProfile, L2_NOTIFICATION_DATA, WLAN_AVAILABLE_NETWORK, WLAN_AVAILABLE_NETWORK_CONNECTED,
        WLAN_CONNECTION_NOTIFICATION_DATA, WLAN_CONNECTION_PARAMETERS, WLAN_INTERFACE_INFO,
        WLAN_NOTIFICATION_SOURCES, WLAN_NOTIFICATION_SOURCE_ACM,
    };

    /// (interface, ACM notification code, the connection's reason code or 0).
    type Note = (GUID, u32, u32);

    /// One WLAN client handle with ACM notifications flowing into `rx`; unregistered, then closed, on drop.
    struct Session {
        h: HANDLE,
        rx: Receiver<Note>,
        _tx: Box<Sender<Note>>,
    }

    unsafe extern "system" fn on_note(data: *mut L2_NOTIFICATION_DATA, ctx: *mut core::ffi::c_void) {
        // SAFETY: Windows passes its notification and our context (the boxed Sender, alive until unregistered).
        let (Some(d), Some(tx)) = (unsafe { data.as_ref() }, unsafe { (ctx as *const Sender<Note>).as_ref() }) else {
            return;
        };
        if d.NotificationSource != WLAN_NOTIFICATION_SOURCE_ACM {
            return;
        }
        let code = d.NotificationCode;
        let is_conn = [wlan_notification_acm_connection_complete.0, wlan_notification_acm_connection_attempt_fail.0]
            .contains(&(code as i32));
        let fits = d.dwDataSize as usize >= std::mem::offset_of!(WLAN_CONNECTION_NOTIFICATION_DATA, dwFlags);
        let reason = if is_conn && fits && !d.pData.is_null() {
            // SAFETY: Windows documents pData as WLAN_CONNECTION_NOTIFICATION_DATA for these codes; size checked.
            unsafe { (*(d.pData as *const WLAN_CONNECTION_NOTIFICATION_DATA)).wlanReasonCode }
        } else {
            0
        };
        let _ = tx.send((d.InterfaceGuid, code, reason));
    }

    impl Session {
        fn open() -> Option<Session> {
            let (mut version, mut h) = (0u32, HANDLE::default());
            // SAFETY: out-params are ours; version 2 = Vista and later.
            if unsafe { WlanOpenHandle(2, None, &mut version, &mut h) } != 0 {
                return None;
            }
            let (tx, rx) = channel();
            let tx = Box::new(tx);
            let ctx = &*tx as *const Sender<Note> as *const core::ffi::c_void;
            // SAFETY: the context outlives the registration (unregistered in Drop before the box goes).
            unsafe { WlanRegisterNotification(h, WLAN_NOTIFICATION_SOURCE_ACM, true, Some(on_note), Some(ctx), None, None) };
            Some(Session { h, rx, _tx: tx })
        }

        fn interfaces(&self) -> Vec<GUID> {
            let mut list = null_mut();
            // SAFETY: Windows allocates the list; read within dwNumberOfItems, then freed with WlanFreeMemory.
            unsafe {
                if WlanEnumInterfaces(self.h, None, &mut list) != 0 || list.is_null() {
                    return vec![];
                }
                let first = addr_of!((*list).InterfaceInfo).cast::<WLAN_INTERFACE_INFO>();
                let out = (0..(*list).dwNumberOfItems as usize).map(|i| (*first.add(i)).InterfaceGuid).collect();
                WlanFreeMemory(list as _);
                out
            }
        }

        fn available(&self, iface: &GUID) -> Vec<Raw> {
            let mut list = null_mut();
            // SAFETY: as in `interfaces`.
            unsafe {
                if WlanGetAvailableNetworkList(self.h, iface, 0, None, &mut list) != 0 || list.is_null() {
                    return vec![];
                }
                let first = addr_of!((*list).Network).cast::<WLAN_AVAILABLE_NETWORK>();
                let out = (0..(*list).dwNumberOfItems as usize)
                    .map(|i| &*first.add(i))
                    .filter(|a| a.dot11BssType == dot11_BSS_type_infrastructure)
                    .map(|a| Raw {
                        ssid: a.dot11Ssid.ucSSID[..(a.dot11Ssid.uSSIDLength as usize).min(32)].to_vec(),
                        profile: crate::wide_to_string(&a.strProfileName),
                        signal: a.wlanSignalQuality.min(100) as u8,
                        secure: a.bSecurityEnabled.as_bool(),
                        connected: a.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED != 0,
                        auth: a.dot11DefaultAuthAlgorithm.0,
                    })
                    .collect();
                WlanFreeMemory(list as _);
                out
            }
        }

        /// A profile's XML as Windows stores it, its key left protected (flags 0: Peeka never sees the old password).
        fn profile_xml(&self, iface: &GUID, name: &str) -> Option<String> {
            let mut xml = windows::core::PWSTR::null();
            // SAFETY: our handle and interface; Windows allocates the string, read once, freed with WlanFreeMemory.
            unsafe {
                if WlanGetProfile(self.h, iface, &HSTRING::from(name), None, &mut xml, None, None) != 0 || xml.is_null() {
                    return None;
                }
                let out = xml.to_string().ok();
                WlanFreeMemory(xml.0 as _);
                out
            }
        }

        /// The first of `codes` for `iface` within `timeout`: (code, reason).
        fn wait(&self, iface: &GUID, codes: &[i32], timeout: Duration) -> Option<(u32, u32)> {
            let end = Instant::now() + timeout;
            loop {
                let (g, code, reason) = self.rx.recv_timeout(end.checked_duration_since(Instant::now())?).ok()?;
                if g == *iface && codes.contains(&(code as i32)) {
                    return Some((code, reason));
                }
            }
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            // SAFETY: our handle; source NONE unregisters (and waits for running callbacks) before the Sender drops.
            unsafe {
                WlanRegisterNotification(self.h, WLAN_NOTIFICATION_SOURCES(0), true, None, None, None, None);
                WlanCloseHandle(self.h, None);
            }
        }
    }

    struct Raw {
        ssid: Vec<u8>,
        profile: String,
        signal: u8,
        secure: bool,
        connected: bool,
        auth: i32,
    }

    impl Raw {
        fn name(&self) -> String {
            String::from_utf8_lossy(&self.ssid).into_owned()
        }
    }

    /// A fresh scan (up to 4 s), one row per network. None = no Wi-Fi adapter.
    pub fn networks() -> Option<Vec<WifiNetwork>> {
        let s = Session::open()?;
        let ifaces = s.interfaces();
        if ifaces.is_empty() {
            return None;
        }
        for g in &ifaces {
            // SAFETY: our handle and an interface it listed. A failed scan still leaves Windows's last list.
            unsafe { WlanScan(s.h, g, None, None, None) };
        }
        let done = [wlan_notification_acm_scan_complete.0, wlan_notification_acm_scan_fail.0];
        for g in &ifaces {
            s.wait(g, &done, Duration::from_secs(4));
        }
        let rows = ifaces.iter().flat_map(|g| s.available(g)).map(|r| WifiNetwork {
            ssid: r.name(),
            signal: r.signal,
            secure: r.secure,
            connected: r.connected,
            known: !r.profile.is_empty(),
        });
        Some(pickers::merge(rows.collect()))
    }

    /// A known network by its profile; a new one (or a known one with a new password) through a profile made here.
    pub fn connect(ssid: &str, password: Option<&str>) -> Result<(), WifiError> {
        let s = Session::open().ok_or(WifiError::Unsupported)?;
        let ifaces = s.interfaces();
        if ifaces.is_empty() {
            return Err(WifiError::Unsupported);
        }
        let (iface, net) = ifaces
            .iter()
            .find_map(|g| {
                let best = s.available(g).into_iter().filter(|r| r.name() == ssid).max_by_key(|r| !r.profile.is_empty());
                best.map(|r| (*g, r))
            })
            .ok_or(WifiError::Failed)?;
        let made = net.profile.is_empty();
        let mut previous = None;
        let profile = if !made && password.is_none() {
            net.profile.clone()
        } else {
            let sec = pickers::security(net.auth, net.secure).ok_or(WifiError::Unsupported)?;
            let name = if made { ssid.to_string() } else { net.profile.clone() };
            // No password (or not 8-63 characters) for a secured network: the page asks for one.
            let xml = pickers::profile_xml(&name, &net.ssid, sec, password).ok_or(WifiError::WrongPassword)?;
            if !made {
                previous = s.profile_xml(&iface, &name);
            }
            let mut reason = 0u32;
            // SAFETY: our handle, a listed interface, NUL-terminated strings that outlive the call.
            let r = unsafe { WlanSetProfile(s.h, &iface, 0, &HSTRING::from(xml), PCWSTR::null(), true, None, &mut reason) };
            if r != 0 {
                return Err(WifiError::Failed);
            }
            name
        };
        let wide = HSTRING::from(&profile);
        let params = WLAN_CONNECTION_PARAMETERS {
            wlanConnectionMode: wlan_connection_mode_profile,
            strProfile: PCWSTR(wide.as_ptr()),
            pDot11Ssid: null_mut(),
            pDesiredBssidList: null_mut(),
            dot11BssType: dot11_BSS_type_infrastructure,
            dwFlags: 0,
        };
        let done = [wlan_notification_acm_connection_complete.0, wlan_notification_acm_connection_attempt_fail.0];
        // SAFETY: our handle, a listed interface, parameters whose string outlives the call.
        let out = if unsafe { WlanConnect(s.h, &iface, &params, None) } != 0 {
            Err(WifiError::Failed)
        } else {
            match s.wait(&iface, &done, Duration::from_secs(20)) {
                Some((_, 0)) => Ok(()),
                Some((_, reason)) => Err(pickers::connect_error(reason, password.is_some())),
                None => Err(WifiError::Failed),
            }
        };
        match pickers::undo(out.is_err(), made, previous) {
            // SAFETY: our handle; the profile this call made.
            pickers::Undo::Delete => unsafe {
                WlanDeleteProfile(s.h, &iface, &wide, None);
            },
            pickers::Undo::Restore(xml) => {
                let mut reason = 0u32;
                // SAFETY: as for the WlanSetProfile above; the XML is Windows's own (key still protected).
                unsafe { WlanSetProfile(s.h, &iface, 0, &HSTRING::from(xml), PCWSTR::null(), true, None, &mut reason) };
            }
            pickers::Undo::Nothing => {}
        }
        out
    }
}

#[cfg(windows)]
pub use sys::{connect, networks};
