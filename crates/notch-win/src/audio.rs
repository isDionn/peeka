//! Audio switcher: the active output devices (`IMMDeviceEnumerator`), the default one set through the undocumented
//! `IPolicyConfig` (`set_default_output`, the only place it is used), and the default microphone's mute.

#[cfg(windows)]
use notch_core::status::AudioOutput;
#[cfg(windows)]
use windows::core::{GUID, PCWSTR};
#[cfg(windows)]
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eMultimedia, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
#[cfg(windows)]
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};

#[cfg(windows)]
fn enumerator() -> Option<IMMDeviceEnumerator> {
    crate::com();
    // SAFETY: plain COM creation; released on drop.
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()
}

#[cfg(windows)]
fn id(device: &IMMDevice) -> Option<String> {
    // SAFETY: the id string is freed with CoTaskMemFree as documented.
    unsafe {
        let raw = device.GetId().ok()?;
        let id = raw.to_string().ok();
        CoTaskMemFree(Some(raw.0 as _));
        id
    }
}

#[cfg(windows)]
fn name(device: &IMMDevice) -> Option<String> {
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::STGM_READ;
    // PKEY_Device_FriendlyName (functiondiscoverykeys_devpkey.h); local so notch-win needs no extra windows feature.
    const FRIENDLY_NAME: PROPERTYKEY =
        PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };
    // SAFETY: a live device; the CoTaskMem string is read, then freed.
    unsafe {
        let value = device.OpenPropertyStore(STGM_READ).ok()?.GetValue(&FRIENDLY_NAME).ok()?;
        let s = PropVariantToStringAlloc(&value).ok()?;
        let out = s.to_string().ok();
        CoTaskMemFree(Some(s.0 as *const _));
        out.filter(|n| !n.is_empty())
    }
}

/// The active output devices in Windows's order (the UI keeps it, so a row never moves after a switch).
#[cfg(windows)]
pub fn outputs() -> Vec<AudioOutput> {
    let Some(devices) = enumerator() else { return Vec::new() };
    // SAFETY: plain COM calls on objects released on drop.
    unsafe {
        let default = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok().and_then(|d| id(&d));
        let Ok(list) = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return Vec::new() };
        (0..list.GetCount().unwrap_or(0))
            .filter_map(|i| {
                let d = list.Item(i).ok()?;
                let id = id(&d)?;
                Some(AudioOutput {
                    name: name(&d).unwrap_or_else(|| "Audio device".into()),
                    default: default.as_ref() == Some(&id),
                    id,
                })
            })
            .collect()
    }
}

#[cfg(windows)]
#[allow(non_snake_case, dead_code)] // Windows's own method names; the padding slots are never called
mod policy {
    use windows::core::{interface, IUnknown, IUnknown_Vtbl, HRESULT, PCWSTR};
    use windows::Win32::Media::Audio::ERole;

    /// `IPolicyConfig` (Windows 7+), undocumented: Windows's own Sound settings use it and Microsoft offers no public way
    /// to set the default device. Only `SetDefaultEndpoint` is called; the slots before it are declared to keep the
    /// vtable order and are never called.
    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    pub unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, a: PCWSTR, b: *mut *mut core::ffi::c_void) -> HRESULT;
        fn GetDeviceFormat(&self, a: PCWSTR, b: i32, c: *mut *mut core::ffi::c_void) -> HRESULT;
        fn ResetDeviceFormat(&self, a: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, a: PCWSTR, b: *mut core::ffi::c_void, c: *mut core::ffi::c_void) -> HRESULT;
        fn GetProcessingPeriod(&self, a: PCWSTR, b: i32, c: *mut i64, d: *mut i64) -> HRESULT;
        fn SetProcessingPeriod(&self, a: PCWSTR, b: *mut i64) -> HRESULT;
        fn GetShareMode(&self, a: PCWSTR, b: *mut core::ffi::c_void) -> HRESULT;
        fn SetShareMode(&self, a: PCWSTR, b: *mut core::ffi::c_void) -> HRESULT;
        fn GetPropertyValue(
            &self,
            a: PCWSTR,
            b: i32,
            c: *const core::ffi::c_void,
            d: *mut core::ffi::c_void,
        ) -> HRESULT;
        fn SetPropertyValue(
            &self,
            a: PCWSTR,
            b: i32,
            c: *const core::ffi::c_void,
            d: *mut core::ffi::c_void,
        ) -> HRESULT;
        pub fn SetDefaultEndpoint(&self, id: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, id: PCWSTR, visible: i32) -> HRESULT;
    }
}
#[cfg(windows)]
use policy::IPolicyConfig;

/// CPolicyConfigClient.
#[cfg(windows)]
const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// Makes `id` the default output for apps and media (the roles Windows's "Set as default" sets). The caller passes
/// only an id `outputs` returned. Err = the interface is missing or Windows refused; nothing else changes.
#[cfg(windows)]
pub fn set_default_output(id: &str) -> windows::core::Result<()> {
    crate::com();
    let id = windows::core::HSTRING::from(id);
    // SAFETY: the interface is queried by IID (a missing one is an error, not a crash); `id` outlives the calls.
    unsafe {
        let policy: IPolicyConfig = CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)?;
        policy.SetDefaultEndpoint(PCWSTR(id.as_ptr()), eConsole).ok()?;
        policy.SetDefaultEndpoint(PCWSTR(id.as_ptr()), eMultimedia).ok()
    }
}

#[cfg(windows)]
fn mic() -> Option<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume> {
    // SAFETY: plain COM calls on objects released on drop.
    unsafe { enumerator()?.GetDefaultAudioEndpoint(eCapture, eConsole).ok()?.Activate(CLSCTX_ALL, None).ok() }
}

/// The default microphone's mute; None = no microphone.
#[cfg(windows)]
pub fn mic_muted() -> Option<bool> {
    // SAFETY: a live endpoint.
    unsafe { mic()?.GetMute().ok() }.map(|m| m.as_bool())
}

/// False = no microphone / refused.
#[cfg(windows)]
pub fn set_mic_muted(muted: bool) -> bool {
    // SAFETY: a live endpoint; the context GUID outlives the call.
    mic().is_some_and(|m| unsafe { m.SetMute(muted, &crate::volume::NOTCH_CONTEXT) }.is_ok())
}

/// The default speaker's level meter (`IAudioMeterInformation`): it gives the output's peak level only, never the sound.
#[cfg(windows)]
pub fn meter() -> Option<windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation> {
    // SAFETY: plain COM calls on objects released on drop.
    unsafe { enumerator()?.GetDefaultAudioEndpoint(eRender, eConsole).ok()?.Activate(CLSCTX_ALL, None).ok() }
}

/// The current peak [left, right], 0..1 linear; a mono or surround device gives its overall peak on both.
#[cfg(windows)]
pub fn peaks(m: &windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation) -> Option<[f32; 2]> {
    // SAFETY: a live meter; the buffer holds exactly the 2 channels asked for.
    unsafe {
        if m.GetMeteringChannelCount().ok()? == 2 {
            let mut p = [0f32; 2];
            m.GetChannelsPeakValues(&mut p).ok()?;
            Some(p)
        } else {
            let p = m.GetPeakValue().ok()?;
            Some([p, p])
        }
    }
}
