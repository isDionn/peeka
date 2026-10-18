//! The pano (clipboard history): text, images and file paths, 50 items / 24 h, pins; the
//! password class encrypted in its own file ([`vault`]). Pure: the Windows listener hands in a [`Copied`], the cipher
//! is a port, time is a `now_ms` argument. Rules kept here so the tests can hold them:
//! - a password item's text never leaves: not in [`Pano::list`], not in a [`Change`], not in [`Pano::plugin_items`]
//!   (`clipboard.read`), not in `gecmis.json`, not in a share, a drag or a pin; only [`Pano::reveal`] and the
//!   copy-back payload hold it, as a [`Secret`] that zeroes itself, and both are refused while Notch is locked;
//! - while locked no new password item is written;
//! - a flagged (or sensitive-app) image or file copy is never stored; Notch's own write-back is never read back.
//!
//! Inspired by HeyyCzer/windows-dynamic-island (ideas only; no code copied).

pub mod secret;
pub mod vault;

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::plugins::host::{AttachKind, Attachment, ClipItem};
use crate::plugins::share;
use secret::Origin;
use vault::{Meta, Protect, Secret, Vault};

pub const MAX_ITEMS: usize = 50;
pub const MAX_AGE_MS: u64 = 24 * 3600 * 1000;
/// Settings › Pano: the password lifetime, minutes (60 at most and by default).
pub const PASSWORD_MINUTES: [u32; 4] = [5, 15, 30, 60];
/// How long the eye button shows the value (the page applies at most this).
pub const REVEAL_MS: u64 = 5000;
/// Texts above this size are dropped rather than stored (think of a pasted log or a database export).
const MAX_TEXT: usize = 1_000_000;
/// The list carries at most this much of a text.
const VIEW_TEXT: usize = 4000;
/// Inline in a one-shot share; longer goes to the share folder as a file.
const SHARE_INLINE: usize = 256 * 1024;
const CUT_NOTE: &str = "\n\n[Metin 256 KB'de kesildi; tamamı ekli dosyada.]";

/// The first `SHARE_INLINE` bytes of a long text (on a char boundary, room left for the note) plus the note.
fn head(text: &str) -> String {
    let mut end = SHARE_INLINE - CUT_NOTE.len();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{CUT_NOTE}", &text[..end])
}

/// Exe stems (lower-case) of screen-capture programs: an image copied from one of them counts as a screenshot.
/// Two groups, the ones Windows ships and the third-party ones.
const SCREENSHOT_TOOLS: &[&str] = &[
    // built into Windows
    "screenclippinghost",
    "snippingtool",
    "screensketch",
    // third party
    "greenshot",
    "flameshot",
    "lightshot",
    "sharex",
    "gyazo",
    "picpick",
    "snagiteditor",
    "snagit32",
];

/// An image as the Windows side prepared it: the full PNG, a small PNG thumbnail and a fingerprint for duplicates.
pub struct ImageData {
    pub png: Vec<u8>,
    pub thumb_png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub fp: u64,
}

pub enum Clip {
    Text(String),
    Image(ImageData),
    Files(Vec<String>),
}

pub struct Copied {
    pub clip: Clip,
    pub origin: Origin,
    /// Put there by Notch itself (copy-back): ignored.
    pub own: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Kind {
    Text {
        text: String,
    },
    Image {
        file: String,
        thumb: String,
        width: u32,
        height: u32,
        fp: u64,
    },
    Files {
        paths: Vec<String>,
    },
    /// The value is in the vault only.
    Password {
        expires_ms: u64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub kind: Kind,
    pub source: Option<String>,
    pub created_ms: u64,
    pub pinned: bool,
    pub screenshot: bool,
}

impl Entry {
    fn is_password(&self) -> bool {
        matches!(self.kind, Kind::Password { .. })
    }
}

/// Settings › Pano.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
    pub history: bool,
    /// Images and files too (text always, while `history`).
    pub media: bool,
    pub password_minutes: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self { history: true, media: true, password_minutes: 60 }
    }
}

