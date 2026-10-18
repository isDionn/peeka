# Üçüncü taraf bildirimleri (Peeka)

Peeka'ya taşınan ya da uyarlanan dış kod burada, dosya başına bir satırla listelenir. Dosyanın kendi başında da kaynak ve lisans notu bulunur. Peeka'nın kendi lisansı MIT'dir (`LICENSE`).

## HeyyCzer/windows-dynamic-island (yalnız ilham)

Kaynak: https://github.com/HeyyCzer/windows-dynamic-island. Peeka HeyyCzer kodu içermez. Lisans temizliği (2026-10-17): uyarlanmış küçük dosyalar Peeka'nın kendi ifadesiyle yeniden yazıldı; dört büyük modül (`clip_image`, `clipboard`, iki `sysmon`) eski koda bakılmadan yalnız davranış şartnamesinden sıfırdan yazıldı ve `// Peeka — original implementation (MIT).` başlığını taşır. Aşağıdaki dosyalar başlıklarında "Inspired by HeyyCzer/windows-dynamic-island (ideas only; no code copied)" notunu taşır: yalnız fikir (davranış, ürün kararı) alındı, kod alınmadı.

| Peeka dosyası | Alınan fikir |
|---|---|
| `crates/notch-core/src/alerts.rs` | uyarı/etkinlik modeli ve öncelik sırası |
| `crates/notch-core/src/http_alerts.rs` | yerel uyarı API'sinin yolları ve JSON şekli |
| `crates/notch-core/src/sources.rs` | pil eşikleri, "başlangıçta bağlı olan duyurulmaz" |
| `crates/notch-core/src/media.rs` | çalma konumunu ileri hesaplama |
| `crates/notch-core/src/mirror.rs` | bildirim aynası davranışı |
| `crates/notch-core/src/clip/mod.rs` | yeniden kopyalanan öğenin üste çıkması |
| `crates/notch-win/src/media.rs` | SMTC oturum seçimi |
| `crates/notch-win/src/volume.rs` | değişince ses çubuğu |
| `crates/notch-win/src/bluetooth.rs` | Bluetooth aygıt izleme |
| `crates/notch-win/src/notifications.rs` | `UserNotificationListener` ile bildirim okuma |

Not (2026-10-17): `src-tauri/identity/AppxManifest.xml` ve `src-tauri/notch.manifest` dosyaları Microsoft'un standart manifest şemasını izler; yorumlarındaki HeyyCzer notu kaldırıldı, kod kopyası yoktur.

## Louis-CFM/coucou (MIT)

Kaynak: https://github.com/Louis-CFM/coucou (Windows sürümü `windows/` altında), commit `ff825663a959faf09310b571c6c8245d7e7cd1ee`, Copyright (c) 2026 Louis Raillé, MIT Lisansı. Sahip kararı 2026-10-16: CouCou analizindeki (docs/research/2026-10-16-coucou-analizi.md) 4, 5 ve 7. maddeler uyarlanabilir. MIT metni: izin verilir; yukarıdaki telif notu ve bu izin notu kopyalarda kalır; yazılım "OLDUĞU GİBİ", hiçbir garanti olmadan verilir.

| Peeka dosyası | Kaynak yolu (coucou) | Ne uyarlandı |
|---|---|---|
| `crates/notch-core/src/session_window.rs` | `windows/src-tauri/src/session_window.rs` | süreç ağacında yukarı yürüme: Windows ağaç tepeleri listesi, derinlik sınırı (16), döngü koruması, "pencere sahibi en yakın ata" kuralı, oturum kimliği denetimi |
| `crates/notch-win/src/session_window.rs` | `windows/src-tauri/src/platform/windows.rs` (`process_table`, `focus_process_window`) | Toolhelp32 süreç anlık görüntüsü; pencereyi öne getirme Peeka'nın kendi `Win32Control::focus`'u ile |
| `crates/notch-core/src/shortcuts.rs` (`altgr_vk`, `altgr_reason`) | `windows/src-tauri/src/shortcuts.rs` (`is_altgr_like`, `character_vk`, `typed_character`) | Ctrl+Alt'ın (Windows tuşu yokken) AltGr sayılması, yalnız harf ve rakam tuşlarının denenmesi |
| `crates/notch-win/src/keyboard.rs` | `windows/src-tauri/src/platform/windows.rs` (`ctrl_alt_types`) | kurulu klavye düzenlerinde `GetKeyboardLayoutList` + `MapVirtualKeyExW` + `ToUnicodeEx` (bayrak 0x4) ile "bu kombinasyon hangi karakteri yazıyor" sorusu, ölü tuşlar dahil |

## Louis-CFM/coucou (MIT)

Kaynak: https://github.com/Louis-CFM/coucou, Copyright © Louis-CFM, MIT lisansı (yalnız kod; Mochi karakteri, adı, sesleri ve çizimleri yazarın malıdır, kullanılmadı). Sahip kararı 2026-10-16. Kod kopyalanmadı; maskot motorunun (`windows/src/mochi/engine.ts`) davranış ilkeleri ve sayıları Peeka hayaletine uyarlandı (analiz: `docs/research/2026-10-16-coucou-mochi-analizi.md`).

| Peeka dosyası | Kaynak | Ne uyarlandı |
|---|---|---|
| `ui/src/mascot/ghost.ts`, `ui/src/mascot/motion.ts` | `windows/src/mochi/engine.ts` | `busy` kapısı (hareket yoksa çizim döngüsü durur), bakış (`tanh(dx/260)`, `tanh(dy/200)`, `1 − 0,0025^dt` yumuşatma), hata titremesi (+4, −4, +2,5, 0 / 50-70-70-90 ms), yutma ezilmesi, rozet geçişi (90 ms sil, 100 ms sonra 280 ms geri-yaylı), kademeli kıvılcım, tıklama sersemlemesi eşikleri (1,7 sn / 3 tıklama) |
