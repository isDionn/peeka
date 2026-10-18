//! Volume events and the volume keys (owner decision 11).
//!
//! * `watch`: `IAudioEndpointVolumeCallback` on the default speaker, so a volume change anywhere arrives as an event
//!   (no polling of the level). Changes Notch itself makes carry `NOTCH_CONTEXT`, so the sink can tell them apart.
//!   shortcut: the default device is re-checked every 2 s (no `IMMNotificationClient`); a device switch is seen
//!   within 2 s. Upgrade if the owner notices.
//! * `hook_start` / `hook_stop`: a `WH_KEYBOARD_LL` hook on its own thread that swallows `VK_VOLUME_*` and hands the
//!   key to `press` on a worker (the hook procedure itself does no COM: Windows drops a hook that is slow). With no
//!   speaker the keys pass through to Windows. `unhook` is safe to call from anywhere, any number of times (exit,
//!   panic hook, the setting turned off). Windows also drops the hook when the process dies.
//!

#[cfg(windows)]
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};

#[cfg(windows)]
use notch_core::sources::VolumeKey;
#[cfg(windows)]
use notch_core::status::{self, Volume};
#[cfg(windows)]
use windows::core::{implement, GUID};
#[cfg(windows)]
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
#[cfg(windows)]
use windows::Win32::Media::Audio::AUDIO_VOLUME_NOTIFICATION_DATA;

/// The event context Notch passes with its own volume changes ("notch-volume" in hex).
#[cfg(windows)]
pub const NOTCH_CONTEXT: GUID = GUID::from_u128(0x6e6f7463_682d_766f_6c75_6d6500000000);

/// A default speaker exists (the hook swallows keys only then).
#[cfg(windows)]
static SPEAKER: AtomicBool = AtomicBool::new(true);

#[cfg(windows)]
type Sink = std::sync::Arc<dyn Fn(Volume, bool) + Send + Sync>;

#[cfg(windows)]
#[implement(IAudioEndpointVolumeCallback)]
struct Callback(Sink);

#[cfg(windows)]
impl IAudioEndpointVolumeCallback_Impl for Callback_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        // SAFETY: Windows passes a valid struct for the call's duration (or null, which `as_ref` turns into None).
        if let Some(d) = unsafe { data.as_ref() } {
            (self.0)(
                status::volume_from_scalar(d.fMasterVolume, d.bMuted.as_bool()),
                d.guidEventContext == NOTCH_CONTEXT,
            );
        }
        Ok(())
    }
}

/// The default speaker's id and endpoint.
#[cfg(windows)]
fn default_speaker() -> Option<(String, IAudioEndpointVolume)> {
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
    // SAFETY: plain COM calls; the id string is freed with CoTaskMemFree as documented.
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let speaker = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        let raw = speaker.GetId().ok()?;
        let id = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as _));
        Some((id, speaker.Activate(CLSCTX_ALL, None).ok()?))
    }
}

