// Kapsamların düzeyi ve sade Türkçe açıklaması Peeka'nın kendi tablosudur (eklenti yalnız `why` gönderir). Kaynak: eklenti-api.md §4.
export type Level = "low" | "medium" | "high";
export interface ScopeInfo { scope: string; level: Level; text: string }

const TABLE: Record<string, [Level, string]> = {
  "island.protrusion": ["low", "Adada durum ve çıkıntı göstermek"],
  "card.module": ["low", "Modüller kartında en çok 3 sekme ve özet satırları göstermek"],
  "alerts.post": ["low", "Kısa uyarı ve sürekli etkinlik göstermek"],
  "notifications.post": ["low", "Bildirimler listesine kayıt eklemek"],
  "search.provider": ["medium", "Ctrl+K aramasına sonuç vermek (yazdığın sorguyu görür)"],
  "composer.handler": ["medium", "Ctrl+Space sorularını almak"],
  "voice.line": ["medium", "Şeridin altındaki ses çizgisini ve canlı dökümü yönetmek"],
  "approvals.prompt": ["medium", "Onay sormak"],
  "files.drop": ["medium", "Adaya bıraktığın dosyaların yollarını almak"],
  "lock.signal": ["medium", "Peeka'yı kilitlemek"],
  "media.read": ["medium", "Çalan parçanın adını ve sanatçısını okumak"],
  "windows.read": ["high", "Açık pencerelerin adlarını görmek"],
  "clipboard.read": ["high", "Pano geçmişini okumak (parolalar hiçbir koşulda verilmez)"],
  "notifications.read": ["high", "Windows bildirimlerini okumak"],
};

/** Bilinmeyen kapsam yüksek sayılır (işaretsiz gelir); Rust zaten bilinmeyeni reddeder. */
export const scopeInfo = (scope: string): ScopeInfo => {
  const [level, text] = TABLE[scope] ?? ["high", "Bilinmeyen izin"];
  return { scope, level, text };
};
export const LEVEL_NAME: Record<Level, string> = { low: "düşük", medium: "orta", high: "yüksek" };