impl Config {
    fn ttl_ms(&self) -> u64 {
        u64::from(self.password_minutes.clamp(1, 60)) * 60_000
    }
}

/// `wave4-api.ts` `ClipPlain`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainView {
    pub id: String,
    pub created_at: u64,
    pub pinned: bool,
    pub source: Option<String>,
    pub kind: &'static str,
    pub text: Option<String>,
    pub hint: Option<&'static str>,
    pub sub: Option<String>,
    pub thumb: Option<String>,
    pub screenshot: bool,
    pub missing: bool,
}

/// `wave4-api.ts` `ClipPassword`: no text, no length.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordView {
    pub id: String,
    pub created_at: u64,
    pub pinned: bool,
    pub source: Option<String>,
    pub kind: &'static str,
    pub expires_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum ItemView {
    Plain(PlainView),
    Password(PasswordView),
}

/// `wave4-api.ts` `ClipChange` (the `clip_changed` event).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Change {
    pub reason: &'static str,
    pub item: Option<ItemView>,
}

impl Change {
    /// The same change with a password row taken out (Notch locked, presentation mode).
    pub fn hiding_passwords(mut self, hide: bool) -> Self {
        if hide && matches!(self.item, Some(ItemView::Password(_))) {
            self.item = None;
        }
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipErr {
    Unknown,
    /// Notch is locked.
    Locked,
    /// Not for a password item (pin, share, drag, edit).
    Password,
    /// Not for this kind (edit a text, drag a text).
    Kind,
    Io,
    /// The file is gone (a copied file moved or deleted since).
    Missing,
    /// A file Windows would run (`shelf::runnable`): "Aç" refuses it.
    Risky,
}

/// What copy-back puts on the clipboard.
pub enum Payload {
    Text(Secret),
    Image(PathBuf),
    Files(Vec<String>),
}

pub struct Pano {
    dir: PathBuf,
    entries: Vec<Entry>,
    vault: Vault,
    cfg: Config,
    /// False in demo mode (`Pano::demo`): text history in memory only; images and passwords (which need a file) are
    /// not taken, pins and the vault are never written.
    persist: bool,
}

fn new_id() -> String {
    let mut r = [0u8; 16];
    let _ = getrandom::fill(&mut r);
    r.iter().map(|b| format!("{b:02x}")).collect()
}

fn stem(exe: &str) -> String {
    let name = exe.rsplit(['\\', '/']).next().unwrap_or(exe);
    name.rsplit_once('.').map_or(name, |(s, _)| s).to_string()
}

fn hint(text: &str) -> Option<&'static str> {
    let t = text.trim();
    let one_word = !t.is_empty() && !t.contains(char::is_whitespace);
    if one_word && (t.starts_with("https://") || t.starts_with("http://")) {
        return Some("link");
    }
    let hex = t.strip_prefix('#').filter(|h| matches!(h.len(), 3 | 6 | 8));
    hex.filter(|h| h.chars().all(|c| c.is_ascii_hexdigit())).map(|_| "color")
}

pub fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

impl Pano {
    fn history_path(dir: &Path) -> PathBuf {
        dir.join("pano").join("gecmis.json")
    }

    pub fn img_dir(dir: &Path) -> PathBuf {
        dir.join("pano").join("img")
    }

    /// Pinned items from `gecmis.json`, the vault's live items, and the image folder emptied of everything else
    /// (unpinned history lives in memory only and starts empty).
    pub fn load(dir: PathBuf, cfg: Config, now_ms: u64) -> Self {
        let mut entries: Vec<Entry> = std::fs::read(Self::history_path(&dir))
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<Entry>>(&b).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|e| e.pinned && !e.is_password())
            .collect();
        let vault = Vault::load(vault::path(&dir), now_ms);
        for m in vault.list() {
            entries.push(Entry {
                id: m.id.clone(),
                kind: Kind::Password { expires_ms: m.expires_ms },
                source: m.source.clone(),
                created_ms: m.created_ms,
                pinned: false,
                screenshot: false,
            });
        }
        entries.sort_by_key(|e| std::cmp::Reverse(e.created_ms));
        let keep: Vec<String> = entries
            .iter()
            .filter_map(|e| match &e.kind {
                Kind::Image { file, .. } => Some(file.clone()),
                _ => None,
            })
            .collect();
        if let Ok(rd) = std::fs::read_dir(Self::img_dir(&dir)) {
            for f in rd.flatten() {
                if !keep.iter().any(|k| f.file_name().to_str() == Some(k)) {
                    let _ = std::fs::remove_file(f.path());
                }
            }
        }
        let mut p = Self { dir, entries, vault, cfg, persist: true };
        if !cfg.history {
            p.clear(false);
        }
        p
    }