/// Starts the volume watcher for the process's life. `sink(volume, ours)`: `ours` = Notch made this change.
#[cfg(windows)]
pub fn watch(sink: impl Fn(Volume, bool) + Send + Sync + 'static) {
    std::thread::spawn(move || {
        crate::com();
        let callback: IAudioEndpointVolumeCallback = Callback(std::sync::Arc::new(sink)).into();
        let mut current: Option<(String, IAudioEndpointVolume)> = None;
        loop {
            let next = default_speaker();
            if next.as_ref().map(|n| &n.0) != current.as_ref().map(|c| &c.0) {
                if let Some((_, old)) = current.take() {
                    // SAFETY: the same callback object that was registered on it.
                    let _ = unsafe { old.UnregisterControlChangeNotify(&callback) };
                }
                // SAFETY: a live endpoint; the callback object lives as long as this thread (the process).
                current = next.filter(|(_, ep)| unsafe { ep.RegisterControlChangeNotify(&callback) }.is_ok());
                SPEAKER.store(current.is_some(), Ordering::SeqCst);
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

/// One volume key, done by Notch: the new level is set with `NOTCH_CONTEXT`. None = no speaker / refused.
#[cfg(windows)]
pub fn press(key: VolumeKey) -> Option<Volume> {
    let (_, ep) = default_speaker()?;
    // SAFETY: a live endpoint; the context GUID outlives the calls.
    unsafe {
        let now = status::volume_from_scalar(ep.GetMasterVolumeLevelScalar().ok()?, ep.GetMute().ok()?.as_bool());
        let (pct, muted) = key.apply(now);
        if pct != now.percent {
            ep.SetMasterVolumeLevelScalar(f32::from(pct) / 100.0, &NOTCH_CONTEXT).ok()?;
        }
        if muted != now.muted {
            ep.SetMute(muted, &NOTCH_CONTEXT).ok()?;
        }
        Some(Volume { percent: pct, muted })
    }
}

#[cfg(windows)]
static HOOK: AtomicIsize = AtomicIsize::new(0);
#[cfg(windows)]
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
#[cfg(windows)]
static KEYS: std::sync::OnceLock<std::sync::mpsc::Sender<VolumeKey>> = std::sync::OnceLock::new();

#[cfg(windows)]
unsafe extern "system" fn hook_proc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, HC_ACTION, KBDLLHOOKSTRUCT, WM_KEYDOWN, WM_SYSKEYDOWN,
    };
    if code == HC_ACTION as i32 && SPEAKER.load(Ordering::Relaxed) {
        // SAFETY: for HC_ACTION, lparam points at a KBDLLHOOKSTRUCT for the call's duration.
        let vk = unsafe { (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode };
        if let Some(key) = VolumeKey::from_vk(vk) {
            let down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            if down {
                if let Some(tx) = KEYS.get() {
                    let _ = tx.send(key);
                }
            }
            return LRESULT(1); // swallowed, the key-up too: Windows's own indicator never sees it
        }
    }
    // SAFETY: passing the event on unchanged.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Installs the hook (a second call while it is in does nothing). `on_key` runs on one worker thread, in order.
/// False = Windows refused the hook (the keys then stay Windows's).
#[cfg(windows)]
pub fn hook_start(on_key: impl Fn(VolumeKey) + Send + 'static) -> bool {
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG, WH_KEYBOARD_LL,
    };
    if HOOK.load(Ordering::SeqCst) != 0 {
        return true;
    }
    if KEYS.get().is_none() {
        let (tx, rx) = std::sync::mpsc::channel();
        if KEYS.set(tx).is_ok() {
            std::thread::spawn(move || {
                crate::com();
                for key in rx {
                    on_key(key);
                }
            });
        }
    }
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        // SAFETY: our own module handle; the procedure is a plain function that lives as long as the process.
        let hook = unsafe {
            let module = GetModuleHandleW(None).ok().map(Into::into);
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0)
        };
        let Ok(hook) = hook else {
            let _ = tx.send(false);
            return;
        };
        HOOK.store(hook.0 as isize, Ordering::SeqCst);
        // SAFETY: no arguments.
        HOOK_THREAD.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);
        let _ = tx.send(true);
        let mut msg = MSG::default();
        // SAFETY: the message loop a low-level hook needs on the thread that installed it; WM_QUIT ends it.
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        // Only this thread's own hook: after a quick off-on a newer hook may already be in HOOK.
        if HOOK.compare_exchange(hook.0 as isize, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            // SAFETY: our own handle, taken out of HOOK above so nobody else unhooks it.
            let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook) };
        }
    });
    rx.recv().unwrap_or(false)
}

/// Removes the hook now (any thread, idempotent): exit, the panic hook, the setting turned off.
#[cfg(windows)]
pub fn unhook() {
    use windows::Win32::UI::WindowsAndMessaging::{UnhookWindowsHookEx, HHOOK};
    let h = HOOK.swap(0, Ordering::SeqCst);
    if h != 0 {
        // SAFETY: the handle SetWindowsHookExW returned, unhooked once (the swap above).
        let _ = unsafe { UnhookWindowsHookEx(HHOOK(h as _)) };
    }
}

/// Unhooks and ends the hook thread's message loop.
#[cfg(windows)]
pub fn hook_stop() {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
    unhook();
    let t = HOOK_THREAD.swap(0, Ordering::SeqCst);
    if t != 0 {
        // SAFETY: posting WM_QUIT to our own hook thread.
        let _ = unsafe { PostThreadMessageW(t, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
}
