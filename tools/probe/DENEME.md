# Peeka: Dalga 0 denemeleri (sen yaparsın)

Bu küçük araç, Peeka'yı yapmaya başlamadan önce Windows'un bazı davranışlarını senin bilgisayarında görmemizi sağlar. Her komut bir şeyi 60 saniyeliğine değiştirir ve sonra **kendiliğinden geri alır**. Ne yaptığını ve ne gördüğünü hem ekrana hem bir günlük dosyasına yazar.

## Araç nerede

- Program: `tools\probe\target\release\notch-probe.exe`
- Günlük ve işaret dosyaları: `%LOCALAPPDATA%\PeekaProbe\` (günlük: `probe.log`). Bu klasörü Dosya Gezgini'nin adres çubuğuna yazarak açabilirsin.
- Program yoksa Claude'a "deneme aracını derle" de.

## Önce: acil durum (bir şey ters giderse)

1. Komutun penceresi hâlâ açıksa önce orada **Ctrl+C**'ye bas ya da o PowerShell penceresini kapat: her şeyi geri alır. (Komut çalışırken başka pencerede `restore` yazarsan, çalışan komut 1 saniye içinde yine gizler.)
2. Komut bittiyse ya da Görev Yöneticisi'nden kapatıldıysa, bir PowerShell penceresinde şunu yaz: `notch-probe restore`
   Görev çubuğunu geri getirir, üstteki şeridi kaldırır, Wi-Fi ve Bluetooth'u geri açar.
3. O da olmazsa: Görev Yöneticisi › "Windows Gezgini" › "Yeniden başlat".

Bilmen iyi olur: araç her açılışta önce önceki denemeden kalan bir şey var mı bakar ve varsa onu geri alır. Ekranda "Kalan ... işareti bulundu" yazarsa bu normaldir.

## Başlamadan önce

- PowerShell'i programın klasöründe aç: Dosya Gezgini'nde `...\tools\probe\target\release` klasörüne git, adres çubuğuna `powershell` yazıp Enter'a bas. Komutları o pencereye `.\notch-probe.exe <komut>` diye yazarsın (aşağıdakilerin hepsi böyle).
- **Bir seferde tek komut.** Bir komut bitmeden ("Bitti." yazısı) yenisini başka pencerede açma: yeni açılan, öncekinin yaptığını geri alır.
- Günlükte uygulama adları ve tepsi simgelerinin ipuçları yazabilir. Dosya yalnız senin bilgisayarında kalır.

## 1. Üst şerit (AppBar)

Komut: `.\notch-probe.exe appbar on`

Bak: Her ekranın üstünde koyu mavi ince bir şerit çıkar. Bir tarayıcıyı ya da Dosya Gezgini'ni büyüt (ekranı kapla): pencere şeridin **altından** mı başlıyor? İkinci ekran varsa orada da mı? 60 sn sonra şerit kalkınca büyütülmüş pencere yine en üste uzanıyor mu?

Sonuç: ____

## 2. Çökmede 30 px (en önemli deneme)

**2a. Bekçisiz:**
Komut: `.\notch-probe.exe appbar on`
Şerit görünürken Görev Yöneticisi › **Ayrıntılar** sekmesinde `notch-probe.exe`'ye sağ tıkla › "Görevi sonlandır".
Bak: Şerit kayboldu ama büyütülmüş pencereler hâlâ 30 px aşağıdan mı başlıyor? Ne kadar sürüyor (saniye)? Sonra Görev Yöneticisi › "Windows Gezgini" › "Yeniden başlat": düzeldi mi? En sonda `.\notch-probe.exe restore` yaz.

Sonuç: ____

**2b. Bekçiyle:**
Komut: `.\notch-probe.exe guard`
Ekranda "PID'i **şu** olan notch-probe.exe'yi sonlandır" yazar. Ayrıntılar sekmesinde iki tane `notch-probe.exe` görürsün; **yalnız o PID'i** olanı sonlandır (öteki bekçidir).
Bak: Büyütülmüş pencereler kaç saniyede yine en üste uzanıyor? Bir uyarı penceresi çıktı mı? Bekçi ekrana bir şey yazmaz; ne yaptığını görmek için `%LOCALAPPDATA%\PeekaProbe\probe.log` dosyasının sonunda "Bekçi adım ... İŞE YARADI" ya da "Windows 30 px'i KENDİSİ bıraktı" satırına bak.

Sonuç: ____

## 3. Görev çubuğunu tamamen gizleme

Komut: `.\notch-probe.exe hide on`

Bak: Görev çubuğu tamamen kayboldu mu? **Win** tuşu Başlat'ı açıyor mu, açınca alttaki çubuk da bir an beliriyor mu? **Win+A** ve **Win+N** panelleri açılıyor mu, ekranın neresinde? 60 sn sonra çubuk geri geliyor mu?

Sonuç: ____

## 4. Tepsi (gizli simgeler)

Komut: `.\notch-probe.exe tray`

Bak (ilk 25 sn, görev çubuğu gizliyken): Gizli simgeler paneli (yukarı ok altındaki küçük pencere) kendiliğinden açıldı mı? Ekranın üstüne, şeridin altına taşındı mı, yoksa hemen eski yerine mi döndü?
Bak (sonraki 35 sn): "Tepsi aynası" adlı bir pencere açılır, içinde düğmeler. Discord, Steam, OneDrive gibi tepsi uygulamaların düğmesi var mı? Birine tıkla: o uygulamanın kendi sağ tık menüsü açılıyor mu?

Sonuç: ____

## 5. Farklı ölçekli iki monitör

(İki monitör varsa. Birini Windows Ayarlar › Ekran'dan %100'e, ötekini %125 ya da %150'ye ayarla.)
Komut: `.\notch-probe.exe appbar on`

Bak: İki ekrandaki şerit de göze aynı kalınlıkta mı (yaklaşık bir parmak eni)? Biri çok ince ya da çok kalın mı?

Sonuç: ____

## 6. Explorer yeniden başlarken gizleme

Komut: `.\notch-probe.exe hide on`
Görev çubuğu gizliyken Görev Yöneticisi › "Windows Gezgini" › "Yeniden başlat".

Bak: Explorer geri geldiğinde görev çubuğu belirip **1 saniye içinde** yine gizleniyor mu?

Sonuç: ____

## 7. Örnek ada (tıklama geçirme ve odak)

Önce arkaya bir Not Defteri aç, içine bir şey yaz (imleç orada yanıp sönsün).
Komut: `.\notch-probe.exe island`

Ekranın üst ortasında gri, yarı saydam bir kutu ve içinde koyu "Kutu: buraya tıkla" alanı çıkar. İlk 30 sn "Mod 1", son 30 sn "Mod 2" (üstte yazar).
Bak (iki modda da): Gri alana tıkla: tıklama arkadaki pencereye geçiyor mu? Koyu kutuya tıkla: Not Defteri'nde imleç yanıp sönmeye devam ediyor mu (odağı kaybetmemeli)?

Sonuç (Mod 1): ____
Sonuç (Mod 2): ____

## 8. Wi-Fi ve Bluetooth

(Önce ikisini de Windows'tan aç. İnternet 5 saniye kesilebilir: o sırada bir şey indirme.)
Komut: `.\notch-probe.exe radios`

Bak: Wi-Fi ve Bluetooth simgeleri 5 sn kapanıp geri açılıyor mu? Ekranda "DeniedByUser" ya da "DeniedBySystem" (erişim reddi) yazıyor mu? En sonda ikisi de yine açık mı?

Sonuç: ____

## 9. Tam ekran oyunda üst şerit

Komut: `.\notch-probe.exe topmost`
Komutu yazdıktan sonra 15 saniye içinde bir oyuna geç (önce özel tam ekran çalışan eski bir oyun, sonra varsa kenarlıksız tam ekran bir oyun). Araç bunu 3 kez yapar: her seferinde 15 sn bekler, üstte 4 sn turuncu şerit gösterir.

Bak: Şerit çıkınca oyun küçülüyor mu, siyah ekran ya da takılma oluyor mu? Kenarlıksız tam ekranda ne oluyor?

Sonuç (özel tam ekran): ____
Sonuç (kenarlıksız): ____

## 10. Ses tuşları

Komut: `.\notch-probe.exe volkeys`

60 sn boyunca: klavyedeki ses tuşlarına bas; dizüstüyse Fn ile ses tuşlarına; kulaklığın ses düğmesine; bir de yönetici olarak açılmış bir pencere (ör. yönetici PowerShell) öndeyken ses tuşuna.
Bak: Windows'un ses göstergesi (ekranda çıkan ses çubuğu) çıkıyor mu? Ses değişiyor mu? (Araç tuşu yakaladıysa ses değişmez ve gösterge çıkmamalı.) Hangisinde çıktı?

Sonuç: ____

## 11. Ekran paylaşımından gizleme

Teams/Zoom'da ekran paylaşımı, OBS'te ekran yakalama ya da Ekran Alıntısı Aracı'nı hazırla.
Komut: `.\notch-probe.exe exclude`

Kırmızımsı bir pencere açılır; içinde "ŞU AN: GÖRÜNÜR" ya da "ŞU AN: YAKALAMADAN GİZLİ" yazar ve 5 sn'de bir değişir.
Bak: "GİZLİ" yazarken paylaşımda/OBS'te pencere görünmüyor mu (siyah ya da boş)? "GÖRÜNÜR" yazarken görünüyor mu? Geçişlerde titreme ya da bir an görünme oluyor mu?

Sonuç: ____

## 12. Çalan şarkı ve şifreleme

Spotify'da (ya da başka bir uygulamada) bir şarkı çal.
Komut: `.\notch-probe.exe smtc` sonra `.\notch-probe.exe dpapi`

Bak: smtc çalan şarkının adını ve sanatçısını doğru yazıyor mu? dpapi "sonuç aynı (doğru)" yazıyor mu? (dpapi yalnız sabit bir deneme cümlesini şifreler, senin verilerine dokunmaz.)

Sonuç: ____

---

Bitince bu dosyayı kaydet, Claude'a 'denemeler bitti' de.
