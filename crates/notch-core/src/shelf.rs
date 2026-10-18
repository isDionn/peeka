//! The shelf (`raf`, Wave 5): files dropped on the island, kept in Rust for the session (a page reload keeps them).
//! The page gets names only; paths stay here and leave only through `share_open` (the Windows share sheet) and
//! `shelf_ask` (a one-shot share to the main assistant).

use std::path::{Path, PathBuf};

use serde::Serialize;

/// shortcut: in memory only and capped at 20; persist if the owner wants the shelf to survive a restart.
pub const MAX: usize = 20;

/// `wave5-api.ts` `ShelfItem`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShelfItem {
    pub id: String,
    pub name: String,
    pub sub: String,
    pub kind: &'static str,
}

/// What the Windows share sheet gets (`share_open`).
#[derive(Debug, PartialEq, Eq)]
pub enum ShareTarget {
    Text(String),
    Files(Vec<PathBuf>),
}

#[derive(Default)]
pub struct Shelf {
    items: Vec<(ShelfItem, PathBuf)>,
    next: u64,
}

/// pdf | video | sheet | image | other, from the extension.
pub fn kind_of(path: &Path) -> &'static str {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
    match ext.as_str() {
        "pdf" => "pdf",
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "m4v" => "video",
        "xlsx" | "xls" | "csv" | "ods" | "numbers" => "sheet",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "heic" | "svg" | "tif" | "tiff" => "image",
        _ => "other",
    }
}

/// Extensions Windows runs as code or a script. "Aç" on a copied or downloaded file never launches these (the owner
/// can still find them with "Klasörde göster"): one click on a notification must not be able to start a program.
const RUNNABLE: &[&str] = &[
    "exe", "msi", "msix", "appx", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf",
    "wsh", "hta", "cpl", "msc", "reg", "lnk", "url", "jar", "dll", "sys", "gadget", "application", "appref-ms",
];

/// A file Windows would run rather than open (`RUNNABLE`), by extension. A name with no extension is not one.
pub fn runnable(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
    RUNNABLE.contains(&ext.as_str())
}

/// 2_400_000 -> "2,3 MB"; None (a folder) -> "Klasör".
pub fn size_text(bytes: Option<u64>) -> String {
    let Some(b) = bytes else { return "Klasör".into() };
    let one = |v: f64, unit: &str| format!("{v:.1} {unit}").replace('.', ",");
    match b {
        0..=1023 => format!("{b} B"),
        1024..=1_048_575 => format!("{} KB", b / 1024),
        1_048_576..=1_073_741_823 => one(b as f64 / 1_048_576.0, "MB"),
        _ => one(b as f64 / 1_073_741_824.0, "GB"),
    }
}

impl Shelf {
    /// Dropped paths with their size (None = a folder). A path already on the shelf moves to the top. True = changed.
    pub fn add(&mut self, dropped: Vec<(PathBuf, Option<u64>)>) -> bool {
        let mut changed = false;
        for (path, size) in dropped {
            let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
            self.items.retain(|(_, p)| p != &path);
            self.next += 1;
            let kind = if size.is_some() { kind_of(&path) } else { "other" };
            let item = ShelfItem { id: format!("raf-{}", self.next), name, sub: size_text(size), kind };
            self.items.insert(0, (item, path));
            changed = true;
        }
        self.items.truncate(MAX);
        changed
    }

    pub fn list(&self) -> Vec<ShelfItem> {
        self.items.iter().map(|(i, _)| i.clone()).collect()
    }

    /// Only ids Notch handed out.
    pub fn path(&self, id: &str) -> Option<&Path> {
        self.items.iter().find(|(i, _)| i.id == id).map(|(_, p)| p.as_path())
    }
}

/// Why a shelf file did not go to the main assistant.
#[derive(Debug, PartialEq, Eq)]
pub enum CopyErr {
    /// A folder or something that is not a plain file.
    NotFile,
    /// A password-class file: by name (`.kdbx`, `.pem`, `id_rsa`, `.env`, `credentials`, bank…) or, for a text
    /// file, by content (the clipboard's password patterns).
    Password,
    /// Over `fidelity::ATTACH_MAX_BYTES`.
    TooBig,
    Io,
}

/// A password-class file name (`CopyErr::Password`); the shelf copy and the paperclip both ask this.
pub fn password_name(name: &str) -> bool {
    crate::clip::secret::sensitive_title(name)
}

/// A text file that holds a secret (the clipboard's password patterns); binary content is not judged.
pub fn password_text(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok_and(crate::clip::secret::has_secret)
}

