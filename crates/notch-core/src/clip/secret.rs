//! The password class. A text copy is a password when (a) the clipboard carries one of the four
//! "keep out of history" flags, (b) the clipboard owner or the foreground window is a sensitive app,
//! or (c) the text matches a secret pattern (the tests below are the patterns' own examples).
//! Rust's `regex` has no look-around: the Python `(?<!…)` / `(?!…)` / `(?=…)` parts are written as a consumed
//! boundary or a check on the match. Only "is there one" matters here, never the replacement.

use std::sync::LazyLock;

use regex::Regex;

/// The four clipboard formats a password manager sets: here they mean "password class", not "skip".
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Flags {
    /// `ExcludeClipboardContentFromMonitorProcessing` present.
    pub exclude: bool,
    /// `Clipboard Viewer Ignore` present.
    pub viewer_ignore: bool,
    /// `CanIncludeInClipboardHistory` = 0.
    pub no_history: bool,
    /// `CanUploadToCloudClipboard` = 0.
    pub no_cloud: bool,
}

impl Flags {
    pub fn any(&self) -> bool {
        self.exclude || self.viewer_ignore || self.no_history || self.no_cloud
    }
}

/// `sensitive_apps.PROCESSES`.
const PROCESSES: [&str; 27] = [
    "1password.exe",
    "bitwarden.exe",
    "keepass.exe",
    "keepassxc.exe",
    "lastpass.exe",
    "dashlane.exe",
    "enpass.exe",
    "nordpass.exe",
    "roboform.exe",
    "protonpass.exe",
    "credentialuibroker.exe",
    "consent.exe",
    "securityhealthsystray.exe",
    "securityhealthui.exe",
    "logonui.exe",
    "windowsdefender.exe",
    "authy.exe",
    "authy desktop.exe",
    "winauth.exe",
    "2fas.exe",
    "ledger live.exe",
    "trezor suite.exe",
    "exodus.exe",
    "electrum.exe",
    "binance.exe",
    "trustwallet.exe",
    "bitcoin-qt.exe",
];

/// The row's source name for the well-known password managers ("Bitwarden · encrypted · 1 h").
const MANAGERS: [(&str, &str); 10] = [
    ("1password.exe", "1Password"),
    ("bitwarden.exe", "Bitwarden"),
    ("keepass.exe", "KeePass"),
    ("keepassxc.exe", "KeePassXC"),
    ("lastpass.exe", "LastPass"),
    ("dashlane.exe", "Dashlane"),
    ("enpass.exe", "Enpass"),
    ("nordpass.exe", "NordPass"),
    ("roboform.exe", "RoboForm"),
    ("protonpass.exe", "Proton Pass"),
];

/// `sensitive_apps._TITLE`, matched on the folded title.
// Turkish words and bank names kept on purpose: they detect Turkish password, bank and security windows.
static TITLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"1password|bitwarden|keepass|lastpass|dashlane|enpass|nordpass|roboform|proton pass",
        r"|parola yoneticisi|sifre yoneticisi|password manager",
        r"|windows guvenligi|windows security|kullanici hesabi denetimi|user account control|kimlik bilgileri",
        r"|windows hello|credential manager|bank",
        r"|\bziraat\b|garanti bbva|yapi kredi|\bqnb\b|\benpara\b|\bpapara\b|kuveyt turk|albaraka|internet subesi",
        r"|mobil sube|\biban\b|3d secure",
        r"|\.env\b|\bid_rsa|\bid_ed25519|\bcredentials\b|\.pem\b|\.kdbx\b|private key|secret key",
        r"|metamask|binance|\bledger\b|trezor|exodus wallet|trust wallet|phantom wallet|coinbase|electrum|btcturk|paribu",
        r"|authenticator|\bauthy\b|steam ?guard|winauth|\b2fa\b",
    ))
    .expect("title pattern")
});

