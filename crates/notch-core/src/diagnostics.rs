//! "Save diagnostics" (Ctrl+Alt+Shift+D, Settings > About): one plain text file the owner attaches to a bug screenshot.
//! Written locally, never sent, but the owner may pass it on. Privacy: only Peeka's own versions and geometry. No window
//! titles, clipboard content, notification text, other apps' names, the Windows user name, user folder paths, plugin
//! tokens or the HTTP alert API key (none of those has a field here; `scrub` is the backstop); that is why every field here is a number, a version or one of Peeka's own
//! labels, and the settings are an allowlist (pins and shortcut exceptions hold app names, so they are never written).

use crate::clickthrough::CssRect;
use crate::model::Monitor;
use crate::settings::Settings;

/// left, top, right, bottom (physical px).
pub type Box4 = (i32, i32, i32, i32);

/// One Peeka window: the island or a strip.
pub struct PageDiag {
    /// "island" or "strip-<monitor>".
    pub label: String,
    /// GetWindowRect, screen px; None = Windows would not say.
    pub window: Option<Box4>,
    /// The region Windows applies (GetWindowRgn's rectangles, window-relative); None = no region set.
    pub region: Option<Vec<Box4>>,
    /// The boxes Peeka asked for from the page's rectangles (`clickthrough::*region_boxes`): the strip's region, the island's hit rects.
    pub wanted: Vec<Box4>,
    pub scale: f64,
    /// The last rectangles the page reported (CSS px), the devicePixelRatio it saw and its open panel or card.
    pub rects: Vec<CssRect>,
    pub dpr: Option<f64>,
    pub view: String,
}

pub struct Diag {
    pub when: String,
    pub version: String,
    pub windows: String,
    pub webview2: String,
    pub monitors: Vec<Monitor>,
    /// "name, driver x.y.z.w" per adapter.
    pub gpus: Vec<String>,
    pub pages: Vec<PageDiag>,
}

pub const HEADER: &str = "Peeka diagnostics. Saved on this PC only; nothing was sent.\n\
Contains versions, screen and window geometry and a few settings. No window titles, clipboard content, notification text, app names, user name, user folders, keys or tokens.\n";

fn boxes(b: &[Box4]) -> String {
    if b.is_empty() {
        return "(none)".into();
    }
    b.iter().map(|(l, t, r, bt)| format!("[{l},{t} {r}x{bt}]", r = r - l, bt = bt - t)).collect::<Vec<_>>().join(" ")
}

pub fn render(d: &Diag, s: &Settings) -> String {
    let mut o = String::from(HEADER);
    o += &format!("\nSaved: {}\nPeeka: {}\nWindows: {}\nWebView2: {}\n", d.when, d.version, d.windows, d.webview2);
    o += "\n[Monitors]\n";
    for m in &d.monitors {
        let r = m.rect;
        o += &format!(
            "#{} {}rect [{},{} {}x{}] scale {} ({} dpi) {} Hz\n",
            m.index,
            if m.primary { "primary " } else { "" },
            r.left,
            r.top,
            r.width(),
            r.height(),
            m.scale,
            (m.scale * 96.0).round(),
            m.hz
        );
    }
    o += "\n[GPU]\n";
    for g in &d.gpus {
        o += &format!("{g}\n");
    }
    for p in &d.pages {
        o += &format!("\n[{}]\n", p.label);
        o += &format!("window: {}\n", p.window.map_or("(unknown)".into(), |w| boxes(&[w])));
        if p.label == "island" {
            // the island sets no SetWindowRgn: a fixed transparent window whose clicks pass through (cursor poll) outside these boxes
            o += &format!("hit rects (click-through, no region): {}\n", boxes(&p.wanted));
            if let Some(r) = &p.region {
                o += &format!("region (unexpected): {}\n", boxes(r));
            }
        } else {
            o += &format!("region: {}\n", p.region.as_deref().map_or("(no region, whole window)".into(), boxes));
            o += &format!("wanted: {}\n", boxes(&p.wanted));
        }
        o += &format!("scale: {}  page devicePixelRatio: {}\n", p.scale, p.dpr.map_or("(not reported)".into(), |v| v.to_string()));
        o += &format!("view: {}\n", if p.view.is_empty() { "(not reported)" } else { &p.view });
        o += &format!("page rects (CSS px): {}\n", p.rects.len());
        for r in &p.rects {
            o += &format!("  {},{} {}x{}{}\n", r.x, r.y, r.w, r.h, if r.paint { " paint" } else { "" });
        }
    }
    o += "\n[Settings]\n";
    o += &format!(
        "taskbar: {:?}\nstrips on other monitors: {}\ncolour icons: {}\nmascot pranks: {}\ncelebrate: {}\ndo not disturb: {}\nnotification mirror: {}\n",
        s.taskbar_hide, s.secondary_strips, s.color_icons, s.mascot_pranks, s.celebrate, s.dnd, s.mirror
    );
    o
}