/// `shelf.suggest` / `shelf.memory`: the shelf file COPIED into the one-shot share folder (the main assistant reads
/// only that one; `share::sweep` removes it after `share::TTL`). Returns the copy's path, never the original.
pub fn share_copy(data_dir: &Path, path: &Path) -> Result<PathBuf, CopyErr> {
    let meta = std::fs::metadata(path).map_err(|_| CopyErr::Io)?;
    if !meta.is_file() {
        return Err(CopyErr::NotFile);
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if password_name(&name) {
        return Err(CopyErr::Password);
    }
    if meta.len() > crate::fidelity::ATTACH_MAX_BYTES {
        return Err(CopyErr::TooBig);
    }
    let bytes = std::fs::read(path).map_err(|_| CopyErr::Io)?;
    if password_text(&bytes) {
        return Err(CopyErr::Password);
    }
    let ext = crate::fidelity::share_ext(&name);
    crate::plugins::share::put(data_dir, &bytes, &ext).map(|(_, p)| p).map_err(|_| CopyErr::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_newest_first_deduped_capped_and_ids_are_ours() {
        let mut s = Shelf::default();
        assert!(s.add(vec![(r"C:\a\Rapor.PDF".into(), Some(2_400_000)), (r"C:\a\klasor".into(), None)]));
        let l = s.list();
        assert_eq!((l[0].name.as_str(), l[0].sub.as_str(), l[0].kind), ("klasor", "Klasör", "other"));
        assert_eq!((l[1].sub.as_str(), l[1].kind), ("2,3 MB", "pdf"));
        s.add(vec![(r"C:\a\Rapor.PDF".into(), Some(1))]);
        assert_eq!(s.list().len(), 2, "same path once");
        assert_eq!(s.list()[0].name, "Rapor.PDF");
        assert_eq!(s.path(&s.list()[0].id), Some(Path::new(r"C:\a\Rapor.PDF")));
        assert_eq!(s.path("raf-999"), None);
        assert_eq!(s.path(r"C:\a\Rapor.PDF"), None, "a path is not an id");
        s.add((0..30).map(|i| (PathBuf::from(format!("f{i}.mp4")), Some(5))).collect());
        assert_eq!(s.list().len(), MAX);
        assert_eq!(s.list()[0].kind, "video");
        assert!(!s.add(vec![]));
        assert_eq!(size_text(Some(2048)), "2 KB");
    }

    #[test]
    fn a_shelf_file_goes_as_a_one_shot_copy_and_never_a_password() {
        use crate::plugins::share;
        use std::time::SystemTime;
        let tmp = crate::test_util::Tmp::new();
        let src = tmp.path().join("kaynak");
        std::fs::create_dir_all(&src).unwrap();
        let put = |name: &str, body: &[u8]| {
            let p = src.join(name);
            std::fs::write(&p, body).unwrap();
            p
        };
        let pdf = put("Rapor.PDF", b"%PDF-1.7 rapor");
        let copy = share_copy(tmp.path(), &pdf).unwrap();
        assert!(copy.starts_with(share::dir(tmp.path())) && copy != pdf, "the copy, not the original");
        assert_eq!(
            (copy.extension().unwrap(), std::fs::read(&copy).unwrap()),
            ("pdf".as_ref(), b"%PDF-1.7 rapor".to_vec())
        );
        share::sweep(tmp.path(), SystemTime::now() + share::TTL, share::TTL);
        assert!(!copy.exists() && pdf.exists(), "the copy expires after ten minutes, the original stays");
        for name in ["kasa.kdbx", "id_rsa", ".env", "sunucu.pem", "aws credentials.txt"] {
            assert_eq!(share_copy(tmp.path(), &put(name, b"x")), Err(CopyErr::Password), "{name}");
        }
        let key = put("notlar.txt", concat!("anahtar: sk-ant-api03-abcdefghijklmnop", "qrstuvwxyz012345").as_bytes()); // allow-secret
        assert_eq!(share_copy(tmp.path(), &key), Err(CopyErr::Password), "a secret inside a text file");
        assert_eq!(share_copy(tmp.path(), &src), Err(CopyErr::NotFile), "a folder");
        assert_eq!(share_copy(tmp.path(), &src.join("yok.pdf")), Err(CopyErr::Io));
        let big = std::fs::File::create(src.join("buyuk.bin")).unwrap();
        big.set_len(crate::fidelity::ATTACH_MAX_BYTES + 1).unwrap();
        assert_eq!(share_copy(tmp.path(), &src.join("buyuk.bin")), Err(CopyErr::TooBig));
        assert_eq!(
            std::fs::read_dir(share::dir(tmp.path())).map(|d| d.count()).unwrap_or(0),
            0,
            "nothing refused was copied"
        );
    }
}