/// `question_text.fold_tr`: Turkish letters to ASCII, then lower case.
pub fn fold_tr(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'ç' | 'Ç' => 'c',
            'ğ' | 'Ğ' => 'g',
            'ı' | 'I' | 'İ' => 'i',
            'ö' | 'Ö' => 'o',
            'ş' | 'Ş' => 's',
            'ü' | 'Ü' => 'u',
            c => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// The exe's file name, lower case (`C:\…\Bitwarden.exe` -> `bitwarden.exe`).
fn exe_name(exe: &str) -> String {
    exe.rsplit(['\\', '/']).next().unwrap_or(exe).trim().to_lowercase()
}

pub fn sensitive_exe(exe: &str) -> bool {
    PROCESSES.contains(&exe_name(exe).as_str())
}

pub fn sensitive_title(title: &str) -> bool {
    !title.is_empty() && TITLE.is_match(&fold_tr(title))
}

/// "Bitwarden" for a known password manager's exe; None otherwise.
pub fn manager_name(exe: &str) -> Option<&'static str> {
    let name = exe_name(exe);
    MANAGERS.iter().find(|(e, _)| *e == name).map(|(_, n)| *n)
}

// Turkish words on purpose: they detect Turkish password phrasing ("parola", "şifrem") in copied text.
const SECRET_WORD: &str =
    r"(?:api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|token|password|passwd|pwd|parola|şifre|sifre)";
const TR_POSSESSIVE: &str = r"(?:şifre|sifre|parola)(?:m|miz|mız|n|niz|nız|si|sı)";

/// `redact._PATTERNS` + the Telegram and possessive-with-separator `_TR_PATTERNS`: a hit anywhere = a secret.
static PLAIN: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    let pair = format!(r#"(?i)(?:^|[^\w-])[\w-]*?{SECRET_WORD}"?'?\s*[=:]\s*"?'?[^\s"'&,;}}]{{4,}}"#);
    let tr_sep = format!(r"(?i)\b{TR_POSSESSIVE}\s*[=:]\s*\S{{4,}}");
    [
        r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----",
        r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
        r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}",
        r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})",
        r"\bxox[abposr]-[A-Za-z0-9-]{10,}",
        r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
        r"\bAIza[0-9A-Za-z_-]{35}",
        r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{12,}",
        r"\bhf_[A-Za-z0-9]{30,}",
        r"discord(?:app)?\.com/api/webhooks/\d+/[A-Za-z0-9_-]{20,}",
        r"\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}",
        r"\bya29\.[A-Za-z0-9_-]{20,}",
        r"\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b",
        r"(?i)authorization\s*[:=]\s*basic\s+[A-Za-z0-9+/=]{8,}",
        r"(?i)\b[a-z][a-z0-9+.-]*://[^\s:/@]+:[^\s@/]+@",
        r"(?im)^[ \t]*(?:\w+_(?:TOKEN|KEY|SECRET|PASSWORD))[ \t]+\S",
        &pair,
        r"\b\d{8,10}:[A-Za-z0-9_-]{35}(?:[^A-Za-z0-9_-]|$)",
        &tr_sep,
    ]
    .iter()
    .map(|p| Regex::new(p).expect("secret pattern"))
    .collect()
});

/// "şifrem gizli123": a bare space, so only a value with a digit or a symbol counts ("şifrem çok uzun" does not).
static TR_SPACE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"(?i)\b{TR_POSSESSIVE}\s+(\S{{4,}})")).expect("tr pattern"));
static IBAN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b").expect("iban"));
static CARD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\d-])((?:[2-6]\d|9792)(?:[ -]?\d){11,17})(?:$|[^\d-])").expect("card"));
static TC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?:^|\D)([1-9]\d{10})(?:$|\D)").expect("tc"));

fn digits(s: &str) -> Vec<u32> {
    s.chars().filter_map(|c| c.to_digit(10)).collect()
}

fn tc_ok(s: &str) -> bool {
    let d = digits(s);
    if d.len() != 11 {
        return false;
    }
    let odd: i64 = d[0..9].iter().step_by(2).map(|&x| x as i64).sum();
    let even: i64 = d[1..8].iter().step_by(2).map(|&x| x as i64).sum();
    (odd * 7 - even).rem_euclid(10) == d[9] as i64 && d[..10].iter().sum::<u32>() % 10 == d[10]
}

fn iban_ok(s: &str) -> bool {
    let iban: String = s.chars().filter(|c| *c != ' ').collect::<String>().to_uppercase();
    let (head, tail) = iban.split_at(4.min(iban.len()));
    let mut r = 0u32;
    for c in tail.chars().chain(head.chars()) {
        let Some(v) = c.to_digit(36) else { return false };
        r = if v < 10 { (r * 10 + v) % 97 } else { (r * 100 + v) % 97 };
    }
    r == 1
}

