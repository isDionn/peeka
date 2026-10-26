include!("brand_gen.rs");

/// The brand file: `NOTCH_BRAND` (relative to the repo root, or absolute), else `brand/peeka.json`.
fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let path = root.join(std::env::var("NOTCH_BRAND").unwrap_or_else(|_| "brand/peeka.json".into()));
    println!("cargo:rerun-if-env-changed=NOTCH_BRAND");
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rerun-if-changed=brand_gen.rs");
    let json = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("brand file {}: {e}", path.display()));
    let rs = brand_rs(&json).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    std::fs::write(std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("brand.rs"), rs).unwrap();
}
