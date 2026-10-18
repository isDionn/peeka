//! The security tests over the whole clipboard flow (fake cipher, fake clock = the `now_ms` argument).

use super::secret::{Flags, Origin};
use super::vault::fake::Xor;
use super::*;
use crate::test_util::Tmp;

const PW: &str = "correct-horse-battery-staple-42";

fn text(t: &str, origin: Origin) -> Copied {
    Copied { clip: Clip::Text(t.into()), origin, own: false }
}

fn bitwarden() -> Origin {
    Origin { owner_exe: Some(r"C:\Program Files\Bitwarden\Bitwarden.exe".into()), ..Default::default() }
}

fn flagged() -> Origin {
    Origin { flags: Flags { exclude: true, ..Default::default() }, ..Default::default() }
}

fn image(fp: u64) -> Copied {
    Copied {
        clip: Clip::Image(ImageData { png: b"PNG".to_vec(), thumb_png: b"T".to_vec(), width: 2, height: 2, fp }),
        origin: Origin {
            owner_exe: Some(r"C:\Windows\SystemApps\ScreenClippingHost.exe".into()),
            ..Default::default()
        },
        own: false,
    }
}

fn clip_history(tmp: &Tmp) -> ClipHistory {
    ClipHistory::load(tmp.path().to_path_buf(), Config::default(), 0)
}

fn has(hay: &[u8], needle: &str) -> bool {
    hay.windows(needle.len()).any(|w| w == needle.as_bytes())
}

/// Every file under the data folder, as bytes.
fn all_files(dir: &Path) -> Vec<u8> {
    let mut out = vec![];
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
            if e.path().is_dir() {
                stack.push(e.path());
            } else {
                out.extend(std::fs::read(e.path()).unwrap_or_default());
            }
        }
    }
    out
}

fn first_id(p: &ClipHistory) -> String {
    match &p.list(false)[0] {
        ItemView::Plain(v) => v.id.clone(),
        ItemView::Password(v) => v.id.clone(),
    }
}

#[test]
fn flag_app_and_pattern_all_land_in_the_password_class() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(text("abc", flagged()), false, 1, &x);
    p.capture(text("abc2", bitwarden()), false, 2, &x);
    p.capture(text("token=hunter22hunter", Origin::default()), false, 3, &x);
    p.capture(text("cat photo", Origin::default()), false, 4, &x);
    let kinds: Vec<&str> = p
        .list(false)
        .iter()
        .map(|v| match v {
            ItemView::Plain(v) => v.kind,
            ItemView::Password(v) => v.kind,
        })
        .collect();
    assert_eq!(kinds, ["text", "password", "password", "password"]);
    let ItemView::Password(bw) = &p.list(false)[2] else { panic!() };
    assert_eq!(bw.source.as_deref(), Some("Bitwarden"));
    assert_eq!(bw.expires_at, 2 + 60 * 60_000, "default lifetime: 1 hour");
}

#[test]
fn a_password_never_leaves_through_list_events_plugins_disk_or_share() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    let changes = p.capture(text(PW, bitwarden()), false, 10, &x);
    let id = first_id(&p);

    assert!(!serde_json::to_string(&p.list(false)).unwrap().contains(PW), "clip_list");
    assert!(!serde_json::to_string(&changes).unwrap().contains(PW), "clip_changed");
    assert!(!format!("{:?}", p.entries).contains(PW), "Debug (what a log line would print)");
    assert!(p.plugin_items().is_empty(), "clipboard.read source");
    assert!(!has(&all_files(tmp.path()), PW), "nothing on disk in plaintext (vault, history.json)");
    assert_eq!(p.share(&id).err(), Some(ClipErr::Password));
    assert_eq!(p.share_sheet(&id).err(), Some(ClipErr::Password), "share_open");
    assert_eq!(p.share_sheet("nope").err(), Some(ClipErr::Unknown));
    assert_eq!(p.drag_paths(&id).err(), Some(ClipErr::Password));
    assert_eq!(p.pin(&id, true).err(), Some(ClipErr::Password));
    assert_eq!(p.image_path(&id).err(), Some(ClipErr::Password));

    // The plugin API: `clipboard.read` with this clipboard behind it returns nothing of the password.
    let mut h = crate::plugins::host::Host::new(tmp.path().to_path_buf());
    h.clipboard = p.plugin_items();
    let outs = crate::plugins::host::tests::read_clipboard(&mut h);
    assert!(!outs.contains(PW) && outs.contains("\"items\":[]"), "{outs}");

    // Only reveal holds it, and only while unlocked.
    assert_eq!(p.reveal(&id, true, &x).err(), Some(ClipErr::Locked));
    assert_eq!(p.reveal(&id, false, &x).unwrap().bytes(), PW.as_bytes());
    assert!(matches!(p.payload(&id, true, &x), Err(ClipErr::Locked)), "no copy-back while locked");
    assert!(matches!(p.payload(&id, false, &x), Ok(Payload::Text(_))));
}