fn luhn_ok(s: &str) -> bool {
    let sum: u32 = digits(s)
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &x)| {
            if i % 2 == 0 {
                x
            } else if x > 4 {
                x * 2 - 9
            } else {
                x * 2
            }
        })
        .sum();
    sum.is_multiple_of(10)
}

/// Would `redact.redact` change this text? (The same patterns, as a yes/no.)
pub fn has_secret(text: &str) -> bool {
    PLAIN.iter().any(|r| r.is_match(text))
        || TR_SPACE
            .captures_iter(text)
            .any(|c| c[1].chars().any(|ch| ch.is_ascii_digit() || "!@#$%^&*+_=-".contains(ch)))
        || IBAN.find_iter(text).any(|m| iban_ok(m.as_str()))
        || CARD.captures_iter(text).any(|c| luhn_ok(&c[1]))
        || TC.captures_iter(text).any(|c| tc_ok(&c[1]))
}

/// What the listener saw besides the content.
#[derive(Clone, Debug, Default)]
pub struct Origin {
    pub flags: Flags,
    /// The clipboard owner's exe path (None = no owner window, e.g. Print Screen).
    pub owner_exe: Option<String>,
    pub foreground_exe: Option<String>,
    pub foreground_title: Option<String>,
}

impl Origin {
    /// (a) or (b): true for any kind of copy. A flagged image or file copy is never stored.
    pub fn sensitive(&self) -> bool {
        self.flags.any()
            || self.owner_exe.as_deref().is_some_and(sensitive_exe)
            || self.foreground_exe.as_deref().is_some_and(sensitive_exe)
            || self.foreground_title.as_deref().is_some_and(sensitive_title)
    }
}

