// Peeka — original implementation (MIT).
//! "Download finished" (scenario 29): the Downloads folder is listed every couple of seconds (names and sizes only, no file
//! is ever opened or read) and a NEW file is announced once its size has stopped changing. A privacy surface: the
//! owner can switch it off (`watchDownloads`), the event carries a name and a size and nothing else (never a path),
//! it never goes to a plugin, and the folder path stays in Rust. Platform-free: the Windows side only lists.

use std::collections::HashMap;

use serde::Serialize;

/// Browsers write `name.crdownload` / `.part` / ... and rename it when done; those are never announced.
const PARTIAL: &[&str] = &["crdownload", "part", "tmp", "download", "partial", "opdownload", "!ut", "aria2", "temp"];
/// How many announced downloads `download_open` / `download_show_in_folder` still know (the newest).
const KEEP: usize = 10;

/// A file name the poll ignores: a partial download, a hidden file, an Office lock file, `desktop.ini`.
pub fn skipped(name: &str) -> bool {
    let ext = name.rsplit_once('.').map_or("", |(_, e)| e).to_lowercase();
    PARTIAL.contains(&ext.as_str())
        || name.starts_with('.')
        || name.starts_with("~$")
        || name.eq_ignore_ascii_case("desktop.ini")
}

/// `download_done`: one finished download. `id` is how the page names it back to Notch; there is no path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Done {
    pub id: String,
    pub name: String,
    pub size: u64,
}

enum Seen {
    /// There at the start or already announced: never again while it exists.
    Quiet,
    /// New: the size at the last look (announced when the next look sees the same, non-zero size).
    Growing(u64),
}

#[derive(Default)]
pub struct Downloads {
    seen: HashMap<String, Seen>,
    baselined: bool,
    next: u64,
    announced: Vec<Done>,
}

impl Downloads {
    /// One look at the folder: `files` = (name, size) of every plain file in it. The first look only remembers what is
    /// there. Returns the downloads that finished since the last look, oldest name first.
    pub fn step(&mut self, files: &[(String, u64)]) -> Vec<Done> {
        let files: Vec<&(String, u64)> = files.iter().filter(|(n, _)| !skipped(n)).collect();
        let first = !std::mem::replace(&mut self.baselined, true);
        let now: std::collections::HashSet<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        self.seen.retain(|n, _| now.contains(n.as_str()));
        let mut done = vec![];
        let mut sorted = files;
        sorted.sort();
        for (name, size) in sorted {
            match self.seen.get(name) {
                _ if first => {
                    self.seen.insert(name.clone(), Seen::Quiet);
                }
                Some(Seen::Quiet) => {}
                Some(Seen::Growing(before)) if before == size && *size > 0 => {
                    self.seen.insert(name.clone(), Seen::Quiet);
                    self.next += 1;
                    done.push(Done { id: format!("dl-{}", self.next), name: name.clone(), size: *size });
                }
                _ => {
                    self.seen.insert(name.clone(), Seen::Growing(*size));
                }
            }
        }
        self.announced.extend(done.iter().cloned());
        let over = self.announced.len().saturating_sub(KEEP);
        self.announced.drain(..over);
        done
    }

    /// The setting went off (or Notch is locked): forget everything, so turning it on again does not announce what
    /// arrived meanwhile.
    pub fn reset(&mut self) {
        *self = Self { next: self.next, ..Self::default() };
    }