    /// Demo mode: starts empty, reads nothing, writes nothing (`dir` is only where the real one would write).
    pub fn demo(dir: PathBuf, cfg: Config) -> Self {
        let vault = Vault::empty(vault::path(&dir));
        Self { dir, entries: vec![], vault, cfg, persist: false }
    }

    pub fn config(&self) -> Config {
        self.cfg
    }

    fn save_pins(&self) {
        if !self.persist {
            return;
        }
        let pins: Vec<&Entry> = self.entries.iter().filter(|e| e.pinned && !e.is_password()).collect();
        let path = Self::history_path(&self.dir);
        let _ = path.parent().map(std::fs::create_dir_all);
        if let Ok(b) = serde_json::to_vec(&pins) {
            let _ = std::fs::write(path, b);
        }
    }

    fn view(&self, e: &Entry) -> ItemView {
        let plain = |kind, text, hint, sub, thumb, missing| {
            ItemView::Plain(PlainView {
                id: e.id.clone(),
                created_at: e.created_ms,
                pinned: e.pinned,
                source: e.source.clone(),
                kind,
                text,
                hint,
                sub,
                thumb,
                screenshot: e.screenshot,
                missing,
            })
        };
        match &e.kind {
            Kind::Text { text } => {
                let n = text.chars().count();
                let shown: String = text.chars().take(VIEW_TEXT).collect();
                plain("text", Some(shown), hint(text), Some(format!("{n} karakter")), None, false)
            }
            Kind::Image { thumb, width, height, .. } => {
                plain("image", None, None, Some(format!("{width}×{height}")), Some(thumb.clone()), false)
            }
            Kind::Files { paths } => {
                let first = paths.first().map(|p| p.rsplit(['\\', '/']).next().unwrap_or(p).to_string());
                let sub = if paths.len() > 1 {
                    format!("+{} dosya", paths.len() - 1)
                } else {
                    paths.first().and_then(|p| p.rsplit_once(['\\', '/'])).map_or(String::new(), |(d, _)| d.into())
                };
                let missing = paths.iter().all(|p| !Path::new(p).exists());
                plain("file", first, None, Some(sub), None, missing)
            }
            Kind::Password { expires_ms } => ItemView::Password(PasswordView {
                id: e.id.clone(),
                created_at: e.created_ms,
                pinned: false,
                source: e.source.clone(),
                kind: "password",
                expires_at: *expires_ms,
            }),
        }
    }

    /// `clip_list`, newest first. `hide_passwords`: Notch locked, or Windows in presentation / busy mode.
    pub fn list(&self, hide_passwords: bool) -> Vec<ItemView> {
        self.entries.iter().filter(|e| !(hide_passwords && e.is_password())).map(|e| self.view(e)).collect()
    }

    fn find(&self, id: &str) -> Result<&Entry, ClipErr> {
        self.entries.iter().find(|e| e.id == id).ok_or(ClipErr::Unknown)
    }

    fn drop_files(&self, e: &Entry) {
        if !self.persist {
            return;
        }
        if let Kind::Image { file, .. } = &e.kind {
            let _ = std::fs::remove_file(Self::img_dir(&self.dir).join(file));
        }
    }

