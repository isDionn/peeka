//! The current user's DPAPI behind `notch_core::clip::vault::Protect`: `CryptProtectData` /
//! `CryptUnprotectData` with `CRYPTPROTECT_UI_FORBIDDEN` and the install's random entropy. DPAPI keeps other user
//! accounts and a stolen disk out; it does NOT keep out programs running as the same user.

pub struct Dpapi;

#[cfg(windows)]
impl notch_core::clip::vault::Protect for Dpapi {
    fn seal(&self, plain: &[u8], entropy: &[u8]) -> Option<Vec<u8>> {
        call(plain, entropy, true).map(|s| s.bytes().to_vec())
    }

    fn open(&self, blob: &[u8], entropy: &[u8]) -> Option<notch_core::clip::vault::Secret> {
        call(blob, entropy, false)
    }
}

#[cfg(windows)]
fn call(data: &[u8], entropy: &[u8], seal: bool) -> Option<notch_core::clip::vault::Secret> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let ent = CRYPT_INTEGER_BLOB { cbData: entropy.len() as u32, pbData: entropy.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: the input blobs point at live slices DPAPI only reads; `out` is LocalAlloc'd by DPAPI, copied, zeroed
    // and freed with LocalFree as the API asks.
    unsafe {
        let r = if seal {
            CryptProtectData(&input, PCWSTR::null(), Some(&ent), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, None, Some(&ent), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        r.ok()?;
        let slice = std::slice::from_raw_parts_mut(out.pbData, out.cbData as usize);
        let copy = notch_core::clip::vault::Secret::new(slice.to_vec());
        notch_core::clip::vault::wipe(slice);
        let _ = LocalFree(Some(HLOCAL(out.pbData.cast())));
        Some(copy)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use notch_core::clip::vault::Protect;

    /// Safe to run anywhere: no window, no clipboard, only this test's own bytes under the current user.
    #[test]
    fn round_trip_and_the_wrong_entropy_fails() {
        let plain = b"sahte-parola-123";
        let blob = Dpapi.seal(plain, b"entropy-1").expect("DPAPI seal");
        assert!(!blob.windows(plain.len()).any(|w| w == plain), "the blob is not the plaintext");
        assert_eq!(Dpapi.open(&blob, b"entropy-1").expect("DPAPI open").bytes(), plain);
        assert!(Dpapi.open(&blob, b"entropy-2").is_none(), "the install's entropy is part of the key");
    }
}
