//! The shelf's "Zip": .NET's `ZipArchive` through Windows PowerShell, so names stay Unicode (UTF-8 entries).
//! Windows's own tar.exe was tried first: it reads names through the ANSI code page and turned "Rapor şğü.txt" into
//! "Rapor sg.txt". About 0.5 s, most of it PowerShell starting. Empty folders are left out.

/// The script takes its paths from the environment, so nothing is quoted on a command line (it has no `"`).
#[cfg(windows)]
const SCRIPT: &str = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; \
$z=[IO.Compression.ZipFile]::Open($env:NOTCH_ZIP_OUT,'Create'); try { foreach($p in $env:NOTCH_ZIP_IN.Split([char]10)) { \
$i=Get-Item -LiteralPath $p; if($i.PSIsContainer){ $base=$i.Parent.FullName.TrimEnd([char]92).Length+1; \
Get-ChildItem -LiteralPath $p -Recurse -File -Force | % { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,$_.FullName,$_.FullName.Substring($base).Replace([char]92,[char]47)) } } \
else { [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,$i.FullName,$i.Name) } } } finally { $z.Dispose() }";

/// `paths` (files and folders) into a new zip at `out`; false = failed (a partial zip is deleted). Blocks: call it off
/// the UI thread.
#[cfg(windows)]
pub fn zip(out: &std::path::Path, paths: &[std::path::PathBuf]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Some(dir) = crate::downloads::windows_dir() else { return false };
    let list: Vec<String> = paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let ok = std::process::Command::new(format!(r"{dir}\System32\WindowsPowerShell\v1.0\powershell.exe"))
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("NOTCH_ZIP_OUT", out)
        .env("NOTCH_ZIP_IN", list.join("\n"))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        let _ = std::fs::remove_file(out);
    }
    ok && out.is_file()
}

#[cfg(not(windows))]
pub fn zip(_out: &std::path::Path, _paths: &[std::path::PathBuf]) -> bool {
    false
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn a_zip_keeps_turkish_names_and_folders() {
        let dir = std::env::temp_dir().join(format!("notch-zip-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Fotoğraflar").join("alt")).unwrap();
        std::fs::write(dir.join("Rapor şğü.txt"), b"hi").unwrap();
        std::fs::write(dir.join("Fotoğraflar").join("alt").join("x.pdf"), b"yo").unwrap();
        let out = dir.join("out.zip");
        assert!(super::zip(&out, &[dir.join("Rapor şğü.txt"), dir.join("Fotoğraflar")]));
        let bytes = std::fs::read(&out).unwrap();
        assert!(bytes.starts_with(b"PK\x03\x04"));
        let has = |s: &str| bytes.windows(s.len()).any(|w| w == s.as_bytes());
        assert!(has("Rapor şğü.txt") && has("Fotoğraflar/alt/x.pdf"), "UTF-8 names, folder kept");
        assert!(!super::zip(&dir.join("bad.zip"), &[dir.join("missing.txt")]));
        assert!(!dir.join("bad.zip").exists(), "a failed zip leaves nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
