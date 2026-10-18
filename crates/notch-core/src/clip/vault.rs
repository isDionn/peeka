//! The password store: `<data>/clipboard/vault.bin`, apart from the plain history. A header with this
//! install's random DPAPI entropy, then `SLOTS` fixed-size slots, each one item's metadata and its DPAPI blob. A
//! deleted or expired slot is overwritten with zeros in place and the file is synced. Expired slots are wiped when
//! the file is opened, before anything is decrypted (Notch was closed when they ran out).
//! The cipher is a port ([`Protect`]): DPAPI in `notch-win`, a fake in the tests. Never logged, never exported.

use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub const SLOTS: usize = 20;
pub const SLOT: usize = 16 * 1024;
const MAGIC: &[u8; 8] = b"NOTCHPW1";
const ENTROPY: usize = 32;
const HEADER: usize = 64;
const ID: usize = 32;
const SOURCE: usize = 64;
// used(1) id(32) created(8) expires(8) source_len(1) source(64) blob_len(4)
const META: usize = 1 + ID + 8 + 8 + 1 + SOURCE + 4;
/// The biggest DPAPI blob a slot holds; a bigger password text is not stored at all.
pub const MAX_BLOB: usize = SLOT - META;

/// The current user's DPAPI (`CryptProtectData` / `CryptUnprotectData`, `CRYPTPROTECT_UI_FORBIDDEN`).
pub trait Protect {
    fn seal(&self, plain: &[u8], entropy: &[u8]) -> Option<Vec<u8>>;
    fn open(&self, blob: &[u8], entropy: &[u8]) -> Option<Secret>;
}

/// Plaintext bytes that are zeroed when dropped (best effort: copies the OS or the WebView made are out of reach).
pub struct Secret(Vec<u8>);

impl Secret {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(..)")
    }
}