    /// Removes entries by predicate (files and vault slots too); returns their views.
    fn remove_where(&mut self, f: impl Fn(&Entry) -> bool) -> Vec<ItemView> {
        let (gone, kept): (Vec<Entry>, Vec<Entry>) = std::mem::take(&mut self.entries).into_iter().partition(f);
        self.entries = kept;
        let mut views = vec![];
        for e in &gone {
            if e.is_password() {
                self.vault.remove(&e.id);
            }
            self.drop_files(e);
            views.push(self.view(e));
        }
        if gone.iter().any(|e| e.pinned) {
            self.save_pins();
        }
        views
    }

    /// 24 h for unpinned items, 50 plain items at most (pins count, never go), passwords at their expiry.
    fn prune(&mut self, now_ms: u64) -> Vec<Change> {
        let mut out: Vec<Change> = self
            .remove_where(|e| matches!(e.kind, Kind::Password { expires_ms } if expires_ms <= now_ms))
            .into_iter()
            .map(|v| Change { reason: "expired", item: Some(v) })
            .collect();
        for id in self.vault.expire(now_ms) {
            out.extend(
                self.remove_where(|e| e.id == id).into_iter().map(|v| Change { reason: "expired", item: Some(v) }),
            );
        }
        let old =
            self.remove_where(|e| !e.pinned && !e.is_password() && now_ms.saturating_sub(e.created_ms) > MAX_AGE_MS);
        out.extend(old.into_iter().map(|v| Change { reason: "expired", item: Some(v) }));
        let pins = self.entries.iter().filter(|e| e.pinned).count();
        let over: Vec<String> = self
            .entries
            .iter()
            .filter(|e| !e.is_password() && !e.pinned)
            .skip(MAX_ITEMS.saturating_sub(pins).max(1))
            .map(|e| e.id.clone())
            .collect();
        let trimmed = self.remove_where(|e| over.contains(&e.id));
        out.extend(trimmed.into_iter().map(|v| Change { reason: "removed", item: Some(v) }));
        out
    }

    /// The 1 s tick.
    pub fn tick(&mut self, now_ms: u64) -> Vec<Change> {
        self.prune(now_ms)
    }

    fn same(a: &Kind, b: &Clip) -> bool {
        match (a, b) {
            (Kind::Text { text }, Clip::Text(t)) => text == t,
            (Kind::Files { paths }, Clip::Files(p)) => paths == p,
            (Kind::Image { fp, .. }, Clip::Image(i)) => *fp == i.fp,
            _ => false,
        }
    }

    /// A copy the listener saw. None = nothing kept (history off, own write, empty, flagged media, locked password,
    /// too big, the vault refused).
    pub fn capture(&mut self, c: Copied, locked: bool, now_ms: u64, p: &dyn Protect) -> Vec<Change> {
        if !self.cfg.history || c.own {
            return vec![];
        }
        let owner = c.origin.owner_exe.as_deref();
        let source = owner.map(|o| secret::manager_name(o).map_or_else(|| stem(o), str::to_string));
        let mut out = vec![];
        let entry = match c.clip {
            Clip::Text(text) if text.trim().is_empty() || text.len() > MAX_TEXT => return vec![],
            Clip::Text(text) if secret::password_class(&text, &c.origin) => {
                let plain = Secret::new(text.into_bytes()); // moved, zeroed on drop
                if locked || !self.persist {
                    return vec![];
                }
                let id = new_id();
                let expires_ms = now_ms + self.cfg.ttl_ms();
                let meta = Meta { id: id.clone(), created_ms: now_ms, expires_ms, source: source.clone() };
                match self.vault.put(meta, &plain, p) {
                    Ok(Some(evicted)) => out.extend(
                        self.remove_where(|e| e.id == evicted)
                            .into_iter()
                            .map(|v| Change { reason: "removed", item: Some(v) }),
                    ),
                    Ok(None) => {}
                    Err(_) => return vec![],
                }
                Entry {
                    id,
                    kind: Kind::Password { expires_ms },
                    source,
                    created_ms: now_ms,
                    pinned: false,
                    screenshot: false,
                }
            }
            clip => {
                if matches!(clip, Clip::Image(_)) && !self.persist {
                    return vec![];
                }
                if matches!(clip, Clip::Image(_) | Clip::Files(_)) && (c.origin.sensitive() || !self.cfg.media) {
                    return vec![];
                }
                if let Some(i) = self.entries.iter().position(|e| Self::same(&e.kind, &clip)) {
                    let mut e = self.entries.remove(i);
                    e.created_ms = now_ms;
                    e.source = source.or(e.source);
                    self.entries.insert(0, e);
                    return vec![Change { reason: "updated", item: Some(self.view(&self.entries[0])) }];
                }
                let id = new_id();
                let screenshot = matches!(clip, Clip::Image(_))
                    && owner.is_none_or(|o| SCREENSHOT_TOOLS.contains(&stem(o).to_lowercase().as_str()));
                let kind = match clip {
                    Clip::Text(text) => Kind::Text { text },
                    Clip::Files(paths) => Kind::Files { paths },
                    Clip::Image(img) => {
                        let file = format!("{id}.png");
                        let dir = Self::img_dir(&self.dir);
                        if std::fs::create_dir_all(&dir)
                            .and_then(|_| std::fs::write(dir.join(&file), &img.png))
                            .is_err()
                        {
                            return vec![];
                        }
                        let thumb = data_url(&img.thumb_png);
                        Kind::Image { file, thumb, width: img.width, height: img.height, fp: img.fp }
                    }
                };
                Entry { id, kind, source, created_ms: now_ms, pinned: false, screenshot }
            }
        };
        self.entries.insert(0, entry);
        out.insert(0, Change { reason: "added", item: Some(self.view(&self.entries[0])) });
        out.extend(self.prune(now_ms));
        out
    }