/// The backstop before writing: the user folder becomes %USERPROFILE% and the user name %USERNAME%, in any case.
/// shortcut: a user name under 3 letters is left alone (it would hit ordinary words); nothing writes it anyway.
pub fn scrub(text: &str, profile: Option<&str>, user: Option<&str>) -> String {
    let mut out = text.to_string();
    for (find, with) in [(profile, "%USERPROFILE%"), (user.filter(|u| u.len() >= 3), "%USERNAME%")] {
        let Some(find) = find.map(|f| f.trim_end_matches('\\')).filter(|f| !f.is_empty()) else { continue };
        // ASCII lowercasing keeps byte offsets, so the indices found in `low` fit `out`
        let (low, needle) = (out.to_ascii_lowercase(), find.to_ascii_lowercase());
        let mut next = String::with_capacity(out.len());
        let mut at = 0;
        while let Some(i) = low[at..].find(&needle) {
            next.push_str(&out[at..at + i]);
            next.push_str(with);
            at += i + needle.len();
        }
        next.push_str(&out[at..]);
        out = next;
    }
    out
}

/// A page's view label is Peeka's own ("modules", "panel:settings"); anything else is cut so no text can ride along.
pub fn clean_view(v: &str) -> String {
    v.chars().take_while(|c| c.is_ascii_alphanumeric() || "-_:".contains(*c)).take(40).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Rect;
    use crate::apps::Pin;

    #[test]
    fn writes_geometry_and_no_private_text() {
        let mut s = Settings::default();
        s.pins.push(Pin { app_id: "exe:c:/SecretApp.exe".into(), name: "SecretApp".into(), relaunch: Some(r"C:\Users\x\SecretApp.exe --profile-directory=SecretApp".into()) });
        let d = Diag {
            when: "2026-10-26 12:00:00".into(),
            version: "0.3.4".into(),
            windows: "24H2 build 26100.1".into(),
            webview2: "130.0".into(),
            monitors: vec![Monitor { index: 0, rect: Rect { left: 0, top: 0, right: 2560, bottom: 1440 }, work: Rect { left: 0, top: 30, right: 2560, bottom: 1440 }, scale: 1.5, primary: true, hz: 144 }],
            gpus: vec!["Test GPU, driver 31.0.15.1".into()],
            pages: vec![PageDiag {
                label: "island".into(),
                window: Some((900, 0, 1660, 590)),
                region: None,
                wanted: vec![(10, 0, 370, 54)],
                scale: 1.5,
                rects: vec![CssRect { x: 7.0, y: 0.0, w: 240.0, h: 36.0, paint: false }],
                dpr: Some(1.5),
                view: clean_view("panel:settings <Secret title>"),
            }, PageDiag {
                label: "strip-m1".into(),
                window: Some((0, 0, 2560, 54)),
                region: Some(vec![(0, 0, 2560, 54)]),
                wanted: vec![(0, 0, 2560, 54)],
                scale: 1.5,
                rects: vec![],
                dpr: Some(1.5),
                view: String::new(),
            }],
        };
        let t = render(&d, &s);
        for want in ["Peeka: 0.3.4", "#0 primary rect [0,0 2560x1440] scale 1.5 (144 dpi) 144 Hz", "Test GPU", "[island]", "hit rects (click-through, no region): [10,0 360x54]", "[strip-m1]", "region: [0,0 2560x54]", "wanted: [0,0 2560x54]", "devicePixelRatio: 1.5", "7,0 240x36", "colour icons: true"] {
            assert!(t.contains(want), "missing {want:?} in\n{t}");
        }
        let island = &t[t.find("[island]").unwrap()..t.find("[strip-m1]").unwrap()];
        assert!(!island.contains("wanted:") && !island.contains("region:"), "the island has no region:\n{island}");
        let body = &t[HEADER.len()..].to_lowercase();
        for leak in ["secret", "title", "clipboard", "notification text", "token", "api key", "apikey", "users\\", "%user"] {
            assert!(!body.contains(leak), "{leak:?} leaked into\n{t}");
        }
    }

    #[test]
    fn scrub_hides_the_user_folder_and_name() {
        let t = scrub(r"a C:\Users\Bob\AppData\x; c:\users\bob\y; bob here; Bo", Some(r"C:\Users\Bob"), Some("Bob"));
        assert_eq!(t, r"a %USERPROFILE%\AppData\x; %USERPROFILE%\y; %USERNAME% here; Bo");
        assert_eq!(scrub("Al and Alice", None, Some("Al")), "Al and Alice"); // too short to replace safely
    }
}
