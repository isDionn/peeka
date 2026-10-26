//! Dev check for the Wi-Fi / Bluetooth pickers (not shipped): `cargo run -p notch-win --example radios` prints only
//! counts and flags, never network or device names.
fn main() {
    #[cfg(windows)]
    {
        let t = std::time::Instant::now();
        match notch_win::wifi::networks() {
            None => println!("wifi: no adapter ({} ms)", t.elapsed().as_millis()),
            Some(l) => println!(
                "wifi: {} networks, {} secured, {} known, {} connected ({} ms)",
                l.len(),
                l.iter().filter(|n| n.secure).count(),
                l.iter().filter(|n| n.known).count(),
                l.iter().filter(|n| n.connected).count(),
                t.elapsed().as_millis()
            ),
        }
        let t = std::time::Instant::now();
        let d = notch_win::bluetooth::devices();
        let kinds: Vec<String> = d.iter().map(|x| format!("{:?}/{:?}/{}", x.kind, x.battery, x.connected)).collect();
        println!("bluetooth: {} paired {kinds:?} ({} ms)", d.len(), t.elapsed().as_millis());
    }
}