#[test]
fn locked_hides_password_rows_and_writes_no_new_password() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(text(PW, bitwarden()), false, 1, &x);
    assert_eq!(p.list(true).len(), 0, "hidden while locked");
    assert!(p.capture(text("second-password-99", bitwarden()), true, 2, &x).is_empty());
    assert_eq!(p.list(false).len(), 1);
    let c = Change { reason: "added", item: Some(p.list(false)[0].clone()) };
    assert_eq!(c.hiding_passwords(true).item, None);
}

#[test]
fn expiry_deletes_from_the_file_and_zeroes_the_slot() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(text(PW, bitwarden()), false, 1000, &x);
    let id = first_id(&p);
    assert!(p.tick(1000 + 59 * 60_000).is_empty());
    let gone = p.tick(1000 + 60 * 60_000);
    assert_eq!(gone.len(), 1);
    assert_eq!(gone[0].reason, "expired");
    assert!(p.list(false).is_empty());
    let raw = std::fs::read(vault::path(tmp.path())).unwrap();
    assert!(raw[64..].iter().all(|&b| b == 0), "every slot is zeros");
    assert_eq!(p.reveal(&id, false, &x).err(), Some(ClipErr::Unknown));
}

#[test]
fn a_shorter_lifetime_applies_to_stored_passwords() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(text(PW, bitwarden()), false, 0, &x);
    let cfg = Config { password_minutes: 5, ..Config::default() };
    assert!(p.set_config(cfg, 60_000).is_empty());
    assert_eq!(p.tick(5 * 60_000).len(), 1, "gone at 5 min");
}

#[test]
fn own_writes_and_flagged_media_are_never_stored() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    // Copy-back carries the exclusion flags too: it must not turn into a password item.
    let own = Copied { clip: Clip::Text("hello".into()), origin: flagged(), own: true };
    assert!(p.capture(own, false, 1, &x).is_empty());
    let mut img = image(1);
    img.origin.flags.exclude = true;
    assert!(p.capture(img, false, 2, &x).is_empty(), "a flagged image is not kept at all");
    let files = Copied { clip: Clip::Files(vec![r"C:\a.txt".into()]), origin: bitwarden(), own: false };
    assert!(p.capture(files, false, 3, &x).is_empty());
    assert!(p.list(false).is_empty());
}

#[test]
fn screenshots_are_flagged_duplicates_move_up_and_fifty_items_at_most() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    let c = p.capture(image(7), false, 1, &x);
    let Some(ItemView::Plain(v)) = &c[0].item else { panic!() };
    assert!(v.screenshot && v.thumb.as_deref().unwrap().starts_with("data:image/png;base64,"));
    assert_eq!(p.capture(image(7), false, 2, &x)[0].reason, "updated");
    let pin = first_id(&p);
    p.pin(&pin, true).unwrap();
    for i in 0..60 {
        p.capture(text(&format!("text {i}"), Origin::default()), false, 10 + i, &x);
    }
    assert_eq!(p.list(false).len(), MAX_ITEMS);
    assert!(p.list(false).iter().any(|v| matches!(v, ItemView::Plain(v) if v.id == pin)), "the pin stays");
    p.tick(10 + MAX_AGE_MS + 100);
    assert_eq!(p.list(false).len(), 1, "24 h: only the pin is left");
    drop(p);
    let p = clip_history(&tmp);
    assert_eq!(first_id(&p), pin, "pins survive a restart, the image file with them");
}