/// Zeroes the buffer with volatile writes (so the compiler cannot drop them as dead stores).
pub fn wipe(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        // SAFETY: a valid, aligned, exclusive pointer into the slice.
        unsafe { std::ptr::write_volatile(b, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

/// Zeroes a `String`'s bytes (all zero bytes are valid UTF-8), then empties it.
pub fn wipe_string(s: &mut String) {
    // SAFETY: zero bytes keep the string valid UTF-8.
    wipe(unsafe { s.as_bytes_mut() });
    s.clear();
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meta {
    pub id: String,
    pub created_ms: u64,
    pub expires_ms: u64,
    pub source: Option<String>,
}

pub struct Vault {
    path: PathBuf,
    entropy: [u8; ENTROPY],
    slots: Vec<Option<(Meta, Vec<u8>)>>,
}

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("clipboard").join("vault.bin")
}

fn parse_slot(b: &[u8]) -> Option<(Meta, Vec<u8>)> {
    if b.first() != Some(&1) {
        return None;
    }
    let id = std::str::from_utf8(&b[1..1 + ID]).ok()?.to_string();
    let at = 1 + ID;
    let created_ms = u64::from_le_bytes(b[at..at + 8].try_into().ok()?);
    let expires_ms = u64::from_le_bytes(b[at + 8..at + 16].try_into().ok()?);
    let slen = b[at + 16] as usize;
    let src = &b[at + 17..at + 17 + SOURCE];
    let source = (slen > 0 && slen <= SOURCE).then(|| String::from_utf8_lossy(&src[..slen]).into_owned());
    let blen = u32::from_le_bytes(b[META - 4..META].try_into().ok()?) as usize;
    let blob = b.get(META..META + blen)?.to_vec();
    Some((Meta { id, created_ms, expires_ms, source }, blob))
}

fn encode_slot(meta: &Meta, blob: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; SLOT];
    out[0] = 1;
    out[1..1 + meta.id.len().min(ID)].copy_from_slice(&meta.id.as_bytes()[..meta.id.len().min(ID)]);
    let at = 1 + ID;
    out[at..at + 8].copy_from_slice(&meta.created_ms.to_le_bytes());
    out[at + 8..at + 16].copy_from_slice(&meta.expires_ms.to_le_bytes());
    // The name is cut on a char boundary at 64 bytes.
    let src = meta.source.as_deref().unwrap_or("");
    let mut end = src.len().min(SOURCE);
    while !src.is_char_boundary(end) {
        end -= 1;
    }
    out[at + 16] = end as u8;
    out[at + 17..at + 17 + end].copy_from_slice(&src.as_bytes()[..end]);
    out[META - 4..META].copy_from_slice(&(blob.len() as u32).to_le_bytes());
    out[META..META + blob.len()].copy_from_slice(blob);
    out
}

#[derive(Debug, PartialEq, Eq)]
pub enum VaultErr {
    /// DPAPI said no, or the blob does not fit a slot.
    Seal,
    Io,
}

impl Vault {
    /// Reads the file; expired slots are zeroed on disk before anything else (no decryption needed for that).
    /// A missing or foreign file starts empty with fresh entropy (written on the first `put`).
    pub fn load(path: PathBuf, now_ms: u64) -> Self {
        let mut v = Self { path, entropy: [0; ENTROPY], slots: vec![None; SLOTS] };
        let raw = std::fs::read(&v.path).ok().filter(|r| r.len() == HEADER + SLOTS * SLOT && &r[..8] == MAGIC);
        let Some(mut raw) = raw else {
            let _ = getrandom::fill(&mut v.entropy);
            let _ = std::fs::remove_file(&v.path); // not ours or cut short: nothing in it can be trusted
            return v;
        };
        v.entropy.copy_from_slice(&raw[8..8 + ENTROPY]);
        let mut expired = vec![];
        for i in 0..SLOTS {
            let at = HEADER + i * SLOT;
            match parse_slot(&raw[at..at + SLOT]) {
                Some((m, _)) if m.expires_ms <= now_ms => expired.push(i),
                Some(s) => v.slots[i] = Some(s),
                None => {}
            }
        }
        wipe(&mut raw);
        for i in expired {
            let _ = v.write_slot(i, None);
        }
        v
    }

    /// Demo mode: empty, nothing read; the caller never puts into it, so it never writes.
    pub fn empty(path: PathBuf) -> Self {
        Self { path, entropy: [0; ENTROPY], slots: vec![None; SLOTS] }
    }

    pub fn list(&self) -> impl Iterator<Item = &Meta> {
        self.slots.iter().flatten().map(|(m, _)| m)
    }

    fn file(&self) -> std::io::Result<File> {
        if !self.path.exists() {
            std::fs::create_dir_all(self.path.parent().ok_or(std::io::ErrorKind::NotFound)?)?;
            let mut f = File::create(&self.path)?;
            let mut header = vec![0u8; HEADER];
            header[..8].copy_from_slice(MAGIC);
            header[8..8 + ENTROPY].copy_from_slice(&self.entropy);
            f.write_all(&header)?;
            f.write_all(&vec![0u8; SLOTS * SLOT])?;
            f.sync_all()?;
        }
        OpenOptions::new().read(true).write(true).open(&self.path)
    }

    /// One slot on disk: the item, or zeros over the old bytes. Synced before returning.
    fn write_slot(&mut self, i: usize, item: Option<(Meta, Vec<u8>)>) -> std::io::Result<()> {
        let bytes = item.as_ref().map_or_else(|| vec![0u8; SLOT], |(m, b)| encode_slot(m, b));
        self.slots[i] = item;
        let mut f = self.file()?;
        f.seek(SeekFrom::Start((HEADER + i * SLOT) as u64))?;
        f.write_all(&bytes)?;
        f.sync_data()
    }

    /// Encrypts and stores; the oldest item goes when all slots are taken. `plain` is wiped by the caller's drop.
    pub fn put(&mut self, meta: Meta, plain: &Secret, p: &dyn Protect) -> Result<Option<String>, VaultErr> {
        if self.entropy == [0; ENTROPY] {
            return Err(VaultErr::Seal); // getrandom failed at load (L-10): no password is kept rather than a weak one
        }
        let blob = p.seal(plain.bytes(), &self.entropy).ok_or(VaultErr::Seal)?;
        if blob.len() > MAX_BLOB {
            return Err(VaultErr::Seal);
        }
        let (i, evicted) = match self.slots.iter().position(Option::is_none) {
            Some(i) => (i, None),
            None => {
                let (i, m) = self
                    .slots
                    .iter()
                    .enumerate()
                    .filter_map(|(i, s)| s.as_ref().map(|(m, _)| (i, m)))
                    .min_by_key(|(_, m)| m.created_ms)
                    .ok_or(VaultErr::Io)?;
                (i, Some(m.id.clone()))
            }
        };
        self.write_slot(i, Some((meta, blob))).map_err(|_| VaultErr::Io)?;
        Ok(evicted)
    }

    pub fn reveal(&self, id: &str, p: &dyn Protect) -> Option<Secret> {
        let (_, blob) = self.slots.iter().flatten().find(|(m, _)| m.id == id)?;
        p.open(blob, &self.entropy)
    }

    /// Zeroes the item's slot on disk. False = no such item.
    pub fn remove(&mut self, id: &str) -> bool {
        let Some(i) = self.slots.iter().position(|s| s.as_ref().is_some_and(|(m, _)| m.id == id)) else {
            return false;
        };
        let _ = self.write_slot(i, None);
        true
    }

    /// Every item past its time goes from the file (zeroed); returns their ids.
    pub fn expire(&mut self, now_ms: u64) -> Vec<String> {
        let ids: Vec<String> = self.list().filter(|m| m.expires_ms <= now_ms).map(|m| m.id.clone()).collect();
        for id in &ids {
            self.remove(id);
        }
        ids
    }

    /// A shorter lifetime in Settings applies to what is already stored (never longer).
    pub fn clamp(&mut self, ttl_ms: u64) {
        let updates: Vec<usize> = (0..SLOTS)
            .filter(|&i| self.slots[i].as_ref().is_some_and(|(m, _)| m.expires_ms > m.created_ms + ttl_ms))
            .collect();
        for i in updates {
            if let Some((mut m, b)) = self.slots[i].take() {
                m.expires_ms = m.created_ms + ttl_ms;
                let _ = self.write_slot(i, Some((m, b)));
            }
        }
    }

    /// "Delete all" / history off: every slot zeroed, then the file deleted.
    pub fn destroy(&mut self) -> std::io::Result<()> {
        if self.path.exists() {
            for i in 0..SLOTS {
                self.write_slot(i, None)?;
            }
            std::fs::remove_file(&self.path)?;
        }
        self.slots = vec![None; SLOTS];
        Ok(())
    }

    /// For the tests: the raw file.
    #[cfg(test)]
    pub fn raw(&self) -> Vec<u8> {
        use std::io::Read;
        let mut b = vec![];
        if let Ok(mut f) = File::open(&self.path) {
            let _ = f.read_to_end(&mut b);
        }
        b
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;
    use std::cell::Cell;

    /// XOR with the entropy, plus a counter of `open` calls (an expired item must never be decrypted).
    #[derive(Default)]
    pub struct Xor {
        pub opens: Cell<u32>,
    }

    impl Protect for Xor {
        fn seal(&self, plain: &[u8], entropy: &[u8]) -> Option<Vec<u8>> {
            Some(plain.iter().zip(entropy.iter().cycle()).map(|(a, b)| a ^ b ^ 0x5a).collect())
        }
        fn open(&self, blob: &[u8], entropy: &[u8]) -> Option<Secret> {
            self.opens.set(self.opens.get() + 1);
            Some(Secret::new(blob.iter().zip(entropy.iter().cycle()).map(|(a, b)| a ^ b ^ 0x5a).collect()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::Xor;
    use super::*;
    use crate::test_util::Tmp;

    fn meta(id: &str, created: u64, ttl: u64) -> Meta {
        Meta { id: id.into(), created_ms: created, expires_ms: created + ttl, source: Some("Bitwarden".into()) }
    }

    fn id(n: u8) -> String {
        format!("{n:032x}")
    }

    fn contains(hay: &[u8], needle: &[u8]) -> bool {
        hay.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn stored_encrypted_revealed_and_an_expired_slot_is_zeroed_in_the_file() {
        let tmp = Tmp::new();
        let p = Xor::default();
        let mut v = Vault::load(path(tmp.path()), 0);
        v.put(meta(&id(1), 1000, 60_000), &Secret::new(b"hunter2-hunter2".to_vec()), &p).unwrap();
        assert!(!contains(&v.raw(), b"hunter2"), "never plaintext on disk");
        assert_eq!(v.reveal(&id(1), &p).unwrap().bytes(), b"hunter2-hunter2");

        // The fake clock moves past the lifetime.
        assert_eq!(v.expire(61_000), vec![id(1)]);
        let raw = v.raw();
        assert!(raw[HEADER..HEADER + SLOT].iter().all(|&b| b == 0), "the slot is zeros");
        assert!(v.reveal(&id(1), &p).is_none() && v.list().count() == 0);
    }

    #[test]
    fn items_that_ran_out_while_notch_was_closed_are_wiped_unread() {
        let tmp = Tmp::new();
        let p = Xor::default();
        let mut v = Vault::load(path(tmp.path()), 0);
        v.put(meta(&id(1), 0, 5 * 60_000), &Secret::new(b"aaaa1111".to_vec()), &p).unwrap();
        v.put(meta(&id(2), 0, 60 * 60_000), &Secret::new(b"bbbb2222".to_vec()), &p).unwrap();
        drop(v);
        let p2 = Xor::default();
        let v = Vault::load(path(tmp.path()), 10 * 60_000);
        assert_eq!(v.list().map(|m| m.id.clone()).collect::<Vec<_>>(), vec![id(2)]);
        assert_eq!(p2.opens.get(), 0, "nothing decrypted to expire it");
        assert!(v.raw()[HEADER..HEADER + SLOT].iter().all(|&b| b == 0));
        assert_eq!(v.reveal(&id(2), &p2).unwrap().bytes(), b"bbbb2222");
    }

    #[test]
    fn full_evicts_the_oldest_and_destroy_removes_the_file() {
        let tmp = Tmp::new();
        let p = Xor::default();
        let mut v = Vault::load(path(tmp.path()), 0);
        for n in 0..SLOTS as u8 {
            assert_eq!(v.put(meta(&id(n), n as u64, 60_000), &Secret::new(vec![b'x'; 8]), &p).unwrap(), None);
        }
        assert_eq!(v.put(meta(&id(99), 100, 60_000), &Secret::new(vec![b'y'; 8]), &p).unwrap(), Some(id(0)));
        let big = Secret::new(vec![b'z'; MAX_BLOB + 1]);
        assert_eq!(v.put(meta(&id(98), 1, 1), &big, &p), Err(VaultErr::Seal), "too big: not stored at all");
        v.clamp(30);
        assert!(v.list().all(|m| m.expires_ms <= m.created_ms + 30));
        v.destroy().unwrap();
        assert!(!path(tmp.path()).exists() && v.list().count() == 0);
    }

    #[test]
    fn no_entropy_means_no_password_is_kept() {
        let tmp = Tmp::new();
        let mut v = Vault::load(path(tmp.path()), 0);
        v.entropy = [0; ENTROPY];
        let meta = Meta { id: "p1".into(), created_ms: 0, expires_ms: 60_000, source: None };
        assert_eq!(v.put(meta, &Secret::new(b"hunter2".to_vec()), &Xor::default()), Err(VaultErr::Seal));
        assert_eq!(v.list().count(), 0);
    }

    #[test]
    fn a_foreign_file_is_not_trusted() {
        let tmp = Tmp::new();
        tmp.write("clipboard/vault.bin", b"not a vault");
        let v = Vault::load(path(tmp.path()), 0);
        assert_eq!(v.list().count(), 0);
        assert!(!path(tmp.path()).exists());
    }

    #[test]
    fn wipe_zeroes() {
        let mut s = String::from("gizli123");
        wipe_string(&mut s);
        assert!(s.is_empty());
        let mut b = vec![1u8, 2, 3];
        wipe(&mut b);
        assert_eq!(b, [0, 0, 0]);
    }
}
