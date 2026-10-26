fn main() {
    // tauri-build's default manifest plus the `<msix>` link to the notification mirror's sparse package (Wave 6);
    // Windows ignores that link until the owner registers the package (`identity/register.ps1`). The package name and
    // publisher come from the brand file (notch-core's build.rs checks it); Peeka's own equal the file's text.
    println!("cargo:rerun-if-changed=notch.manifest");
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let brand = root.join(std::env::var("NOTCH_BRAND").unwrap_or_else(|_| "brand/peeka.json".into()));
    println!("cargo:rerun-if-env-changed=NOTCH_BRAND");
    println!("cargo:rerun-if-changed={}", brand.display());
    let brand: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&brand).expect("brand file")).expect("brand file");
    let mirror = |k: &str| brand["mirror"][k].as_str().expect("brand mirror").to_string();
    let peeka = r#"publisher="CN=Notch" packageName="Notch.Mirror""#;
    assert!(include_str!("notch.manifest").contains(peeka), "notch.manifest: the <msix> line changed");
    let manifest = include_str!("notch.manifest")
        .replace(peeka, &format!(r#"publisher="{}" packageName="{}""#, mirror("publisher"), mirror("package")));
    let windows = tauri_build::WindowsAttributes::new().app_manifest(manifest);
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build failed");
}