    pub fn pin(&mut self, id: &str, on: bool) -> Result<Change, ClipErr> {
        let i = self.entries.iter().position(|e| e.id == id).ok_or(ClipErr::Unknown)?;
        if self.entries[i].is_password() {
            return Err(ClipErr::Password);
        }
        self.entries[i].pinned = on;
        self.save_pins();
        Ok(Change { reason: "updated", item: Some(self.view(&self.entries[i])) })
    }

    pub fn delete(&mut self, id: &str) -> Result<Change, ClipErr> {
        let mut gone = self.remove_where(|e| e.id == id);
        gone.pop().map(|v| Change { reason: "removed", item: Some(v) }).ok_or(ClipErr::Unknown)
    }

    /// "Hepsini sil" (the vault file goes too) or "Parolaları hepsini sil".
    pub fn clear(&mut self, passwords_only: bool) -> Change {
        self.remove_where(|e| !passwords_only || e.is_password());
        if self.persist {
            let _ = self.vault.destroy();
        }
        if !passwords_only {
            self.save_pins();
        }
        Change { reason: "cleared", item: None }
    }

    /// Settings › Pano changed: history off clears everything (vault included); a shorter password lifetime applies
    /// to what is stored.
    pub fn set_config(&mut self, cfg: Config, now_ms: u64) -> Vec<Change> {
        let old = std::mem::replace(&mut self.cfg, cfg);
        if !cfg.history && old.history {
            return vec![self.clear(false)];
        }
        if cfg.ttl_ms() < old.ttl_ms() {
            self.vault.clamp(cfg.ttl_ms());
            let ttl = cfg.ttl_ms();
            for e in &mut self.entries {
                if let Kind::Password { expires_ms } = &mut e.kind {
                    *expires_ms = (*expires_ms).min(e.created_ms + ttl);
                }
            }
            return self.prune(now_ms);
        }
        vec![]
    }

    /// The eye button: the value, refused while locked.
    pub fn reveal(&self, id: &str, locked: bool, p: &dyn Protect) -> Result<Secret, ClipErr> {
        let e = self.find(id)?;
        if !e.is_password() {
            return Err(ClipErr::Kind);
        }
        if locked {
            return Err(ClipErr::Locked);
        }
        self.vault.reveal(id, p).ok_or(ClipErr::Io)
    }

