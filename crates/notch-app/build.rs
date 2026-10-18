fn main() {
    // tauri-build's default manifest plus the `<msix>` link to the notification mirror's sparse package (Wave 6);
    // Windows ignores that link until the owner registers the package (`identity/register.ps1`).
    println!("cargo:rerun-if-changed=notch.manifest");
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("notch.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build failed");
}