#[test]
fn share_uses_the_one_shot_folder_with_its_ten_minutes() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(image(3), false, 1, &x);
    let att = p.share(&first_id(&p)).unwrap();
    assert_eq!(att[0].kind, AttachKind::Screenshot);
    let path = PathBuf::from(att[0].path.clone().unwrap());
    assert!(path.starts_with(share::dir(tmp.path())) && path.exists());
    assert_eq!(share::TTL, std::time::Duration::from_secs(600));
    share::sweep(tmp.path(), std::time::SystemTime::now() + share::TTL, share::TTL);
    assert!(!path.exists(), "gone after 10 minutes");

    let mut photo = image(9);
    photo.origin.owner_exe = Some(r"C:\Program Files\Mozilla Firefox\firefox.exe".into());
    p.capture(photo, false, 1, &x);
    assert_eq!(p.share(&first_id(&p)).unwrap()[0].kind, AttachKind::Screenshot, "a copied picture goes as one too");

    let long = "x".repeat(SHARE_INLINE + 1);
    p.capture(text(&long, Origin::default()), false, 2, &x);
    let att = p.share(&first_id(&p)).unwrap();
    let full = PathBuf::from(att[0].path.clone().unwrap());
    assert!(full.starts_with(share::dir(tmp.path())) && std::fs::read_to_string(&full).unwrap() == long);
    let inline = att[0].text.as_deref().unwrap();
    assert!(inline.len() <= SHARE_INLINE && inline.ends_with("the full text is in the attached file.]"), "cut with a visible note");
    let wide = "é".repeat(SHARE_INLINE); // 2-byte chars: the cut lands on a char boundary
    p.capture(text(&wide, Origin::default()), false, 5, &x);
    assert!(p.share(&first_id(&p)).unwrap()[0].text.as_deref().unwrap().len() <= SHARE_INLINE);
    p.capture(text("short", Origin::default()), false, 3, &x);
    assert_eq!(p.share(&first_id(&p)).unwrap()[0].text.as_deref(), Some("short"));
}

#[test]
fn history_off_and_clear_remove_the_vault_file() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(text(PW, bitwarden()), false, 1, &x);
    p.capture(text("plain", Origin::default()), false, 2, &x);
    p.clear(true);
    assert_eq!(p.list(false).len(), 1, "only passwords went");
    assert!(!vault::path(tmp.path()).exists());
    p.capture(text(PW, bitwarden()), false, 3, &x);
    p.set_config(Config { history: false, ..Config::default() }, 4);
    assert!(p.list(false).is_empty() && !vault::path(tmp.path()).exists());
    assert!(p.capture(text("new", Origin::default()), false, 5, &x).is_empty(), "off: nothing is read in");
}

#[test]
fn the_share_sheet_gets_text_as_text_and_an_image_as_its_file() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    p.capture(text("hello world", Origin::default()), false, 1, &x);
    assert_eq!(p.share_sheet(&first_id(&p)), Ok(crate::shelf::ShareTarget::Text("hello world".into())));
    p.capture(image(4), false, 2, &x);
    let Ok(crate::shelf::ShareTarget::Files(f)) = p.share_sheet(&first_id(&p)) else { panic!("an image is a file") };
    assert!(f[0].starts_with(ClipHistory::img_dir(tmp.path())));
}

/// Demo mode with the brief's "fake fs": the would-be data folder (an empty temp dir) stays empty whatever the
/// owner does; text history works in memory, images and passwords (which need a file) are not taken.
#[test]
fn demo_clip_history_never_writes_to_the_filesystem() {
    let tmp = Tmp::new();
    std::fs::write(tmp.path().join("marker"), b"").unwrap(); // a file the demo must not touch either
    let x = Xor::default();
    let mut p = ClipHistory::demo(tmp.path().to_path_buf(), Config::default());
    assert!(p.list(false).is_empty(), "nothing read from disk");
    assert!(!p.capture(text("hello", Origin::default()), false, 1, &x).is_empty());
    assert!(p.capture(text(PW, bitwarden()), false, 2, &x).is_empty(), "no password without the vault file");
    assert!(p.capture(image(7), false, 3, &x).is_empty(), "no image without its file");
    let id = first_id(&p);
    p.pin(&id, true).unwrap();
    assert!(p.share(&id).is_ok(), "short text goes inline");
    p.capture(text(&"x".repeat(SHARE_INLINE + 1), Origin::default()), false, 4, &x);
    assert_eq!(p.share(&first_id(&p)), Err(ClipErr::Io), "no share-folder copy in demo");
    p.delete(&id).unwrap();
    p.tick(MAX_AGE_MS * 2);
    p.clear(true);
    p.clear(false);
    let names: Vec<_> = std::fs::read_dir(tmp.path()).unwrap().flatten().map(|e| e.file_name()).collect();
    assert_eq!(names, ["marker"], "nothing written, nothing removed");
}

