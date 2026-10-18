# Peeka eklenti API'si (sözleşme, api = 1)

Bu belge Peeka eklenti API'sinin tek kaynağıdır. Uygulama `crates/notch-core/src/plugins/` ve `src-tauri/src/plugins.rs` içindedir. Kod adı `notch` (aşağıda `<kod>`); ürün adı yollarda ve boru adında geçmez.

## 1. Taşıma

- **Adlandırılmış boru üstünde JSON-RPC 2.0.** Boru adı: `\\.\pipe\<kod>-<kullanıcı SID>`.
- Boru yalnız bu kullanıcının SID'ine izin veren bir DACL ile yaratılır; `NT AUTHORITY\NETWORK` reddedilir, uzak istemciler reddedilir (`reject_remote_clients(true)`), ad gaspına karşı `first_pipe_instance(true)`: ad önceden alınmışsa Peeka açılmaz ve kullanıcıya "başka bir program bu adı tutuyor" der.
- Çerçeve: satır sonuyla ayrılmış JSON (NDJSON), UTF-8. Mesaj başına en çok **64 KB**; görsel taşıyan `card.module` için **256 KB**.
- Büyük ek (görsel, ekran görüntüsü) boru üstünden gitmez: Peeka dosyayı `%LOCALAPPDATA%\<kod>\paylasim\<rastgele>.png`'ye yazar, eklentiye yalnız yolu verir. Eklenti `share.done {id}` deyince ya da en geç 10 dakikada Peeka dosyayı siler. `paylasim\` dışında Peeka klasöründen eklentiye hiçbir dosya açılmaz.
- Dürüst sınır: aynı kullanıcı hesabındaki her program boruya bağlanabilir. Bağlanan sürecin kimliği güvenilir biçimde doğrulanamaz (`GetNamedPipeClientProcessId` sahtelenebilir). **Kimlik = onayda verilen eklenti jetonudur.** Süreç yolu onay penceresinde yalnız bilgi olarak, "doğrulanmadı" etiketiyle gösterilir.

## 2. Keşif

Peeka açıkken `%LOCALAPPDATA%\<kod>\endpoint.json` yazar, kapanınca siler:

```json
{"pipe": "\\\\.\\pipe\\notch-S-1-5-21-…", "api_version": 1, "pid": 1234}
```

Dosya yoksa Peeka kapalıdır; eklenti sessizce bekler ve 5 sn'den 60 sn'ye artan aralıkla yeniden dener.

## 3. El sıkışma

### 3.1 `hello` (ilk mesaj, jetonsuz)

```json
{"jsonrpc":"2.0","id":1,"method":"hello","params":{
  "id":"com.example.asistan","name":"Örnek Asistan","publisher":"Örnek","version":"1.2.0",
  "api":1,"scopes":["island.protrusion","card.module","composer.handler"],
  "why":{"composer.handler":"Ctrl+Space ile yazdığını bu asistana göndermek için"}}}
```

Doğrulama:
- `id`: ters alan adı biçiminde, en çok 64 karakter.
- `name`, `publisher`: düz metin; denetim ve çift yönlü karakterler atılır. `publisher` doğrulanmaz ve öyle gösterilir.
- `launch` (isteğe bağlı): eklentinin programının mutlak yolu, `X:\...d.exe`. Yalnız sahibin "<ad>'ı başlat" tıklamasıyla ve ancak eklenti ana asistanken açılır; her açılışta yeniden doğrulanır. Argüman, tırnak, UNC (`\sunucu\...`), joker karakter (`*`, `?`) ve `.exe` olmayan uzantı reddedilir; dosya yoksa düğme çalışmaz (`missing`).
- Bilinmeyen kapsam → istek reddedilir. Bilinmeyen alan → yok sayılır.
- Ad, eşleşmiş bir eklentinin adına ya da ayrılmış adlara ("Peeka", "Windows", "Sistem", ana asistanın adı) büyük/küçük harf ve aksan gözetmeden benziyorsa onay penceresinde uyarı çıkar; iki eklenti aynı görünen adı alamaz.

Jetonsuz `hello` → Peeka kendi çizdiği onay penceresini açar (§5). Onaylanırsa cevap tek seferlik jetonu taşır:

```json
{"jsonrpc":"2.0","id":1,"result":{"token":"<32 bayt, base64>","scopes":["island.protrusion","card.module"],"main_assistant":false}}
```

`scopes` sahibin gerçekten verdiği kapsamlardır (istenenin alt kümesi). Reddedilirse ya da 2 dakikada cevap gelmezse hata döner ve bağlantı kapanır.

### 3.2 `auth` (sonraki bağlantılar)

```json
{"jsonrpc":"2.0","id":1,"method":"auth","params":{"id":"com.example.asistan","token":"<jeton>"}}
```

- Peeka jetonun yalnız SHA-256 özetini, verilen kapsamları ve onay zamanını `plugins.json`'da tutar; karşılaştırma sabit zamanlıdır.
- Jetonu saklamak eklentinin işidir (kendi kullanıcı klasöründe).
- Eklenti yeni bir kapsam isterse (yeni sürüm) yeniden onay; eski kapsamlar korunur.

## 4. Kapsamlar

Düzey: **düşük** (onay penceresinde işaretli gelir), **orta** (işaretli gelir, ayrı satırda), **yüksek** (işaretsiz gelir, sahip tek tek işaretler, yanında uyarı yazısı).

