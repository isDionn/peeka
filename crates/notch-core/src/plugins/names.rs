//! Display names: two plugins can never share a name (case and accents ignored), the
//! reserved names are never given, and a name that only LOOKS like another one (confusable letters, a typo away)
//! raises the consent window's orange warning.

/// Names no plugin may take; the main assistant's name is checked on top of these.
pub const RESERVED: [&str; 5] = ["Notch", crate::PRODUCT_NAME, "Windows", "Sistem", "Microsoft"];

fn base(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'é' | 'è' | 'ê' | 'ë' | 'ē' => 'e',
        'ğ' => 'g',
        'ı' | 'í' | 'ì' | 'î' | 'ï' | 'ī' => 'i',
        'ñ' | 'ń' => 'n',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ø' | 'ō' => 'o',
        'ş' | 'ś' | 'š' => 's',
        'ú' | 'ù' | 'û' | 'ü' | 'ū' => 'u',
        'ý' | 'ÿ' => 'y',
        'ž' | 'ź' | 'ż' => 'z',
        c => c,
    }
}

/// Case-, accent- and spacing-insensitive form: "Pusula", "PUSULA", "Pusulâ" and " pu sula " are one name.
pub fn fold(name: &str) -> String {
    name.replace('İ', "i")
        .to_lowercase()
        .chars()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c)) // combining accents
        .map(base)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// `fold` plus letters that look alike: Cyrillic/Greek twins of Latin letters, digits for letters, rn for m.
/// shortcut: a small hand table (Latin, Turkish, Cyrillic, Greek), not Unicode's full confusables.txt; upgrade if a
/// plugin ever gets through with another script.
pub fn skeleton(name: &str) -> String {
    let mapped: String = fold(name)
        .chars()
        .map(|c| match c {
            'а' | 'α' => 'a',
            'в' | 'β' => 'b',
            'с' | 'ϲ' => 'c',
            'ԁ' => 'd',
            'е' | 'ε' | 'ё' | '3' => 'e',
            'һ' => 'h',
            'і' | 'ι' | 'ӏ' | 'l' | '1' | '|' | '!' => 'i',
            'ј' => 'j',
            'к' | 'κ' => 'k',
            'м' => 'm',
            'н' | 'η' => 'n',
            'о' | 'ο' | 'σ' | '0' => 'o',
            'р' | 'ρ' => 'p',
            'ѕ' | '5' | '$' => 's',
            'т' | 'τ' | '7' => 't',
            'υ' => 'u',
            'ν' => 'v',
            'ѡ' | 'ω' => 'w',
            'х' | 'χ' => 'x',
            'у' | 'γ' => 'y',
            c => c,
        })
        .collect();
    mapped.replace("rn", "m").replace("vv", "w")
}

/// Levenshtein distance on chars.
pub fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cur = row[j + 1];
            row[j + 1] = (prev + usize::from(ca != *cb)).min(row[j] + 1).min(cur + 1);
            prev = cur;
        }
    }
    row[b.len()]
}

/// Same name for the "never twice" rule.
pub fn same(a: &str, b: &str) -> bool {
    let (a, b) = (fold(a), fold(b));
    !a.is_empty() && a == b
}

/// Looks like `other`: same skeleton, or a typo or two away (one for short names).
pub fn looks_like(name: &str, other: &str) -> bool {
    let (a, b) = (skeleton(name), skeleton(other));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let allowed = if a.chars().count().min(b.chars().count()) <= 5 { 1 } else { 2 };
    a == b || distance(&a, &b) <= allowed
}

/// Refused at `hello`: the same as a reserved name or the main assistant's, or STARTING with Notch's or the main
/// assistant's name ("Pusula Asistanı", "Notch Güvenlik", "Pusula - Claude Code"): Notch draws "<name> › <title>", so
/// such a prefix reads as Notch's or the assistant's own card. Lookalikes stay the warning path (`looks_like`).
pub fn reserved(name: &str, main_name: Option<&str>) -> bool {
    let folded = fold(name);
    let prefix = |r: &str| {
        let r = fold(r);
        !r.is_empty() && folded.starts_with(&r)
    };
    RESERVED.iter().copied().chain(main_name).any(|r| same(name, r))
        || ["Notch", crate::PRODUCT_NAME].into_iter().chain(main_name).any(prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_ignores_case_accents_and_spacing() {
        assert!(same("Pusula", "PUSULA"));
        assert!(same("Pusulâ", " pu sula "));
        assert!(same("İzmir Asistanı", "izmir asistani"));
        assert!(!same("Pusula", "Pusula Pro"));
        assert!(!same("", ""), "an empty name is never 'the same'");
    }

    #[test]
    fn lookalikes_by_confusables_and_by_edit_distance() {
        assert!(looks_like("Рusulа", "Pusula"), "Cyrillic Р and а");
        assert!(looks_like("Pusu1a", "Pusula"), "digit one for l");
        assert!(looks_like("Pusulla", "Pusula"), "one typo");
        assert!(looks_like("Notch", "N0tch"));
        assert!(looks_like("Claude Code", "Claud Cod"), "two typos in a long name");
        assert!(!looks_like("Spotify Helper", "Pusula"));
        assert!(!looks_like("Pusula", "Kalem"));
    }

    #[test]
    fn reserved_names_and_the_main_assistant() {
        assert!(reserved("notch", None));
        assert!(reserved("Windows", None));
        assert!(reserved("SİSTEM", None));
        assert!(reserved("Pusula", Some("Pusula")));
        assert!(!reserved("Pusula", None));
        assert!(reserved("Pusula Asistanı", Some("Pusula")), "starts with the main assistant's name");
        assert!(reserved("Pusula - Claude Code", Some("Pusula")));
        assert!(reserved("Notch Güvenlik", None) && reserved("NOTCH-Uyarı", None));
        assert!(reserved("Peeka Pro", None) && reserved("Notch Pro", None));
        assert!(!reserved("Spotify Notch", None), "only a leading name counts");
        assert!(!reserved("Pusula Asistanı", None), "Pusula is reserved only as the main assistant");
        assert!(!reserved("Windows Yardımcısı", None), "Windows/Sistem/Microsoft: whole name only");
        assert_eq!(distance("kitten", "sitting"), 3);
    }
}