    /// Copy-back. A password works without revealing, but never while locked.
    pub fn payload(&self, id: &str, locked: bool, p: &dyn Protect) -> Result<Payload, ClipErr> {
        let e = self.find(id)?;
        Ok(match &e.kind {
            Kind::Password { .. } if locked => return Err(ClipErr::Locked),
            Kind::Password { .. } => Payload::Text(self.vault.reveal(id, p).ok_or(ClipErr::Io)?),
            Kind::Text { text } => Payload::Text(Secret::new(text.clone().into_bytes())),
            Kind::Image { file, .. } => Payload::Image(Self::img_dir(&self.dir).join(file)),
            Kind::Files { paths } => Payload::Files(paths.clone()),
        })
    }

    /// Copied back: the item moves to the top (the listener ignores Notch's own write).
    pub fn bump(&mut self, id: &str, now_ms: u64) -> Option<Change> {
        let i = self.entries.iter().position(|e| e.id == id)?;
        let mut e = self.entries.remove(i);
        e.created_ms = now_ms;
        self.entries.insert(0, e);
        Some(Change { reason: "updated", item: Some(self.view(&self.entries[0])) })
    }

    /// "Asistana sor": the item as one-shot attachments for the main assistant. Long text and images
    /// go to the share folder (`paylasim\`, gone on `share.done` or after 10 minutes); files go as their paths.
    /// Long text ALSO goes inline, cut at 256 KB with a visible note, so an assistant that reads only `text` still
    /// gets it; any image goes as `screenshot` (the kind the assistant uploads as a picture).
    pub fn share(&self, id: &str) -> Result<Vec<Attachment>, ClipErr> {
        let e = self.find(id)?;
        let to_file = matches!(&e.kind, Kind::Image { .. })
            || matches!(&e.kind, Kind::Text { text } if text.len() > SHARE_INLINE);
        if to_file && !self.persist {
            return Err(ClipErr::Io); // demo: no share-folder copy
        }
        let att =
            |kind, path: PathBuf| Attachment { kind, path: Some(path.to_string_lossy().into_owned()), text: None };
        Ok(match &e.kind {
            Kind::Password { .. } => return Err(ClipErr::Password),
            Kind::Text { text } if text.len() <= SHARE_INLINE => {
                vec![Attachment { kind: AttachKind::Clip, path: None, text: Some(text.clone()) }]
            }
            Kind::Text { text } => {
                let (_, path) = share::put(&self.dir, text.as_bytes(), "txt").map_err(|_| ClipErr::Io)?;
                vec![Attachment { text: Some(head(text)), ..att(AttachKind::Clip, path) }]
            }
            Kind::Image { file, .. } => {
                let png = std::fs::read(Self::img_dir(&self.dir).join(file)).map_err(|_| ClipErr::Io)?;
                let (_, path) = share::put(&self.dir, &png, "png").map_err(|_| ClipErr::Io)?;
                vec![att(AttachKind::Screenshot, path)]
            }
            Kind::Files { paths } => paths.iter().map(|p| att(AttachKind::File, PathBuf::from(p))).collect(),
        })
    }

    /// `share_open` (the Windows share sheet): text as text, an image as its PNG file, files as their paths; never a
    /// password, never an id Notch did not list.
    pub fn share_sheet(&self, id: &str) -> Result<crate::shelf::ShareTarget, ClipErr> {
        use crate::shelf::ShareTarget;
        match &self.find(id)?.kind {
            Kind::Password { .. } => Err(ClipErr::Password),
            Kind::Text { text } => Ok(ShareTarget::Text(text.clone())),
            Kind::Image { file, .. } => Ok(ShareTarget::Files(vec![Self::img_dir(&self.dir).join(file)])),
            Kind::Files { paths } => Ok(ShareTarget::Files(paths.iter().map(PathBuf::from).collect())),
        }
    }

    /// Drag out: an image drags its PNG file, a file item its paths; text and passwords do not drag.
    pub fn drag_paths(&self, id: &str) -> Result<Vec<PathBuf>, ClipErr> {
        let e = self.find(id)?;
        match &e.kind {
            Kind::Password { .. } => Err(ClipErr::Password),
            Kind::Text { .. } => Err(ClipErr::Kind),
            Kind::Image { file, .. } => Ok(vec![Self::img_dir(&self.dir).join(file)]),
            Kind::Files { paths } => Ok(paths.iter().map(PathBuf::from).collect()),
        }
    }

