// The brand file (`brand/peeka.json`, or the path in `NOTCH_BRAND`) -> Rust consts. Shared by `build.rs` (writes
// `OUT_DIR/brand.rs`, read by `src/brand.rs`) and `src/brand.rs`'s tests (a non-default brand). A bad file stops the build.

fn brand_rs(json: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("brand file: {e}"))?;
    let s = |k: &str, ok: fn(char) -> bool| -> Result<String, String> {
        let t = v.get(k).and_then(|x| x.as_str()).ok_or(format!("brand: {k} must be a string"))?;
        if t.is_empty() || t.len() > 64 || !t.chars().all(ok) {
            return Err(format!("brand: {k} has a character it may not have: {t:?}"));
        }
        Ok(t.to_string())
    };
    let name = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    let product = s("product_name", |c| !c.is_control())?;
    let code = s("code_name", |c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')?;
    let env = s("data_dir_env", |c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')?;
    let exe = s("exe_name", name)?;
    let hook = s("hook_arg", name)?;
    if !hook.starts_with("--") {
        return Err("brand: hook_arg must start with --".into());
    }
    let mirror = v.get("mirror").ok_or("brand: mirror is missing")?;
    let m = |k: &str| mirror.get(k).and_then(|x| x.as_str()).filter(|t| !t.is_empty() && !t.contains(['"', '<', '>', '&'])).ok_or(format!("brand: mirror.{k} must be a plain string"));
    let (package, publisher) = (m("package")?, m("publisher")?);
    let updates = match v.get("updates_url") {
        Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(u)) if u.starts_with("https://") && !u.contains(char::is_whitespace) => Some(u.clone()),
        _ => return Err("brand: updates_url must be null or an https:// link".into()),
    };
    let size = v.get("island_max").and_then(|x| x.as_array()).filter(|a| a.len() == 2).ok_or("brand: island_max must be [width, height]")?;
    let px = |i: usize| size[i].as_f64().filter(|n| *n >= 100.0 && *n <= 8000.0).ok_or("brand: island_max values must be 100..8000");
    let (w, h) = (px(0)?, px(1)?);
    let reqs = v.get("page_requests").and_then(|x| x.as_array()).ok_or("brand: page_requests must be a list")?;
    let mut names = vec![];
    for r in reqs.iter().take(65) {
        let n = r.as_str().unwrap_or_default();
        let mut cs = n.chars();
        let ok = n.len() <= 64 && cs.next().is_some_and(|c| c.is_ascii_lowercase()) && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '.');
        if !ok || names.len() == 64 {
            return Err(format!("brand: page_requests: {r} is not a method name (a-z0-9_. , at most 64 names)"));
        }
        names.push(n.to_string());
    }
    let flag = |k: &str| v.get(k).and_then(|x| x.as_bool()).ok_or(format!("brand: {k} must be true or false"));
    let (start_key, hide_taskbar, appbar) = (flag("start_key_hook")?, flag("hide_taskbar")?, flag("reserve_appbar")?);
    Ok(format!(
        "pub const PRODUCT_NAME: &str = {product:?};\n\
         pub const CODE_NAME: &str = {code:?};\n\
         pub const DATA_DIR_ENV: &str = {env:?};\n\
         pub const EXE_NAME: &str = {exe:?};\n\
         pub const HOOK_ARG: &str = {hook:?};\n\
         pub const MIRROR_PACKAGE: &str = {package:?};\n\
         pub const MIRROR_PUBLISHER: &str = {publisher:?};\n\
         pub const UPDATES_URL: Option<&str> = {updates:?};\n\
         pub const ISLAND_MAX: (f64, f64) = ({w:?}, {h:?});\n\
         pub const PAGE_REQUESTS: &[&str] = &{names:?};\n\
         pub const START_KEY_HOOK: bool = {start_key};\n\
         pub const HIDE_TASKBAR: bool = {hide_taskbar};\n\
         pub const RESERVE_APPBAR: bool = {appbar};\n"
    ))
}