fn files(paths: &[&Path]) -> Copied {
    Copied {
        clip: Clip::Files(paths.iter().map(|p| p.to_string_lossy().into_owned()).collect()),
        origin: Origin::default(),
        own: false,
    }
}

#[test]
fn open_and_shelf_take_images_and_files_and_refuse_passwords_text_and_the_lock() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    let out = tmp.path().join("out");
    p.capture(text("plain text", Origin::default()), false, 1, &x);
    let text_id = first_id(&p);
    p.capture(text(PW, bitwarden()), false, 2, &x);
    let pw_id = first_id(&p);
    p.capture(image(7), false, 3, &x);
    let img_id = first_id(&p);

    // image: a copy in `out`, the clipboard's own PNG stays
    let copy = p.open_path(&img_id, false, &out).unwrap();
    assert_eq!(std::fs::read(&copy).unwrap(), b"PNG");
    assert!(copy.starts_with(&out) && ClipHistory::img_dir(tmp.path()).join(format!("{img_id}.png")).exists());
    let shelf = p.shelf_sources(&img_id, false, &out).unwrap();
    assert_eq!(shelf.len(), 1);
    assert_eq!(shelf[0].1, Some(3));
    assert!(shelf[0].0.file_name().unwrap().to_string_lossy().starts_with("image-"));

    // locked / password / text
    for id in [&img_id, &text_id] {
        assert_eq!(p.open_path(id, true, &out).err(), Some(ClipErr::Locked));
        assert_eq!(p.shelf_sources(id, true, &out).err(), Some(ClipErr::Locked));
    }
    assert_eq!(p.open_path(&pw_id, false, &out).err(), Some(ClipErr::Password));
    assert_eq!(p.open_path(&pw_id, true, &out).err(), Some(ClipErr::Password), "locked or not, never a password");
    assert_eq!(p.shelf_sources(&pw_id, false, &out).err(), Some(ClipErr::Password));
    assert_eq!(p.open_path(&text_id, false, &out).err(), Some(ClipErr::Kind));
    assert_eq!(p.shelf_sources(&text_id, false, &out).err(), Some(ClipErr::Kind));
    assert_eq!(p.open_path("nope", false, &out).err(), Some(ClipErr::Unknown));
    assert!(!has(&all_files(&out), PW), "no password text in any copy");
}

#[test]
fn a_file_item_opens_its_first_existing_file_but_never_one_windows_would_run() {
    let tmp = Tmp::new();
    let (mut p, x) = (clip_history(&tmp), Xor::default());
    let out = tmp.path().join("out");
    let doc = tmp.write("belge.pdf", b"%PDF");
    let exe = tmp.write("setup.EXE", b"MZ");
    let gone = tmp.path().join("deleted.txt");

    p.capture(files(&[&gone, &doc]), false, 1, &x);
    let id = first_id(&p);
    assert_eq!(p.open_path(&id, false, &out).unwrap(), doc, "skips the missing first path");
    let on_shelf = p.shelf_sources(&id, false, &out).unwrap();
    assert_eq!(on_shelf, vec![(doc.clone(), Some(4))], "only what exists, with sizes");

    p.capture(files(&[&exe]), false, 2, &x);
    let exe_id = first_id(&p);
    assert_eq!(p.open_path(&exe_id, false, &out).err(), Some(ClipErr::Risky), "no launching a program");
    assert_eq!(p.shelf_sources(&exe_id, false, &out).unwrap().len(), 1, "the shelf only holds it");

    p.capture(files(&[&gone]), false, 3, &x);
    let gone_id = first_id(&p);
    assert_eq!(p.open_path(&gone_id, false, &out).err(), Some(ClipErr::Missing));
    assert_eq!(p.shelf_sources(&gone_id, false, &out).err(), Some(ClipErr::Missing));
}
