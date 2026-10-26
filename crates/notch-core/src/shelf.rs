//! The shelf (`shelf`, Wave 5): files dropped on the island, kept until the owner removes them (`shelf.json` in the data
//! folder; a file that is gone is dropped on the next start). Peeka's own copies (clipboard images, zips) live in
//! `copies_dir`. The page gets names only; paths stay here and leave only through the owner's clicks (open, copy, share,
//! drag out, zip, show in folder) and `shelf_ask` (a one-shot share to the main assistant).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// `wave5-api.ts` `ShelfItem`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShelfItem {
    pub id: String,
    pub name: String,
    pub sub: String,
    pub kind: &'static str,
    /// Kept at the top of the shelf.
    pub pinned: bool,
}

/// One `shelf.json` row: only the path and the pin; name, size and kind are read again on load.
#[derive(Serialize, Deserialize)]
struct Saved {
    path: PathBuf,
    #[serde(default)]
    pinned: bool,
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
    /// The data folder; None (tests, demo) = nothing is read or written.
    dir: Option<PathBuf>,
}

/// Where Peeka's own shelf files go (clipboard images, zips); Remove deletes only files in here.
pub fn copies_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("shelf")
}

/// Size of a file, None for a folder; None outside = the path is gone.
fn sized(path: &Path) -> Option<Option<u64>> {
    std::fs::metadata(path).ok().map(|m| (!m.is_dir()).then_some(m.len()))
}

