//! Dev check for the hidden-icons list (not shipped): `cargo run -p notch-win --example tray_icons [out_dir]` prints,
//! per running tray app, whether its exe gave an icon and how it reads (no names, only the list index); with `out_dir`
//! each icon is also saved there as `<index>.png` to look at.
fn main() {
    #[cfg(windows)]
    {
        use base64::Engine;
        notch_win::com();
        let out = std::env::args().nth(1);
        let list = notch_win::tray::list();
        let mut missing = 0;
        for (i, t) in list.iter().enumerate() {
            match notch_win::icons::icon(&t.exe) {
                Some(icon) => {
                    let png = base64::engine::general_purpose::STANDARD.decode(icon.url.split(',').nth(1).unwrap_or("")).unwrap_or_default();
                    let size = png::Decoder::new(std::io::Cursor::new(&png)).read_info().map(|r| r.info().width).unwrap_or(0);
                    println!("{i:2}: ok   side {size:2} px  dark {}  blob {}", icon.dark, icon.blob);
                    if let Some(dir) = &out {
                        let _ = std::fs::write(format!("{dir}/{i}.png"), png);
                    }
                }
                None => {
                    missing += 1;
                    println!("{i:2}: NONE  (exe on disk: {})", std::path::Path::new(&t.exe).exists());
                }
            }
        }
        println!("{} tray apps, {missing} without an icon", list.len());
    }
}