| Kapsam | Düzey | Ne verir |
|---|---|---|
| `island.protrusion` | düşük | Ortada çıkıntı satırı (dikkat bütçesinden geçer, §7) |
| `card.module` | düşük | Modüller kartına en çok 3 sekme ve "Genel" sayfasına en çok 3 özet satırı |
| `alerts.post` | düşük | Kısa uyarı ve sürekli etkinlik |
| `notifications.post` | düşük | Bildirimler listesine kayıt |
| `search.provider` | orta | Ctrl+K'ye bir sonuç grubu; eklenti yazılan sorguyu görür |
| `composer.handler` | orta | Ctrl+Space kutusuna yazılanı ve sahibin eklediği ekleri alır, cevabı akıtır. Aynı anda tek sahip = **ana asistan** (sahip Ayarlar'dan seçer) |
| `voice.line` | orta | Şeridin altındaki çizginin hali (boşta / dinliyor / konuşuyor / düşünüyor) ve canlı döküm. Yalnız ana asistan. Mikrofon noktası bu kapsama değil Windows kaydına bağlıdır |
| `approvals.prompt` | orta | Onay çıkıntısı ve kartı (§6.3); cevap yalnız sahibin tıklamasıyla döner |
| `files.drop` | orta | Adaya bırakılan dosyaların yolları, yalnız bırakma anında |
| `lock.signal` | orta | Peeka'yı kilitler; kilidi açmak sahibin Peeka'daki onayına bağlı |
| `media.read` | orta | Çalan parça başlığı ve sanatçı |
| `windows.read` | yüksek | Açık pencerelerin başlıkları (hassas uygulamada başlık `null`) |
| `clipboard.read` | yüksek | Pano geçmişi: metin, görsel, dosya yolu. **Parola sınıfı öğeler hiçbir koşulda dönmez** |
| `notifications.read` | yüksek | Windows bildirim aynası (yalnız ayna açıkken; yoksa boş) |

**Hiçbir kapsamla verilmeyenler:** parola sınıfı pano öğeleri ve DPAPI deposu, eklenti jetonları ve başka eklentilerin verisi, klavye girişi (kanca yalnız ses tuşları ve kısayollar için; eklentiye tuş gitmez), ekran görüntüsü (yalnız sahibin tek seferlik paylaşımı), Peeka'nın ayarları ve izin listesi, komut/dosya/süreç çalıştırma. Eklenti Peeka'ya hiçbir şey çalıştırtamaz; Peeka'nın kendi eylemleri yalnız sahibin tıklamasıyla olur.

**Kapsam istemeyen tek seferlik paylaşımlar** (yalnız ana asistana, yalnız sahip tıklayınca): pano öğesinde "Asistana sor", ekran alıntısında "Asistana sor", bırakma hedefine dosya, Ctrl+Space çipleri ("Bu pencere" = görüntü + uygulama adı, başlık değil; "Panodaki …"; "Raftaki N dosya"; çipler öneri olarak görünür, tıklanınca eklenir), "Ekran görüntüsü ekle", "Dosya ekle", Windows bildirim kartında "Asistan yanıtlasın" (o tek bildirimin uygulama adı ve metni). Parola sınıfı öğede ve hassas uygulamanın penceresinde bu düğmeler yoktur.

## 5. Onay penceresi (Peeka çizer)

Eklentiden yalnız `name`, `publisher`, `version`, `id` ve `why` düz metin olarak alınır. Maket: `yon-3d-son.html` durumu `eo`. İçerik, yukarıdan aşağı:

1. Peeka'nın kendi simgesi ve "Yeni eklenti bağlanmak istiyor".
2. Peeka'nın çizdiği baş harf karosu, `name`, `version`, `id`; altında "Yayıncı: `publisher` · doğrulanmadı".
3. Bağlanan program: exe yolu ve imza durumu (`WinVerifyTrust`: "İmzalı: <imzalayan>" ya da "İmzasız"), "doğrulanmadı" etiketiyle.
4. Benzer ad uyarısı (turuncu satır): "Bu ad zaten bağlı bir eklentiye benziyor."
5. Kapsamlar düzeylerine göre üç grupta: onay kutusu, sade Türkçe açıklama, eklentinin `why` metni tırnakta. Düşük/orta işaretli, yüksek işaretsiz. `composer.handler` ve `voice.line` için ek satır: "Ana asistan yapılsın mı?" (işaretsiz). `approvals.prompt` satırında: risk düzeyini eklentinin söylediği, Peeka'nın doğrulayamadığı.
6. "Hiçbir eklenti parolalarını, klavye girişini, Peeka ayarlarını göremez ve bilgisayarında komut çalıştıramaz."
7. "Bu eklenti kendi internet bağlantısını kullanabilir; Peeka bunu denetleyemez."
8. "Reddet" (varsayılan odak, Esc), "İzin ver" (açılıştan sonraki ~300 ms tıklamayı yok sayar; Enter ilk odakta değildir), küçük "Bu eklentiyi bir daha sorma".
9. 2 dakikada cevap yoksa "Reddet". Ana ekranda şeridin altında ortada açılır; tam ekranda açılmaz, eklenti bekler.

Sağanağa karşı: aynı anda tek onay penceresi; aynı `id` ya da süreç yolu için 10 dakikada en çok 3 istek; "bir daha sorma" kara listeye yazar.

Geri alma: Ayarlar › Eklentiler (ad, son bağlantı, kapsamlar tek tek kapatılır, son 24 saatin kapsam kullanım **sayıları**, "Bağlantıyı kes", "Kaldır"). Kaldır özeti siler ve açık bağlantıyı hemen kapatır; kapsam daraltma bağlantıyı yeniden başlatır.

## 6. Şemalar (eklenti veri gönderir, Peeka çizer)

Eklenti HTML, CSS ya da JS gönderemez; metin her yerde metin olarak çizilir.

**Kimlik kuralları (her şemada):** Peeka her çıkıntının, kartın, onayın ve sekmenin başına eklentinin görünen adını kendisi basar ("Örnek Asistan › …"); `title` ya da `source` bu öneki değiştiremez, başlıktaki `›` ve benzeri ayraçlar düz karaktere çevrilir. `mascot` alanı yalnız ana asistandan kabul edilir, başkasınınki yok sayılır. Simge yalnız Peeka'nın Lucide kümesinden ad ya da tek karakterdir; görsel simge gönderilemez.

### 6.1 `island.protrusion`

```json
{"title":"…","subtitle":"…","icon":"bell","state":"idle|info|attention|done|danger|tired",
 "progress":0.4,"timer":{"started_at":"2026-10-16T14:32:00Z"},"live_text":{"stream_id":"s1"},
 "transcript":{"stream_id":"v1"},"note":"taslak hazır",
 "mascot":"dinliyor","actions":[{"id":"a1","label":"Aç","style":"default|primary|destructive"}]}
```

`subtitle`, `progress`, `timer`, `live_text`, `transcript`, `note`, `mascot` isteğe bağlı; `actions` en çok 2. `transcript` (Sadakat 3) iki satırlı canlı döküm açar: şekli `live_text` gibidir (`{stream_id}`), metin ve konuşan (`speaker`) `voice.transcript` akışıyla gelir; sayfaya `transcript: {streamId: "<eklenti id>:<stream_id>"}` gider. `note` başlığın yanındaki soluk kısa not, en çok 40 karakter düz metin (sayı ya da nesne gelirse `-32602`). `icon` olarak `yorgun` ve `dikkat` (asistanın yüzü) yalnız ana asistandan kabul edilir, başkasından `-32602`. Renk serbest değildir: yalnız `state` ve `style` (primary #0A84FF dolu, destructive #FF453A dolu). `timer`'ı Peeka sayar.

### 6.2 `card.module`

Blok listesi: `heading`, `text` (düz metin; satır içi kalın ve kod dışında biçim yok), `list` (satır: başlık, alt satır, sağ değer, durum), `kv`, `progress`, `timer`, `buttons` (stil 6.1'deki gibi), `image` (yalnız PNG/JPEG `data:`, en çok 256 KB, Peeka yeniden kodlar; bu sürümde henüz değil, §13). Bağlantı yoktur: düğme eklentiye `action {id}` olarak döner. Bütün düğmelere ~300 ms tıklama koruması uygulanır. Onay isteyen içerik `approvals.prompt` ile gelir. Eklenti başına en çok 3 sekme; "Genel" sayfasına `summary` en çok 3 satır.

Sadakat 3 ekleri (hepsi isteğe bağlı, yanlış türde gelirse `-32602`):

- Sekme `genel: true` → sekme "Genel" sayfasına da kutu olarak girer. Sekme `icon`'u Peeka simgelerine ek olarak `ghost`, `terminal`, `users`, `pointer`, `brain`, `list`, `shield` olabilir.
- `summary` satırı `{title, subtitle?, value?, icon?, state?, action?}`: `icon` yalnız `ghost|terminal|users|pointer|brain|list|shield`, `state` yalnız `idle|info|attention|done|danger|tired`, `action` tek düğme `{id, label, style?}` (bkz. 6.1). Bu düğmeye basılınca eklentiye `action {id, surface: "module"}` gider (`tab` yok).
- `meter` bloğu (kota çubuğu): `{"type":"meter","label":"5 saatlik","value":42,"reset_note":"14:30'da sıfırlanır","threshold":80}`. `value` ve `threshold` 0..100 sayı (dışı kırpılır, sayı değilse `-32602`), `label` ≤ 80, `reset_note` ≤ 80 karakter. Sayfaya `{type: "meter", label, value: 0..1, note, mark: 0..1 | null}` gider.
- **Bilinmeyen blok türü** artık kartı düşürmez: yalnız o blok atılır, kart kalır ve Peeka günlüğüne yalnız sayısı yazılır ("N bilinmeyen blok atlandı"; içerik asla; bağlantı başına dakikada en çok bir günlük satırı). Bilinen bir türün alanları bozuksa mesaj yine `-32602` ile reddedilir.

### 6.3 `approvals.prompt`

```json
{"id":"ap-123","source":"Claude Code","title":"Komut çalıştırmak istiyor",
 "risk":"high","kind":"command","command":"rm -rf build","cwd":"C:\\proje",
 "detail":"…","options":["allow","always","deny"],"always_label":"Bu klasörde npm test",
 "choices":null,"free_text":false,"expires_s":300}
```

- `risk`: `low` | `high`. Eksik ya da tanınmayan = `high`. `high` iken çıkıntıda "İzin ver" yoktur, yalnız "Ayrıntı"; "Her zaman izin ver" Peeka tarafından kaldırılır. Risk eklentinin beyanıdır, Peeka doğrulayamaz.
- `kind`: `command` | `file` | `network` | `question` | `plan` | `other`. `command` için `command` ve `cwd` zorunlu (kod kutusunda düz metin); `file` için `path` zorunlu.
- `options`: `allow`, `always`, `deny` alt kümesi; `always` varsa `always_label` zorunlu.
- `choices`: en çok 6 `{id, label, recommended?}`; `recommended: true` olan seçenek kartta önceden seçili ve "önerilen" etiketlidir (true/false değilse `-32602`). `free_text: true` ise yazı kutusu (en çok 2 000 karakter, düz metin). Ana asistan dışındaki bir eklentinin yazı kutusunda Peeka onay görünümüne `freeTextWarning: true` koyar; kart kutunun üstünde "Bu soru <eklenti adı> eklentisinden; buraya şifre yazma" uyarısını gösterir (eklenti bunu kapatamaz).
- `short_title`: çıkıntıdaki kısa başlık, en çok 24 karakter düz metin (fazlası kırpılır; metin değilse `-32602`). Sayfaya `shortTitle` olarak gider.
- `expires_s`: en çok 3 600; dolunca Peeka kartı kapatır ve eklentiye `expired` döner.
- Cevap (yalnız sahibin tıklaması ya da yazmasıyla): `{"id":"ap-123","decision":"allow|always|deny|choice","choice_id":"…","text":"…"}`.
- Kazara tıklama koruması (~300 ms; riskli komutta çıkıntıda yalnız "Ayrıntı") eklentiden bağımsızdır, Modüller'de de geçerlidir.

### 6.4 `composer.handler` akışı

- Peeka → eklenti: `composer.submit {turn, text, attachments: [{kind: screenshot|file|clip|window_image|rack, path?, text?}]}` (ekler yalnız tek seferlik paylaşımdan; görseller paylaşım klasöründe yol olarak; küçük metin dosyasında yolun yanında `text` de gelir, bkz. §13 "Ekler").
- Eklenti → Peeka: `composer.delta {turn, text}` (akan cevap), `composer.chip {turn, label, kind: source|reminder|note}`, `composer.done {turn}`, `composer.error {turn, message}`.
- Balonları ve çipleri Peeka çizer. "Sesle sor" düğmesi yalnız ana asistan `voice.line`'a da sahipse görünür.

## 7. Hız sınırı ve dikkat

- Bağlantı başına **10 sn'de 50 denetim mesajı**; aşınca hata `-32005` ve `retry_after` (sn).
- **Akış mesajları ayrı sayılır** (`composer.delta`, `voice.line` canlı dökümü, `live_text`): Peeka akış kimliği başına 50 ms'de bir birleştirerek çizer; saniyede en çok 40 akış mesajı kabul edilir, fazlası birleştirilir (düşürülmez); akış başına toplam 64 KB'de kesilir.
- Çıkıntı açma isteği **dakikada en çok 6**; aynı anda en çok 1 eklenti çıkıntısı. Peeka'nın dikkat bütçesi (rahatsız etme, tam ekran, toplantı) eklenti önceliğinden önce gelir.
- Eklenti önceliği **0–69**; 70 ve üstü yalnız Peeka'nın kendi sistem uyarıları ve `approvals.prompt` içindir.
- Reddedilen istekler dakikada en çok bir günlük satırı bırakır.

## 8. Günlük ve gizlilik

Günlüğe yalnız eklenti kimliği, yöntem adı ve sonuç kodu yazılır; mesaj içeriği, pano metni, pencere başlığı ve sorgu yazılmaz. Peeka güncelleme denetimi dışında (kapatılabilir) ağ isteği atmaz; eklentinin kendi ağ kullanımı eklentinin sorumluluğudur.

**Peeka'nın yerel kaynakları eklentiye gitmez.** Aşağıdakiler yalnız Peeka'nın kendi sayfalarına olay olur; hiçbiri bir eklentiye iletilmez, hiçbir eklenti bunları okuyamaz:

- **İndirme bitti (`download_done`, gizlilik yüzeyi).** Peeka, kullanıcının İndirilenler klasörünü (Windows'un bilinen klasör API'siyle bulunur) birkaç saniyede bir listeler. Okunan şey yalnız dosya adı ve boyutudur; hiçbir dosyanın içi açılmaz. Yeni bir dosya, boyutu iki bakışta aynı kalınca (ve `.crdownload`, `.part`, `.tmp` gibi yarım dosyalar sayılmadan) `{id, name, size}` olarak bildirilir; yol hiçbir olayda yoktur, klasör yolu Rust'ta kalır. Ayar `watchDownloads` (varsayılan açık, Ayarlar'dan kapatılır); kapalıyken liste okunmaz. Peeka kilitliyken bildirim gelmez ve `download_open` / `download_show_in_folder` `denied` döner. Çalıştırılabilir dosyalar (`.exe`, `.bat`, `.ps1`, `.lnk` ...) "Aç" ile başlatılmaz.

## 9. Uyumluluk: basit uyarı HTTP'si (varsayılan kapalı)

Yerel uyarı API'sinin yolları (`/notify`, `/activity`, `/activity/{id}`, `/status`): yalnız `127.0.0.1`, Host denetimi, her `Origin` reddi, `X-Notch-Key` anahtarı (dosyası Peeka veri klasöründe), 10 sn'de 30 istek, 4 KB, yalnız JSON. İçeride yalnız `alerts.post` kapsamlı, adı "Betikler" olan bir eklenti gibi davranır.

## 10. Sürümleme ve SDK

- `api` bir tamsayıdır; aynı sürümde yalnız ekleme yapılır (yeni alan, yeni yöntem). Kırıcı değişiklik = yeni `api` sayısı.
- Python ve Node için küçük istemci örnekleri `sdk/` altındadır (MIT).

## 11. Yöntemler

Bütün mesajlar JSON-RPC 2.0. `id` taşıyan istek cevap alır; `id`siz bildirim hiç cevap almaz (hata da). `id` sayı ya da metin olmalı.

**Eklenti → Peeka** (soldaki kapsam her çağrıda o anki kayda göre denetlenir: sahip kapsamı kapatınca ya da eklentiyi kaldırınca bir sonraki mesajda geçerli olur):

| Yöntem | Kapsam | Parametreler | Sonuç |
|---|---|---|---|
| `hello` | — | §3.1 manifesti | onaylanınca `{token, scopes, main_assistant}` |
| `auth` | — | `{id, token}` | `{scopes, main_assistant, api_version}` |
| `ping` | — | — | `{pong: true}` |
| `share.done` | — | `{id}` (32 onaltılık) | `{ok}` |
| `island.protrusion.set` | `island.protrusion` | §6.1 nesnesi | `{ok}`; aynı eklentinin önceki çıkıntısının yerini alır |
| `island.protrusion.clear` | `island.protrusion` | — | `{ok}` |
| `live_text.append` | `island.protrusion` | `{stream_id, text, final?}` | akış (§7); `final: true` akışı bitirir |
| `card.module.set` | `card.module` | `{tabs: [{id, title, icon?, genel?, blocks}], summary?: [metin ya da {title, subtitle?, value?, icon?, state?, action?}]}` | `{ok}`; öncekinin yerini alır; bilinmeyen blok yalnız kendisi atılır (§6.2) |
| `card.module.clear` | `card.module` | — | `{ok}` |
| `alerts.post` | `alerts.post` | §9'daki `/notify` gövdesi + `id` zorunlu + `notify?` (öntanım `true`; `false` = süren iş) | `{ok}`; `action` ve `color` gönderilirse reddedilir |
| `alerts.remove` | `alerts.post` | `{id}` | `{ok}` |
| `approvals.prompt` | `approvals.prompt` | §6.3 nesnesi | `{ok}`; karar sonra `approvals.decision` bildirimiyle gelir |
| `approvals.cancel` | `approvals.prompt` | `{id}` | `{ok}` (ör. iş terminalde yanıtlandı) |
| `composer.delta` | `composer.handler`, yalnız ana asistan | `{turn, text}` | akış (§7) |
| `composer.chip` / `composer.done` / `composer.error` | aynı | §6.4 | `{ok}`; `done`/`error` turu kapatır, bekleyen metni önce boşaltır |
| `voice.line` | `voice.line`, yalnız ana asistan | `{state: idle\|listening\|speaking\|thinking}` | `{ok}` |
| `voice.transcript` | aynı | `{stream_id, text, final?, speaker?}` | akış (§7) |
| `lock.signal` | `lock.signal` | `{locked: true}` | `{ok}`; `false` reddedilir (kilidi sahip açar) |
| `clipboard.read` | `clipboard.read` | — | `{items: [{kind, text?, path?}]}` (Peeka'nın pano geçmişi, en yeni önce; `kind` `text` / `image` / `file`; görselde yol yok); parola sınıfı öğe ve `password` alanı hiçbir zaman dönmez. Peeka kilitliyken `{items: [], locked: true}` |
| `search.results` | `search.provider` | `{request, group?, items: [{id, title, subtitle?}]}` (en çok 8 satır; `group` ≤ 40 karakter, ör. "Notlar") | `{ok}`; eski bir `request`in cevabı sessizce düşer (`{ok: false}`). Peeka sorgudan sonra ~250 ms bekler, geç gelen o aramayı kaçırır |
| `media.read`, `windows.read`, `notifications.post`, `notifications.read` | adlarındaki kapsam | — | kapsam denetlenir, sonra `-32601` "kaynağı henüz yok" |
| `assistant.counts.set` | `card.module`, yalnız ana asistan | `{jobs, memory, approvals?}` (sıfır ya da pozitif tam sayı, 9 999'da kırpılır; `approvals` yoksa 0) | `{ok}`; durum kartındaki iş, not ve "Onay bekliyor" sayısı (Sadakat 3) |
| `calendar.set` | `card.module`, yalnız ana asistan | `{detail?, next: [{time, title, source?, start?, link?}]}` (en çok 5 satır; `time` ≤ 16, `title` ≤ 120, `source` ≤ 40 karakter, düz metin; `start` ISO zaman + saat farkı, hatırlatma ona göre sayar; `link` yalnız teams.microsoft.com, zoom.us, meet.google.com üstünde https, başkası düşer) | `{ok}`; toplantı kartının ayrıntısı ve sıradakiler |
| `claude.bridge.set` | `card.module`, yalnız ana asistan | `{installed, healthy, last_event_ago_s?}` | `{ok}`; Ayarlar'daki "Claude Code köprüsü" satırı. Peeka saniyeyi kendisi yaşlandırır; Claude Code dosyalarını Peeka hiç okumaz |
| `cc.sessions.set` | `card.module`, yalnız ana asistan | `{sessions: [{id, pid}]}` (en çok 32; `id` Claude Code oturum kimliği: harf, rakam, `-`, `_`, ≤ 128; `pid` oturumun `claude` sürecinin kimliği, 4'ten büyük tam sayı) | `{ok}`; öncekinin yerini alır. "Terminali aç" yalnız bu listedeki pid'i kullanır: Peeka süreç ağacında o pid'den yukarı çıkıp pencere sahibi ilk atayı (Windows Terminal, VS Code, conhost…) öne getirir. Ana asistan listeyi her oturum değişiminde yeniden göndermeli (biten oturumun pid'i başka bir sürece verilebilir) |
| `cc.event` | `island.protrusion`, yalnız ana asistan | `{kind, tool?, reason?, sid?}`; `sid` (isteğe bağlı): oturum etiketi, tam 8 küçük onaltılık karakter (başkası `-32602`); Claude Code oturum kimliğinin tuzlu özetidir, kimliğin kendisi değildir. Sayfa "2 oturum" çipinde oturumları "Oturum 1", "Oturum 2" diye son araçlarıyla ayırır; bir `sid` 30 dakika olaysız kalırsa listeden düşer, `session_end` hemen siler; `kind`: `session_start`, `session_end`, `prompt`, `pre_tool`, `post_tool`, `tool_failed`, `notification`, `permission`, `stop`, `stop_failure`, `subagent_start`, `subagent_stop` (Claude Code kanca olayları; başka değer `-32602`). `tool` araç adı, `reason` hata ya da bildirim sınıfı (`rate_limit`, `permission_prompt`, `elicitation_dialog`, `idle_prompt`…): yalnız harf, rakam, `_ . : -`, en çok 64 karakter; serbest metin, komut, yol, istem hiçbir zaman gönderilmez | `{ok}`; sayfaya `cc_event`. Maskot sakin haldeyken: `prompt`/araç = düşünüyor, `pre_tool` arama araçları (WebSearch, WebFetch, Grep, Glob, adında `search` geçen) = arıyor, `AskUserQuestion` ve `elicitation_dialog` = soru, `permission` ve `permission_prompt` = onay, `tool_failed` ve `stop_failure` = hata, `stop_failure` + `rate_limit` = kota doldu, `stop` = bitti (5 sn sonra sakin), `session_end` = sakin. Kanca susarsa hal 2 dakikada düşer. Ana asistanın kendi onayı, işi ve hatası her zaman önde kalır. Ana asistansız Peeka aynı olayları kendi kancasından da alır (§13 "Claude Code köprüsü"); ana asistan son 2 dakikada `cc.event` gönderdiyse Peeka'nın kendi kancası yok sayılır |
| `assistant.offline` | `island.protrusion`, yalnız ana asistan | `{on}` | `{ok}`; değişince sayfaya `assistant_offline`; bağlantı kopunca `false` olur |
| `meeting.set` | `island.protrusion`, yalnız ana asistan | `{active}` (bool; başka tür `-32602`) | `{ok}`; değişince sayfaya `meeting_changed`; toplantı sürerken dikkat bütçesi sessizdir (§0i: onay dışı uyarılar ve eklenti çıkıntısı adayı açmaz, yalnız listede ve sayıda bekler; maskot muziplik yapmaz); bağlantı kopunca, başka eklenti ana asistan olunca ya da sahip `island.protrusion` kapsamını kapatınca `false` olur |
| `job.done` | `island.protrusion`, yalnız ana asistan | `{title, took?, seconds?}` (≤ 120 / ≤ 40 karakter; `seconds` sıfır ya da pozitif sayı, kesirli olabilir, Peeka aşağı yuvarlar; sayfanın 2 dakika kuralı için) | `{ok}`; sahip "İş bitince kutlama"yı açık tuttuysa sayfaya `job_done` (maskot zıplar; saatte en çok 3'ü sayfa sayar) |
| `shelf.suggestion` | `files.drop`, yalnız ana asistan | `{request, text?}` (≤ 300 karakter; `text` yok = öneri yok) | `{ok}`; yalnız açık `shelf.suggest` isteğine; eskisi ya da ikinci cevap `{ok: false}` ile düşer. Peeka 3 sn bekler |

**Peeka → eklenti** (bildirim, cevap beklenmez):

| Yöntem | Ne zaman | Parametreler |
|---|---|---|
| `composer.submit` | sahip Ctrl+Space kutusunu gönderdi (yalnız ana asistana) | `{turn, text, attachments: [{kind, path, text?}\|{kind: "clip", text}]}` |
| `approvals.decision` | sahip karar verdi ya da süre doldu | `{id, decision: allow\|always\|deny\|choice\|expired, choice_id?, text?}` |
| `action` | sahip eklentinin bir düğmesine bastı | `{id, surface: protrusion\|module, tab?}` |
| `voice.request` | sahip Ctrl+Space kutusunda "Sesle sor"a bastı (ana asistan `voice.line`'a da sahipse) | `{}` |
| `search.query` | sahip Ctrl+K'ye yazdı (`search.provider` kapsamı açık her bağlı eklentiye; Peeka kilitliyken hiç gönderilmez, o sırada gelen `search.results` düşer) | `{request, query}` |
| `search.open` | sahip o eklentinin bir arama satırını açtı | `{id}` |
| `assistant.open` | sahip durum kartında "Aç"a bastı (yalnız ana asistana) | `{kind: approval\|jobs\|memory}` |
| `shelf.suggest` | raf kartı bir dosyayı gösteriyor; yalnız ana asistan `files.drop`'a sahipse (yoksa hiç gitmez) | `{request, path}` (`path` = paylaşım klasöründeki kopya, aşağıya bkz.) |
| `shelf.memory` | sahip raf önerisinde "Notlara ekle"ye bastı (tek seferlik paylaşım) | `{path}` (aynı) |

**Raf dosyası yolu (Sadakat 3):** `shelf.suggest`, `shelf.memory`, raf kartındaki "Asistana sor" (`shelf_ask`, `rack` eki) ve Ctrl+Space'in `shelf` eki raftaki asıl dosyanın yolunu değil, Peeka'nın o dosyayı kopyaladığı tek seferlik paylaşım klasöründeki kopyanın yolunu gönderir (`%LOCALAPPDATA%\<kod>\paylasim\<32 onaltılık>.<uzantı>`; ana asistanın okuma kuralı yalnız bu klasörü açmalıdır). Kopya en geç 10 dakikada silinir (ya da `share.done {id}` ile). Klasör, 50 MB'tan büyük dosya ve parola sınıfı dosya kopyalanmaz, eklentiye hiçbir şey gitmez: adı parola/anahtar dosyasına benzeyen (`.kdbx`, `.pem`, `id_rsa`, `.env`, `credentials`, banka adları…; panonun pencere başlığı kalıbı) ya da metin dosyasıysa içinde gizli bilgi kalıbı (API anahtarı, IBAN, kart no…) geçen dosya. Sayfa bu durumda `denied` (parola) ya da `invalid` (klasör, boyut) alır. Raftaki dosyalardan biri bile kopyalanamazsa o mesaj hiç gitmez. Kopya ancak mesaj gidecekse yapılır: önce ana asistanın bağlı olduğu (`shelf.suggest` için ayrıca `files.drop`'u tuttuğu) denetlenir, değilse hiçbir şey kopyalanmaz (sayfa `not_connected` alır, `shelf.suggest` sessizce sorulmaz).

## 12. Hata kodları

| Kod | Anlam | Bağlantı |
|---|---|---|
| `-32700` | JSON değil | açık kalır |
| `-32600` | JSON-RPC 2.0 isteği değil; ya da bağlıyken yeniden `hello`/`auth` | açık |
| `-32601` | böyle yöntem yok / kaynağı henüz yok | açık |
| `-32602` | geçersiz parametre: bilinmeyen kapsam, ayrılmış ya da başkasının adı, HTML/bağlantı/simge alanı, şema hatası (`message` hangi alan olduğunu söyler) | `hello`'da kapanır, sonra açık |
| `-32001` | `hello`/`auth` öncesi mesaj, yanlış jeton, kaldırılmış eklenti | kapanır |
| `-32003` | kapsam verilmemiş ya da sahip kapatmış | açık |
| `-32004` | 64 KB'yi aşan mesaj (`card.module.set` dışında) | açık; 256 KB'yi aşan satır bağlantıyı kapatır |
| `-32005` | hız sınırı, `data.retry_after` (sn); eşleşme sağanağı (10 dk'da aynı kimlik ya da exe için 3, bütün eklentiler için 6) da bu kodla | eşleşmede kapanır, sonra açık |
| `-32006` | sahip reddetti, 2 dk doldu ya da "bir daha sorma" listesinde | kapanır |
| `-32007` | başka bir onay penceresi açık / bu bağlantının onayı bekleniyor, `data.retry_after` 30; ya da en çok 20 bekleyen onay / 20 uyarı | `hello`'da kapanır |
| `-32008` | yalnız ana asistanın yapabileceği bir şey | açık |

## 13. Netleştirmeler

- **Boru:** DACL SDDL'i `D:P(D;;GA;;;NU)(A;;GA;;;<kullanıcı SID>)`: korumalı (devralma yok), önce NETWORK reddi, tek izin bu kullanıcı. Aynı anda en çok 16 bağlantı. Bir eklentinin okumadığı 256 satır birikirse bağlantısı kesilir.
- **Bağlantı başına bir eklenti:** aynı eklenti ikinci kez `auth` ederse eski bağlantı kapanır.
- **Aynı `id` ile yeniden `hello`** (jeton kaybolduysa): yeni onay penceresi açılır, eski kapsamlar işaretli gelir; "İzin ver" eski jetonu geçersiz kılar. Ad her zaman yeniden denetlenir.
- **Ad kuralları:** büyük/küçük harf, aksan ve boşluk farkı gözetmeden başka bir eklentinin adıyla ya da ayrılmış adlarla ("Peeka", "Notch", "Windows", "Sistem", "Microsoft", ana asistanın adı) aynı olan ad, ayrıca "Peeka", "Peeka" ya da ana asistanın adıyla **başlayan** ad ("Örnek Asistan Pro", "Peeka Güvenlik", "Örnek Asistan - Claude Code") `hello`'da reddedilir (pencere açılmaz). Ad ve yayıncıdaki ayırıcılar (`›`, `»`, `>`, `<`, `/`, `|`, `‣`, `→` ve benzerleri) `-` olur, etiketler silinir: eklenti Peeka'nın "<ad> › <başlık>" satırını taklit edemez. Bu kural eşleşmede (`hello`) uygulanır; daha önce eşleşmiş bir kaydın adı yeniden eşleşene kadar olduğu gibi kalır. Yalnız **benzeyen** ad (Kiril/Yunan ikiz harfler, rakamla harf, `rn`/`m`, kısa adda 1, uzun adda 2 harf farkı) pencerede uyarı çıkarır. Benzer harf tablosu küçük bir el tablosudur, Unicode'un tam listesi değil.
- **Ekler ve Claude Code (ana asistanın yapması gereken):** Ana asistanın okuma kuralı yalnız `paylasim\` alt klasörünü açar, ama Claude Code'un kendi izin kuralları Peeka klasörünün tamamını kapalı tutar. Yani ana asistan bir `file`/`rack` ekini modele yalnız yol olarak verirse model o dosyayı **okuyamaz**. Peeka bu yüzden küçük metin kopyasını `text` olarak da gönderir. Ana asistan: (1) `text` varsa onu kullanır; (2) yoksa dosyayı kendisi okur (paylaşım klasörü içinde mi diye denetleyerek) ve küçük metinse içeriği, görselse görsel eki olarak modele verir, büyük ya da ikili dosyada "okunamadı" der, sessizce düşürmez; (3) `clip` ekinde `path` de varsa (32 KB üstü metin) `text` yalnız baş kısımdır, tam metin yoldadır; (4) kullandığı her paylaşımı `share.done {id}` ile bırakır.
- **"Bir daha sorma"** kimliği kara listeye yazar; o kimlik pencere açılmadan `-32006` alır. Ayarlar › Eklentiler'de "Kaldır" kara listeden de çıkarır.
- **Onay süresi:** 2 dakika, pencere sayfası isteği **ilk gösterdiği** andan sayılır; ~300 ms koruma da o andan. Pencere hiç açılamadıysa (tam ekran) eklenti en çok 10 dakika bekler, sonra `-32006`.
- **Ana asistan** yalnız sahibin seçimidir (onay penceresindeki işaret ya da Ayarlar); `hello` bunu isteyemez. Ana asistan olmak etkin bir `composer.handler` ister; tek ana asistan vardır, yenisi seçilince eskinin açık turları kapanır.
- **Varsayılan kutular:** sahip kutulara hiç dokunmadan "İzin ver" derse yüksek düzeyli kapsamlar verilmez. Hiçbir kapsam işaretli değilse "İzin ver" "Reddet" sayılır.
- **Kimlik öneki:** Peeka her öğeye `plugin: {id, name, main}` alanını kendi kaydından koyar (yükteki `plugin` alanı yok sayılır); sayfa "`name` › `title`" çizer. Başlık ve `source`'taki `›` `‹` `»` `«` `❯` `❮` `⟩` `⟨` `〉` `〈` düz `-` olur, `<etiket>`ler atılır (kod kutusundaki `command`, `cwd`, `path` hariç: orada `echo <x>` gerçektir).
- **Yasak alanlar:** `html`, `href`, `url`, `link`, `links`, `src`, `svg`, `css`, `script`, `iframe`, `icon_url`, `iconUrl`, `image_url`, `imageUrl` herhangi bir derinlikte varsa mesaj `-32602` ile reddedilir. `icon` yalnız Peeka'nın simge adı (`ticket` ve `video` dahil) ya da tek karakterdir; başka değer (`https://…`, `data:…`, `<svg>`) mesajı reddettirir.
- **Maskot hâlleri:** `bosta`, `dinliyor`, `konusuyor`, `dusunuyor`, `mutlu`, `yorgun`, `saskin`, `dikkat`. Ana asistan olmayanın `mascot` alanı reddedilmez, sessizce atılır; tanınmayan hâl de atılır. **Yüz simgeleri:** `yorgun` ve `dikkat` `icon` olarak da kullanılabilir (sayfa onları asistanın yüzüyle çizer), ama yalnız ana asistanın çıkıntısında ve `alerts.post` uyarısında; başka eklentiden `-32602`. HTTP uyarı kapısı (§9) bu adları hiç kabul etmez (simge atılır).
- **`card.module` sınırları:** sekme başına en çok 40 blok, `list`/`kv` en çok 50 satır, `buttons` en çok 4 düğme. `list` satırı `{title, subtitle?, value?, state?, session?}` (özet satırı da `session?` alır: Claude Code oturum kimliği, `cc.sessions.set` ile aynı kural; sayfa o satıra "Terminali aç" koyar), `kv` satırı `{key, value}`, `image` `{data}`, `timer` `{started_at, label?}`. Görsel yalnız PNG/JPEG `data:` URL'si, çözülünce en çok 256 KB ve dosya imzası (magic bytes) doğru olmalı. **Bu sürümde Peeka görseli yeniden kodlamaz** (görüntü kitaplığı sonraki sürüme kaldı).
- **`approvals.prompt`:** `options` yoksa `["allow", "deny"]`. `expires_s` öntanım 300, en az 10, en çok 3 600 (taşan kırpılır). Yüksek riskte `always` ve `always_label` Peeka tarafından atılır. Eklenti başına en çok 20 bekleyen onay. Onay Peeka'nın uyarı listesine 90 öncelikli "onay" türünde girer: rahatsız etmeyi geçer, tam ekranda şeridi 4 sn indirir, özel tam ekran DirectX oyununda indirmez, yalnız sayıda bekler (Dalga 2'nin dikkat bütçesi). Sahip çıkıntıdan karar veremez (yüksek riskte), "Her zaman" yalnız karttan seçilir; "Reddet" her zaman geçerlidir.
- **Düğme koruması:** çıkıntı ve Modüller düğmelerinde ~300 ms, öğenin **son değiştiği** andan sayılır (eklenti düğmenin altını değiştirdiyse ilk tıklama yok sayılır).
- **`alerts.post`:** eklenti uyarısında bağlantı (`action`) ve serbest renk (`color`) yoktur; başlığa Peeka "`ad` › " öneki koyar, öncelik 0–69'a kırpılır, eklenti başına en çok 20 kimlik. Eklenti bağlantısı koptuğunda ya da kaldırıldığında uyarıları, çıkıntısı, kartı ve onayları kalkar.
- **Akış:** `composer.delta`, `voice.transcript`, `live_text.append` denetim sayacına girmez; saniyede 40'tan fazlası da reddedilmez, aynı 50 ms'lik parçaya katılır. Akış başına toplam 64 KB'den sonrası atılır ve sayfaya bir kez `truncated: true` gider. Akan metinde boşluk ve satır sonu korunur, `<…>` atılmaz (cevap kod olabilir; sayfa metin olarak çizer). Sayfadaki akış kimliği `"<eklenti id>:<stream_id>"`.
- **`composer.submit` ekleri:** yol tam bir Windows yolu olmalı (`C:\…` ya da `\\…`), en çok 10 ek, yolsuz metinli ek yalnız `clip` (en çok 256 KB). Uzun pano metni (256 KB üstü) `clip` olarak hem tam metnin `path`'iyle hem de ilk ~256 KB'si "[Metin 256 KB'de kesildi; tamamı ekli dosyada.]" notuyla `text`'te gider. `file`/`rack` kopyası paylaşım klasöründe 256 KB'den küçük UTF-8 metinse (NUL ve gizli bilgi kalıbı yoksa) yolun yanında `text` de gelir; tek mesajda bu satır içi kopyaların toplamı en çok 256 KB; `composer.submit` satırı (Peeka'dan eklentiye) en çok 512 KB olabilir, aşarsa satır içi kopyalar düşer, yollar kalır. Eklentinin okuyucusu bu yönde 512 KB'ye kadar satır kabul etmelidir (eklentiden Peeka'ya 64 KB sınırı aynen). Pano görseli (ekran görüntüsü olsun olmasın) `screenshot` türüyle gider. Sayfa ekin yalnız türünü gönderir, yolu hiç göndermez; Rust çözer (Sadakat 3): `screen_image` = sahibin tarama düğmesiyle aldığı en üstteki uygulama penceresinin tam boy görüntüsü (Peeka'nın kendi pencereleri atlanır; o pencere hassas bir uygulamaysa, yani exe'si panonun parola yöneticisi/Windows güvenliği listesinde ya da başlığı panonun hassas başlık kalıbına (banka, parola yöneticisi…) uyuyorsa görüntü alınmaz, `denied` döner ve Peeka "Bu pencere hassas bir uygulamanın…" bildirimini gösterir; alttaki pencereye geçilmez), `file` = sahibin Aç penceresinde seçtiği dosyanın kopyası (ikisi de paylaşım klasöründe; kilitliyken alınmaz; dosya en çok 50 MB), `clipboard_link` = panodaki en yeni bağlantı (`clip` metni, parola sınıfı asla), `shelf` = raftaki bütün dosyaların paylaşım klasöründeki kopyaları (`rack`; yukarıdaki "Raf dosyası yolu"). Eklentiye giden türler değişmedi: `screenshot`, `file`, `clip`, `rack`. "Bu pencere" görüntüsü (`window_image`) bu sürümde yok: `not_yet` döner.
- **Kullanım sayıları:** bellekte, saat dilimli 24 saatlik pencere; Peeka yeniden açılınca sıfırlanır. İçerik hiç tutulmaz.
- **Ana asistanın verisi (Sadakat 3):** `assistant.*`, `calendar.set`, `meeting.set`, `claude.bridge.set`, `job.done`, `shelf.suggestion` yalnız ana asistandan kabul edilir (başkası `-32008`), kapsam her çağrıda denetlenir. Peeka son değeri bellekte tutar; ana asistan yoksa sayfa `not_connected`, henüz göndermediyse `not_yet` alır. Bağlantı kopunca ya da eklenti kaldırılınca hepsi silinir.
- **`alerts.post` `open`:** eklenti uyarısı bağlantı taşıyamaz ama tek bir sabit Peeka eylemini adıyla isteyebilir: `"open": "task_manager"` (düğme "Görev Yöneticisi'nde aç", yazıyı Peeka koyar; sahip basınca Peeka `System32\Taskmgr.exe`'yi tam yoluyla, argümansız başlatır). Başka her değer `-32602`.
- **İlk bağlantı ve izin geçmişi:** bir eklenti ilk kez ana asistan olarak bağlandığında (hayatta bir kez) sayfaya `first_connect` gider; `first_connect_ack` söndürür. Onay penceresi, Ayarlar'daki kapsam düğmeleri ve "Kaldır" her kapsam değişimini `plugins.json`'daki izin günlüğüne yazar (zaman, eklentinin adı, kapsam adı, verildi/bırakıldı; en çok 100 satır; jeton ya da özet asla).
- **Claude Code köprüsü (ana asistan olmadan da çalışır):** Ayarlar'daki "Kur" (`claude_bridge_install`) Claude Code'un kullanıcı ayarına (`CLAUDE_CONFIG_DIR\settings.json`, yoksa `%USERPROFILE%\.claude\settings.json`) on iki olay için Peeka'nın kancasını ekler: `{"type":"command","command":"<peeka.exe yolu>","args":["--cc-hook"],"async":true,"timeout":5}`. Dosya birleştirilir, ezilmez: önce `settings.json.bak-peeka` yedeği, sonra geçici dosya + yeniden adlandırma; sahibin ve diğer araçların kendi kancaları, `env`, `statusLine` ve anahtar sırası olduğu gibi kalır; ikinci "Kur" bir şey değiştirmez (eski bir Peeka girdisi yenisiyle değişir). JSON değilse ya da `hooks` / bir olay listesi beklenmeyen türdeyse dosyaya dokunulmaz, sebep bildirim olarak çıkar. "Kaldır" (`claude_bridge_remove`) yalnız `args` içinde `--cc-hook` olan girdileri siler. Kanca süreci (`peeka.exe --cc-hook`, Tauri başlamadan çalışır) stdin'deki kanca JSON'undan yalnız olay adını, araç adını ve `StopFailure` `error` / `Notification` `notification_type` alanını okur; `{kind, tool, reason, sid}` satırını `\\.\pipe\notch-cc-<SID>` borusuna yazar (eklenti borusuyla aynı DACL: yalnız bu kullanıcı, ağ reddedilir; el sıkışma yok, cevap yok). Araç adı ya da sebep harf, rakam, `_ . : -` dışında bir şey içeriyorsa ya da 64 karakteri aşıyorsa `null` gider; istem, komut, dosya yolu, çalışma klasörü ve çıktı hiçbir zaman borudan geçmez. Oturum kimliği de geçmez: yalnız `sid` gider, yani `HMAC-SHA256(tuz, session_id)` çıktısının ilk 8 onaltılık karakteri. Tuz, bu kuruluma özgü 32 rastgele bayttır (Peeka'nın veri klasöründe `cc-salt.bin`; ilk olayda kancayı çalıştıran süreç yapar); tuz makineden çıkmaz, bu yüzden etiket yalnız bu masada oturumları ayırır ve kimliğe geri dönülemez. Tuz okunamaz ya da yazılamazsa olay `sid`siz gider (çip eski gibi yalnız sayar). Peeka satırı `cc.event` ile aynı kuralla yeniden denetler ve sayfaya `cc_event` gönderir. Kanca Claude Code'u hiç bekletmez: `async`, stdout'a hiçbir şey yazmaz (PermissionRequest'te Claude Code'un kendi sorusu kalır), Peeka kapalıysa ya da boru meşgulse hemen çıkar, en geç 2 saniyede kendini kapatır, her yolda çıkış kodu 0. Çift tepki yok: ana asistan son 2 dakikada `cc.event` gönderdiyse Peeka kendi borusundaki satırları yok sayar (ana asistan kendi kancasıyla zaten aynı olayları iletir; susarsa ya da kopunca Peeka'nınki yeniden geçer). `claude_bridge_state` ana asistanın raporunu verir; ana asistan yoksa ya da rapor etmediyse Peeka'nınkini: `installed` = girdiler var, `healthy` = girdiler bu exe'yi gösteriyor (Peeka taşınır ya da güncellenirse yeniden "Kur"), `lastEventAgoS` = borudaki son geçerli satır. Başka araçların kancaları ayrıdır; hepsi aynı dosyada yan yana durur.
- **`lock.signal`:** Peeka'yı kilitler . Kilit üç sebeple tutulur: Windows kilidi, sahibin "Kilitle"si, eklenti. Windows kilidi açılınca yalnız kendi sebebi kalkar; "Kilitle" ve `lock.signal` kilidini sahip Peeka'da kaldırır (`lock_release`). Kilit hâli `lock_changed` ile ve `plugin_surfaces_changed`'de `locked` olarak görünür. Kilitliyken sahibin hiçbir içeriği eklentiye gitmez: Ctrl+Space gönderimi (sıradaki ekran görüntüleri dahil), Ctrl+K "Asistana sor", raf (sor, Notlara ekle, öneri), pano paylaşımı, tarama, ataç, paylaş penceresi ve ayna `denied` döner. Kilitliyken Ctrl+K'ye yazılan hiçbir şey `search.query` olarak gitmez (Peeka'nın kendi sonuçları çalışır) ve `clipboard.read` boş liste döner (`{items: [], locked: true}`).

## 14. Arayüz sözleşmesi (Rust ↔ sayfa; adlar ve şekiller `ui/src/plugin-api.ts`)

Komutlar: `plugin_surfaces`, `plugin_action {pluginId, actionId}`, `approval_answer {pluginId, id, decision, choiceId?, text?, surface?}`, `composer_submit {text, attachments}` → `{turn}`, `composer_voice`, `consent_get` → `ConsentRequest | null`, `consent_answer {requestId, allow, scopes, mainAssistant, never}`, `plugin_list`, `plugin_set_scope {id, scope, on}`, `plugin_set_main {id | null}`, `plugin_disconnect {id}`, `plugin_remove {id}`, `modules_get`, `modules_set {order, off}`; Sadakat 3: `assistant_counts` → `{jobs, memory, approvals}`, `assistant_open {kind}`, `calendar_next`, `claude_bridge_state` / `_install` / `_remove`, `cc_focus_terminal {sessionId}` ("Terminali aç": sayfa yalnız satırın `session` kimliğini gönderir, hiçbir zaman pid; ana asistanın `cc.sessions.set` ile bildirmediği kimlik `unknown`, ana asistan yoksa `not_connected`, pencere sahibi ata yoksa (klasik konsol, oturum bitmiş) `missing`, Windows odağı vermezse `refused`), `permission_history`, `first_connect_get`, `first_connect_ack`, `shelf_suggest {id}`, `shelf_memory {id}`, `assistant_start` (ana asistan gerekmez; eklenti bildiriminde `launch` yolu varsa onu açar). Olaylar: `plugin_surfaces_changed` (`SurfacesView`), `plugins_changed` (null), `plugin_stream` (`{streamId, text, truncated, done}`), `composer_event`, `consent_changed` (null), `first_connect` (null), `job_done` (`{title, took, seconds}`; `seconds` null olabilir), `assistant_offline` (bool), `meeting_changed` (bool), `cc_event` (`{kind, tool, reason}`).

**Demo kipi (`notch --demo`):** Peeka diske hiçbir şey yazmaz: ayarlar, iğneler ve pano bellekte kalır (pano yalnız metin tutar; görsel ve parola alınmaz), boru açılmaz, `endpoint.json` ve `plugins.json` yazılmaz, paylaşım klasörüne kopya yapılmaz, görev çubuğu gizlenmez, bekçi ve Windows ile başlatma kaydı yok. Ana asistan Peeka'nın içindeki sahte bir asistandır: iki Claude Code oturumu (`session` alanlı satırlar), bir bekleyen onay ve durum sayıları; ona giden her şey düşer. Sahte müzik çalar görünür. `get_settings` `demo: true` döner (sayfa "Demo" rozeti gösterir); şunlar `unsupported` döner: `taskbar_set_mode`, `media_control`, `mirror_enable`, `cc_focus_terminal`, paylaşım klasörüne kopya isteyen ekler (`composer_scan`, `composer_attach_file`, raf: `shelf_ask`, `shelf_memory`, Ctrl+Space `shelf` eki; sahte asistanda `files.drop` yok, `shelf_suggest` hiç sorulmaz); `set_settings` uyarı API'sini açmaz. Kip çalışma sırasında açılıp kapanmaz: çıkmak için Peeka normal açılır.

Yeni hata dizeleri: `ignored` (300 ms koruması; istem açık kalır), `not_connected` (ana asistan bağlı değil: "Asistan bağlı değil"). Onay penceresi `consent` etiketli, `consent.html`; kabiliyeti `capabilities/consent.json` (yalnız olaylar).