    /// The file name behind an id Notch announced (the commands act only on these).
    pub fn name(&self, id: &str) -> Option<&str> {
        self.announced.iter().find(|d| d.id == id).map(|d| d.name.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(list: &[(&str, u64)]) -> Vec<(String, u64)> {
        list.iter().map(|(n, s)| (n.to_string(), *s)).collect()
    }

    #[test]
    fn what_was_there_at_the_start_is_never_announced() {
        let mut d = Downloads::default();
        assert!(d.step(&f(&[("old.pdf", 10)])).is_empty());
        assert!(d.step(&f(&[("old.pdf", 10)])).is_empty());
        assert!(d.step(&f(&[("old.pdf", 10)])).is_empty());
    }

    #[test]
    fn a_new_file_is_announced_once_after_its_size_held_still() {
        let mut d = Downloads::default();
        d.step(&f(&[]));
        assert!(d.step(&f(&[("report.pdf", 500)])).is_empty(), "first sight");
        let done = d.step(&f(&[("report.pdf", 500)]));
        assert_eq!(done, [Done { id: "dl-1".into(), name: "report.pdf".into(), size: 500 }]);
        assert!(d.step(&f(&[("report.pdf", 500)])).is_empty(), "only once");
        assert_eq!(d.name("dl-1"), Some("report.pdf"));
        assert_eq!(d.name("dl-9"), None, "an id Notch never announced");
    }

    #[test]
    fn a_growing_file_waits_and_a_zero_byte_file_never_counts() {
        let mut d = Downloads::default();
        d.step(&f(&[]));
        assert!(d.step(&f(&[("movie.mkv", 100)])).is_empty());
        assert!(d.step(&f(&[("movie.mkv", 900)])).is_empty(), "still growing");
        let done = d.step(&f(&[("movie.mkv", 900), ("empty.txt", 0)]));
        assert_eq!(done.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["movie.mkv"], "held still");
        assert!(d.step(&f(&[("movie.mkv", 900), ("empty.txt", 0)])).is_empty(), "an empty file is not a download");
    }

    #[test]
    fn partial_hidden_and_lock_files_are_ignored_and_the_rename_is_the_download() {
        let mut d = Downloads::default();
        d.step(&f(&[]));
        for _ in 0..3 {
            assert!(d
                .step(&f(&[("a.zip.crdownload", 5), ("b.part", 5), ("c.TMP", 5), (".hidden", 5), ("~$x.docx", 5)]))
                .is_empty());
        }
        // Chrome renames the .crdownload to its final name.
        assert!(d.step(&f(&[("a.zip", 5000)])).is_empty());
        assert_eq!(d.step(&f(&[("a.zip", 5000)]))[0].name, "a.zip");
    }

    #[test]
    fn a_deleted_and_re_downloaded_name_counts_again_and_reset_forgets_the_pile() {
        let mut d = Downloads::default();
        d.step(&f(&[]));
        d.step(&f(&[("x.pdf", 1)]));
        assert_eq!(d.step(&f(&[("x.pdf", 1)])).len(), 1);
        d.step(&f(&[]));
        d.step(&f(&[("x.pdf", 2)]));
        assert_eq!(d.step(&f(&[("x.pdf", 2)])).len(), 1, "same name again after it was gone");
        d.reset();
        assert!(d.step(&f(&[("y.pdf", 1), ("x.pdf", 2)])).is_empty(), "the first look after a reset is a baseline");
        assert!(d.step(&f(&[("y.pdf", 1), ("x.pdf", 2)])).is_empty());
    }

    #[test]
    fn the_newest_ten_stay_addressable_and_the_payload_has_no_path() {
        let mut d = Downloads::default();
        d.step(&f(&[]));
        for i in 0..12 {
            let name = format!("f{i}.bin");
            d.step(&f(&[(name.as_str(), 7)]));
            d.step(&f(&[(name.as_str(), 7)]));
        }
        assert_eq!(d.name("dl-1"), None, "the oldest left");
        assert_eq!(d.name("dl-12"), Some("f11.bin"));
        let json = serde_json::to_value(Done { id: "dl-1".into(), name: "a.pdf".into(), size: 3 }).unwrap();
        assert_eq!(json, serde_json::json!({"id": "dl-1", "name": "a.pdf", "size": 3}));
    }

    #[test]
    fn a_listing_of_a_real_temp_folder_feeds_the_tracker() {
        let tmp = crate::test_util::Tmp::new();
        let list = |tmp: &crate::test_util::Tmp| {
            let mut v = vec![];
            for e in std::fs::read_dir(tmp.path()).unwrap().flatten() {
                let m = e.metadata().unwrap();
                if m.is_file() {
                    v.push((e.file_name().into_string().unwrap(), m.len()));
                }
            }
            v
        };
        tmp.write("exists.txt", b"x");
        let mut d = Downloads::default();
        d.step(&list(&tmp));
        tmp.write("new.zip", b"12345");
        tmp.write("yeni2.zip.crdownload", b"123");
        assert!(d.step(&list(&tmp)).is_empty());
        let done = d.step(&list(&tmp));
        assert_eq!(done.len(), 1);
        assert_eq!((done[0].name.as_str(), done[0].size), ("new.zip", 5));
    }
}