/// The zip "Zip" makes in `dir`: `<name>.zip` for one item, `Shelf files.zip` for several, ` (2)` and up when taken.
pub fn zip_target(dir: &Path, paths: &[PathBuf]) -> PathBuf {
    let stem = match paths {
        [one] => one.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Shelf files".into()),
        _ => "Shelf files".into(),
    };
    (1..)
        .map(|n| dir.join(if n == 1 { format!("{stem}.zip") } else { format!("{stem} ({n}).zip") }))
        .find(|p| !p.exists())
        .expect("an unused name")
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

/// Extensions Windows runs as code or a script. "Open" on a copied or downloaded file never launches these (the owner
/// can still find them with "Show in folder"): one click on a notification must not be able to start a program.
const RUNNABLE: &[&str] = &[
    "exe", "msi", "msix", "appx", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf",
    "wsh", "hta", "cpl", "msc", "reg", "lnk", "url", "jar", "dll", "sys", "gadget", "application", "appref-ms",
];

/// A file Windows would run rather than open (`RUNNABLE`), by extension. A name with no extension is not one.
pub fn runnable(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
    RUNNABLE.contains(&ext.as_str())
}

/// 2_400_000 -> "2.3 MB" (English UI); None (a folder) -> "Folder".
pub fn size_text(bytes: Option<u64>) -> String {
    let Some(b) = bytes else { return "Folder".into() };
    let one = |v: f64, unit: &str| format!("{v:.1} {unit}");
    match b {
        0..=1023 => format!("{b} B"),
        1024..=1_048_575 => format!("{} KB", b / 1024),
        1_048_576..=1_073_741_823 => one(b as f64 / 1_048_576.0, "MB"),
        _ => one(b as f64 / 1_073_741_824.0, "GB"),
    }
}

impl Shelf {
    /// The saved shelf; entries whose file is gone are dropped, and Peeka copies nothing points to are deleted. A
    /// `shelf.json` that cannot be read is left alone with every copy (and nothing is saved over it this session).
    pub fn load(data_dir: &Path) -> Shelf {
        let saved: Option<Vec<Saved>> = match std::fs::read(data_dir.join("shelf.json")) {
            Ok(b) => serde_json::from_slice(&b).ok(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(vec![]),
            Err(_) => None,
        };
        let Some(saved) = saved else {
            eprintln!("[notch] could not read the shelf; it starts empty and the file is kept");
            return Shelf::default();
        };
        let mut s = Shelf { dir: Some(data_dir.to_path_buf()), ..Default::default() };
        for e in saved.into_iter().rev() {
            if let Some(size) = sized(&e.path) {
                s.put(e.path, size, e.pinned);
            }
        }
        for f in std::fs::read_dir(copies_dir(data_dir)).into_iter().flatten().flatten() {
            if !s.items.iter().any(|(_, p)| p == &f.path()) {
                let _ = std::fs::remove_file(f.path());
            }
        }
        s.save();
        s
    }

    fn save(&self) {
        let Some(dir) = &self.dir else { return };
        let rows: Vec<Saved> = self.items.iter().map(|(i, p)| Saved { path: p.clone(), pinned: i.pinned }).collect();
        let (path, tmp) = (dir.join("shelf.json"), dir.join("shelf.json.tmp"));
        let ok = serde_json::to_vec(&rows).is_ok_and(|b| std::fs::write(&tmp, b).is_ok());
        if !ok || std::fs::rename(&tmp, &path).is_err() {
            eprintln!("[notch] could not save the shelf");
        }
    }

    /// On top of its group: pinned first, then the rest, newest first in each.
    fn put(&mut self, path: PathBuf, size: Option<u64>, pinned: bool) -> bool {
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { return false };
        self.next += 1;
        let kind = if size.is_some() { kind_of(&path) } else { "other" };
        self.insert(ShelfItem { id: format!("shelf-{}", self.next), name, sub: size_text(size), kind, pinned }, path);
        true
    }

    fn insert(&mut self, item: ShelfItem, path: PathBuf) {
        let at = if item.pinned { 0 } else { self.items.iter().filter(|(i, _)| i.pinned).count() };
        self.items.insert(at, (item, path));
    }

    /// Dropped paths with their size (None = a folder). A path already on the shelf moves to the top and keeps its pin.
    /// True = changed. No cap: files stay until the owner removes them.
    pub fn add(&mut self, dropped: Vec<(PathBuf, Option<u64>)>) -> bool {
        let mut changed = false;
        for (path, size) in dropped {
            let pinned = self.items.iter().any(|(i, p)| p == &path && i.pinned);
            self.items.retain(|(_, p)| p != &path);
            changed |= self.put(path, size, pinned);
        }
        if changed {
            self.save();
        }
        changed
    }

    /// Pin (keep on top) or unpin; false = not an id Peeka handed out.
    pub fn pin(&mut self, id: &str, on: bool) -> bool {
        let Some(at) = self.items.iter().position(|(i, _)| i.id == id) else { return false };
        let (mut item, path) = self.items.remove(at);
        item.pinned = on;
        self.insert(item, path);
        self.save();
        true
    }

    /// Off the shelf; a Peeka copy (`copies_dir`) is deleted with it, the owner's own files never are.
    pub fn remove(&mut self, ids: &[String]) -> bool {
        let own = self.dir.as_deref().map(copies_dir);
        let before = self.items.len();
        self.items.retain(|(i, p)| {
            let gone = ids.contains(&i.id);
            if gone && own.as_ref().is_some_and(|d| p.starts_with(d)) {
                let _ = std::fs::remove_file(p);
            }
            !gone
        });
        let changed = self.items.len() != before;
        if changed {
            self.save();
        }
        changed
    }

    pub fn list(&self) -> Vec<ShelfItem> {
        self.items.iter().map(|(i, _)| i.clone()).collect()
    }

    /// Only ids Notch handed out.
    pub fn path(&self, id: &str) -> Option<&Path> {
        self.items.iter().find(|(i, _)| i.id == id).map(|(_, p)| p.as_path())
    }

    /// Every id's path, in the order given; None if any id is not ours (or none was given).
    pub fn paths(&self, ids: &[String]) -> Option<Vec<PathBuf>> {
        let v: Option<Vec<PathBuf>> = ids.iter().map(|id| self.path(id).map(Path::to_path_buf)).collect();
        v.filter(|v| !v.is_empty())
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
    fn drops_newest_first_deduped_uncapped_and_ids_are_ours() {
        let mut s = Shelf::default();
        assert!(s.add(vec![(r"C:\a\Rapor.PDF".into(), Some(2_400_000)), (r"C:\a\folder".into(), None)]));
        let l = s.list();
        assert_eq!((l[0].name.as_str(), l[0].sub.as_str(), l[0].kind), ("folder", "Folder", "other"));
        assert_eq!((l[1].sub.as_str(), l[1].kind), ("2.3 MB", "pdf"));
        s.add(vec![(r"C:\a\Rapor.PDF".into(), Some(1))]);
        assert_eq!(s.list().len(), 2, "same path once");
        assert_eq!(s.list()[0].name, "Rapor.PDF");
        assert_eq!(s.path(&s.list()[0].id), Some(Path::new(r"C:\a\Rapor.PDF")));
        assert_eq!(s.path("shelf-999"), None);
        assert_eq!(s.path(r"C:\a\Rapor.PDF"), None, "a path is not an id");
        s.add((0..30).map(|i| (PathBuf::from(format!("f{i}.mp4")), Some(5))).collect());
        assert_eq!(s.list().len(), 32, "nothing is dropped to make room");
        assert_eq!(s.list()[0].kind, "video");
        assert!(!s.add(vec![]));
        assert_eq!(size_text(Some(2048)), "2 KB");
        assert_eq!(size_text(Some(3 * 1_073_741_824 / 2)), "1.5 GB");
        let ids: Vec<String> = s.list().iter().take(2).map(|i| i.id.clone()).collect();
        assert_eq!(s.paths(&ids).map(|v| v.len()), Some(2));
        assert_eq!(s.paths(&[ids[0].clone(), "shelf-999".into()]), None, "one stranger refuses all");
        assert_eq!(s.paths(&[]), None);
    }

    #[test]
    fn the_shelf_survives_a_restart_pins_stay_on_top_and_gone_files_drop() {
        let tmp = crate::test_util::Tmp::new();
        let file = |name: &str| {
            let p = tmp.path().join(name);
            std::fs::write(&p, b"12345").unwrap();
            p
        };
        let (a, b, c) = (file("a.pdf"), file("b.png"), file("c.txt"));
        let own = copies_dir(tmp.path());
        std::fs::create_dir_all(&own).unwrap();
        let orphan = own.join("image-old.png");
        std::fs::write(&orphan, b"png").unwrap();
        let mut s = Shelf::load(tmp.path());
        assert!(!orphan.exists(), "a Peeka copy nothing points to is swept");
        let copy = own.join("image-1.png");
        std::fs::write(&copy, b"png").unwrap();
        s.add(vec![(a.clone(), Some(5)), (b.clone(), Some(5)), (c.clone(), Some(5)), (copy.clone(), Some(3))]);
        let id = |s: &Shelf, p: &Path| s.list().into_iter().find(|i| s.path(&i.id) == Some(p)).unwrap().id;
        assert!(s.pin(&id(&s, &a), true));
        assert_eq!(s.list()[0].name, "a.pdf", "pinned goes first");
        s.add(vec![(tmp.path().join("new.txt"), Some(1))]);
        assert_eq!(s.list()[0].name, "a.pdf", "a new drop goes under the pins");
        s.add(vec![(a.clone(), Some(5))]);
        assert!(s.list()[0].pinned, "re-dropping keeps the pin");

        std::fs::remove_file(&c).unwrap();
        let back = Shelf::load(tmp.path());
        let names: Vec<String> = back.list().into_iter().map(|i| i.name).collect();
        assert_eq!(names, ["a.pdf", "image-1.png", "b.png"], "same order, gone files dropped (c.txt, new.txt)");
        assert!(back.list()[0].pinned && !back.list()[1].pinned);
        assert_eq!(back.list()[2].sub, "5 B");

        let mut back = back;
        assert!(back.remove(&[id(&back, &copy), id(&back, &b)]));
        assert!(!copy.exists(), "a Peeka copy is deleted with its entry");
        assert!(b.exists(), "the owner's own file never is");
        assert!(!back.remove(&["shelf-999".into()]));
        assert_eq!(Shelf::load(tmp.path()).list().len(), 1);

        std::fs::write(tmp.path().join("shelf.json"), b"not json").unwrap();
        std::fs::write(own.join("image-2.png"), b"png").unwrap();
        let broken = Shelf::load(tmp.path());
        assert!(broken.list().is_empty());
        assert!(own.join("image-2.png").exists(), "a broken list never costs a copy");
        assert_eq!(std::fs::read(tmp.path().join("shelf.json")).unwrap(), b"not json", "and is not overwritten");
    }

    #[test]
    fn a_zip_is_named_after_its_file_or_the_shelf_and_never_overwrites() {
        let tmp = crate::test_util::Tmp::new();
        let one = [PathBuf::from(r"C:\x\Rapor şğü.pdf")];
        assert_eq!(zip_target(tmp.path(), &one), tmp.path().join("Rapor şğü.zip"));
        let two = [PathBuf::from(r"C:\x\a.pdf"), PathBuf::from(r"C:\x\folder")];
        let first = zip_target(tmp.path(), &two);
        assert_eq!(first, tmp.path().join("Shelf files.zip"));
        std::fs::write(&first, b"PK").unwrap();
        assert_eq!(zip_target(tmp.path(), &two), tmp.path().join("Shelf files (2).zip"));
    }

    #[test]
    fn a_shelf_file_goes_as_a_one_shot_copy_and_never_a_password() {
        use crate::plugins::share;
        use std::time::SystemTime;
        let tmp = crate::test_util::Tmp::new();
        let src = tmp.path().join("source");
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
        let key = put("notes.txt", concat!("key: sk-ant-api03-abcdefghijklmnop", "qrstuvwxyz012345").as_bytes()); // allow-secret
        assert_eq!(share_copy(tmp.path(), &key), Err(CopyErr::Password), "a secret inside a text file");
        assert_eq!(share_copy(tmp.path(), &src), Err(CopyErr::NotFile), "a folder");
        assert_eq!(share_copy(tmp.path(), &src.join("missing.pdf")), Err(CopyErr::Io));
        let big = std::fs::File::create(src.join("big.bin")).unwrap();
        big.set_len(crate::fidelity::ATTACH_MAX_BYTES + 1).unwrap();
        assert_eq!(share_copy(tmp.path(), &src.join("big.bin")), Err(CopyErr::TooBig));
        assert_eq!(
            std::fs::read_dir(share::dir(tmp.path())).map(|d| d.count()).unwrap_or(0),
            0,
            "nothing refused was copied"
        );
    }
}
