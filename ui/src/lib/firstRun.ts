// İlk açılış kartının "gördüm" işareti. Şerit ve ada sayfaları aynı kökenli: Ayarlar › Maskot işareti siler, ada kartı yeniden açar.
export const FIRST_KEY = "notch.ilkAcilis";
export const firstRunDone = () => { try { return localStorage.getItem(FIRST_KEY) === "1"; } catch { return false; } };
export const markFirstRun = () => { try { localStorage.setItem(FIRST_KEY, "1"); } catch { /* depolama yok: her açılışta sorar */ } };
export const resetFirstRun = () => { try { localStorage.removeItem(FIRST_KEY); } catch { /* depolama yok */ } };