/// A text copy's class: flag, app, or pattern.
pub fn password_class(text: &str, origin: &Origin) -> bool {
    origin.sensitive() || has_secret(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `core/tests/test_redact.py`, every example that `redact` changes.
    const SECRET_TEXTS: &[&str] = &[
        // SECRETS (wrapped as "before X after")
        concat!("before sk-ant-api03-abcdefghijklmnop", "qrstuvwxyz012345 after"), // allow-secret
        concat!("before sk-proj-AbCdEfGhIjKlM", "nOpQrStUv1234 after"), // allow-secret
        concat!("before ghp_abcdefghijklmnop", "qrstuvwxyz0123456789 after"), // allow-secret
        concat!("before github_pat_11ABCDEFG012", "3456789_abcdefghijklmnop after"), // allow-secret
        concat!("before xoxb-1234567890-abcdef", "ghijkl after"), // allow-secret
        concat!("before AKIAIOSFOD", "NN7EXAMPLE after"), // allow-secret
        concat!("before AIzaSyA1234567890ab", "cdefghijklmnopqrstuv after"), // allow-secret
        concat!("before eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5", "N_XgL0n3I9PlFUP0THsR8U after"), // allow-secret
        // MORE_SECRETS
        concat!("before hf_", "abcdefghijklmnopqrstuvwxyzABCDEFGH after"), // allow-secret
        concat!("before sk_live_51H8abcde", "fghijklmnopqrstuv after"), // allow-secret
        concat!("before rk_live_51H8abcde", "fghijklmnopqrstuv after"), // allow-secret
        concat!("before ya29.a0AfH6SMBabcdefghijklm", "nopqrstuvwxyz0123456789 after"), // allow-secret
        concat!("before MTIzNDU2Nzg5MDEyMzQ1Njc4.GAbCdE.abcdefghijklmnop", "qrstuvwxyz0123456 after"), // allow-secret
        // private key, bearer, basic, URL credentials
        concat!("x -----BEGIN RSA PRIVATE KEY-----\nMIIEpAI", "BAAKCAQEA\nabc\n-----END RSA PRIVATE KEY----- y"), // allow-secret
        "Authorization: Bearer abcdef0123456789xyz",
        "Authorization: Basic dXNlcjpodW50ZXIy",
        "clone https://deploy:hunter2secret@example.com/repo.git now",
        // key=value pairs
        "password=hunter22",
        "DB_PASSWORD: s3cr3tvalue",
        "api_key='abcd1234efgh'",
        r#"{"github_token": "tok_abcdef123"}"#,
        "parola=gizli123",
        "my_secret_token: 'hunter22x'",
        "prod-api-key = zzzz1234",
        "--api-key=abcd1234",
        "x a-b-c-api_key=abcd1234",
        r#"export TOKEN="abcd1234efgh" }"#,
        // `Get-ChildItem env:` table lines
        "Name    Value\n----    -----\nMYAPP_AUTH_TOKEN            s3cr3tvalue123\nPATH   C:\\bin",
        "Name    Value\n----    -----\nMYAPP_API_SECRET            s3cr3tvalue123\nPATH   C:\\bin",
        "Name    Value\n----    -----\nGITHUB_TOKEN            s3cr3tvalue123\nPATH   C:\\bin",
        "Name    Value\n----    -----\nOPENAI_API_KEY            s3cr3tvalue123\nPATH   C:\\bin",
        "Name    Value\n----    -----\nMY_SECRET            s3cr3tvalue123\nPATH   C:\\bin",
        // Turkish ids (checksum-checked), Telegram, Turkish possessives (şifrem = my password; matched on purpose), Discord webhook
        "TC: 10000000146 ok",
        "IBAN TR330006100519786457841326 .",
        "IBAN TR33 0006 1005 1978 6457 8413 26 .",
        "card 4111 1111 1111 1111 ok",
        "card 5500-0000-0000-0004 ok",
        "card 4111111111111111 ok",
        concat!("bot 123456789:AAEx1_-x1_-x1_-", "x1_-x1_-x1_-x1_-x1_- ready"), // allow-secret
        "şifrem gizli123",
        "parolam=abcd1234",
        "Şifremiz: kedi1234",
        concat!("HTTP Request: POST https://discord.com/api/webhooks/1000000000000000000/", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA 200 OK"),
    ];

    /// The examples `redact` leaves exactly as they are.
    const PLAIN_TEXTS: &[&str] = &[
        "input_tokens=1200",
        "tokens: 340",
        "token_count=12",
        "max_tokens: 4096",
        "hello",
        "order 12345678901",
        "TR330006100519786457841327",
        "card 4111111111111112",
        "şifremi unuttum",
        "şifreniz nedir?",
        "şifrem çok uzun",
    ];

    #[test]
    fn the_patterns_agree_with_redact_py_examples() {
        for t in SECRET_TEXTS {
            assert!(has_secret(t), "should be a secret: {t:?}");
        }
        for t in PLAIN_TEXTS {
            assert!(!has_secret(t), "should be plain: {t:?}");
        }
    }

    #[test]
    fn the_three_ways_into_the_password_class() {
        let plain = "cat photo";
        assert!(!password_class(plain, &Origin::default()));
        // (a) a password manager's flag, any of the four
        for flags in [
            Flags { exclude: true, ..Default::default() },
            Flags { viewer_ignore: true, ..Default::default() },
            Flags { no_history: true, ..Default::default() },
            Flags { no_cloud: true, ..Default::default() },
        ] {
            assert!(password_class(plain, &Origin { flags, ..Default::default() }));
        }
        // (b) the owner or the foreground app
        let owner =
            Origin { owner_exe: Some(r"C:\Program Files\Bitwarden\Bitwarden.exe".into()), ..Default::default() };
        assert!(password_class(plain, &owner));
        let front = Origin { foreground_exe: Some("KeePassXC.exe".into()), ..Default::default() };
        assert!(password_class(plain, &front));
        let bank =
            Origin { foreground_title: Some("Ziraat Bank Online - Google Chrome".into()), ..Default::default() };
        assert!(password_class(plain, &bank));
        let notepad = Origin { owner_exe: Some(r"C:\Windows\notepad.exe".into()), ..Default::default() };
        assert!(!password_class(plain, &notepad));
        // (c) the pattern
        assert!(password_class(SECRET_TEXTS[2], &notepad), "the GitHub token example");
    }

    #[test]
    fn manager_names_for_the_row() {
        assert_eq!(manager_name(r"C:\x\Bitwarden.exe"), Some("Bitwarden"));
        assert_eq!(manager_name("1Password.exe"), Some("1Password"));
        assert_eq!(manager_name("notepad.exe"), None);
        // Turkish letters on purpose: fold_tr must match Turkish text typed with or without diacritics.
        assert_eq!(fold_tr("İNTERNET ŞUBESİ"), "internet subesi");
    }
}
