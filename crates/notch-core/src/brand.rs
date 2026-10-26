//! The build's identity, read at build time from the brand file (`brand/peeka.json`, or the path in `NOTCH_BRAND`;
//! `build.rs`). Peeka's own file holds today's values, so a default build is exactly Peeka. The Tauri side
//! (`productName`, `mainBinaryName`, `identifier`, publisher) comes from `tauri build --config <file>`.

include!(concat!(env!("OUT_DIR"), "/brand.rs"));

#[cfg(test)]
mod tests {
    mod generator {
        include!("../brand_gen.rs");
        pub fn run(json: &str) -> Result<String, String> {
            brand_rs(json)
        }
    }

    #[test]
    fn the_default_brand_is_todays_peeka() {
        assert_eq!(super::PRODUCT_NAME, "Peeka");
        assert_eq!(super::CODE_NAME, "notch");
        assert_eq!(super::DATA_DIR_ENV, "NOTCH_DATA_DIR");
        assert_eq!(super::EXE_NAME, "peeka");
        assert_eq!(super::HOOK_ARG, "--cc-hook");
        assert_eq!((super::MIRROR_PACKAGE, super::MIRROR_PUBLISHER), ("Notch.Mirror", "CN=Notch"));
        assert_eq!(super::UPDATES_URL, Some("https://github.com/isDionn/peeka/releases/latest"));
        assert_eq!(super::ISLAND_MAX, (760.0, 620.0));
        assert!(super::PAGE_REQUESTS.is_empty(), "Peeka itself: no page request path");
        assert!(super::START_KEY_HOOK && super::HIDE_TASKBAR && super::RESERVE_APPBAR, "system-wide hooks on");
        // where the values land
        assert_eq!((crate::model::ISLAND_WIDTH, crate::model::ISLAND_HEIGHT), (760.0, 620.0));
        assert_eq!(crate::plugins::cc_hooks::HOOK_ARG, "--cc-hook");
        assert_eq!((crate::mirror::PACKAGE_NAME, crate::mirror::PUBLISHER), ("Notch.Mirror", "CN=Notch"));
        assert_eq!(crate::supervise::RUN_VALUE_NAME, "notch");
        assert_eq!(crate::plugins::pipe::pipe_name("S-1-5-21").as_deref(), Some(r"\\.\pipe\notch-S-1-5-21"));
        assert_eq!(crate::plugins::pipe::cc_pipe_name("S-1-5-21").as_deref(), Some(r"\\.\pipe\notch-cc-S-1-5-21"));
        assert_eq!(crate::fidelity::settings_uri("https://github.com/isDionn/peeka/releases/latest"), Some("https://github.com/isDionn/peeka/releases/latest"));
        // ".bak-peeka" / ".tmp-peeka" / "hooks/peeka.json": cc_hooks' own tests hold the file names
    }

    const OTHER: &str = r#"{
        "product_name": "Other App", "code_name": "otherapp", "data_dir_env": "OTHERAPP_DATA_DIR", "exe_name": "otherapp",
        "hook_arg": "--otherapp-cc-hook", "mirror": { "package": "Other.Mirror", "publisher": "CN=Other" },
        "updates_url": null, "island_max": [1504, 900], "page_requests": ["x.list", "x.get"],
        "start_key_hook": false, "hide_taskbar": false, "reserve_appbar": false
    }"#;

    #[test]
    fn another_brand_gives_its_own_names() {
        let rs = generator::run(OTHER).unwrap();
        for line in [
            r#"PRODUCT_NAME: &str = "Other App";"#,
            r#"CODE_NAME: &str = "otherapp";"#,
            r#"DATA_DIR_ENV: &str = "OTHERAPP_DATA_DIR";"#,
            r#"EXE_NAME: &str = "otherapp";"#,
            r#"HOOK_ARG: &str = "--otherapp-cc-hook";"#,
            r#"MIRROR_PACKAGE: &str = "Other.Mirror";"#,
            "UPDATES_URL: Option<&str> = None;",
            "ISLAND_MAX: (f64, f64) = (1504.0, 900.0);",
            r#"PAGE_REQUESTS: &[&str] = &["x.list", "x.get"];"#,
            "START_KEY_HOOK: bool = false;",
            "HIDE_TASKBAR: bool = false;",
            "RESERVE_APPBAR: bool = false;",
        ] {
            assert!(rs.contains(line), "{line}\n{rs}");
        }
    }

    #[test]
    fn a_bad_brand_file_stops_the_build() {
        let bad = |from: &str, to: &str| generator::run(&OTHER.replace(from, to)).is_err();
        assert!(bad(r#""otherapp", "data"#, r#""Other App\\x", "data"#), "code name goes into pipe and folder names");
        assert!(bad("--otherapp-cc-hook", "otherapp-cc-hook"), "hook arg is a -- flag");
        assert!(bad("null", r#""http://x""#), "https only");
        assert!(bad(r#""x.get""#, r#""X Get""#), "method names only");
        assert!(bad("[1504, 900]", "[1504]"));
        assert!(bad(r#""hide_taskbar": false"#, r#""hide_taskbar": "no""#));
        assert!(bad(r#""CN=Other""#, r#""CN=\"x""#), "goes into XML attributes");
        assert!(generator::run("{").is_err());
    }
}