    /// `clip_edit`: the image file for Windows's editor.
    pub fn image_path(&self, id: &str) -> Result<PathBuf, ClipErr> {
        match &self.find(id)?.kind {
            Kind::Image { file, .. } => Ok(Self::img_dir(&self.dir).join(file)),
            Kind::Password { .. } => Err(ClipErr::Password),
            _ => Err(ClipErr::Kind),
        }
    }

    /// `clip_open`: the file for Windows's default app. An image is copied to `tmp` first (the pano's own PNG is
    /// deleted when the item expires, and a viewer would hold it open); a file item gives its first path that still
    /// exists. Never a password, never text, never while locked, never a file Windows would run.
    pub fn open_path(&self, id: &str, locked: bool, tmp: &Path) -> Result<PathBuf, ClipErr> {
        let e = self.find(id)?;
        match &e.kind {
            Kind::Password { .. } => return Err(ClipErr::Password),
            _ if locked => return Err(ClipErr::Locked),
            Kind::Text { .. } => return Err(ClipErr::Kind),
            Kind::Image { file, .. } => return self.copy_image(file, tmp, &format!("{id}.png")),
            Kind::Files { paths } => {
                let first = paths.iter().map(PathBuf::from).find(|p| p.exists()).ok_or(ClipErr::Missing)?;
                if crate::shelf::runnable(&first) {
                    return Err(ClipErr::Risky);
                }
                Ok(first)
            }
        }
    }

    /// `clip_to_shelf`: what goes on the shelf, as `Shelf::add` takes it (size `None` = a folder). An image is
    /// copied into `tmp` under a readable name; a file item gives every path that still exists. Never a password
    /// or text, never while locked.
    pub fn shelf_sources(&self, id: &str, locked: bool, tmp: &Path) -> Result<Vec<(PathBuf, Option<u64>)>, ClipErr> {
        let e = self.find(id)?;
        let sized = |p: PathBuf| std::fs::metadata(&p).ok().map(|m| (p, (!m.is_dir()).then_some(m.len())));
        match &e.kind {
            Kind::Password { .. } => Err(ClipErr::Password),
            _ if locked => Err(ClipErr::Locked),
            Kind::Text { .. } => Err(ClipErr::Kind),
            Kind::Image { file, .. } => {
                let copy = self.copy_image(file, tmp, &format!("goruntu-{}.png", &id[..id.len().min(8)]))?;
                Ok(sized(copy).into_iter().collect())
            }
            Kind::Files { paths } => {
                let found: Vec<_> = paths.iter().map(PathBuf::from).filter_map(sized).collect();
                if found.is_empty() {
                    Err(ClipErr::Missing)
                } else {
                    Ok(found)
                }
            }
        }
    }

    fn copy_image(&self, file: &str, tmp: &Path, name: &str) -> Result<PathBuf, ClipErr> {
        std::fs::create_dir_all(tmp).map_err(|_| ClipErr::Io)?;
        let to = tmp.join(name);
        std::fs::copy(Self::img_dir(&self.dir).join(file), &to).map_err(|_| ClipErr::Io)?;
        Ok(to)
    }

    /// `clipboard.read`: text and file paths; an image only as its kind (no path into Notch's data
    /// folder). Password items are never here.
    pub fn plugin_items(&self) -> Vec<ClipItem> {
        let mut out = vec![];
        for e in &self.entries {
            match &e.kind {
                Kind::Password { .. } => {}
                Kind::Text { text } => {
                    out.push(ClipItem { kind: "text".into(), text: Some(text.clone()), path: None, password: false })
                }
                Kind::Image { .. } => {
                    out.push(ClipItem { kind: "image".into(), text: None, path: None, password: false })
                }
                Kind::Files { paths } => out.extend(paths.iter().map(|p| ClipItem {
                    kind: "file".into(),
                    text: None,
                    path: Some(p.clone()),
                    password: false,
                })),
            }
        }
        out
    }
}

#[cfg(test)]
mod tests;
