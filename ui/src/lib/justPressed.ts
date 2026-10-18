// Gerçek pencerede Peeka bir tıklamadan hemen sonra odağı önceki uygulamaya geri verir (ADR-0062 §1, notch-win
// style.rs `strip_no_activate`); o bulanıklaşma bir ayrılış değildir. Alt+Tab / Win+L tıklamasız gelir: sayılır.
let lastUp = 0;
if (typeof document !== "undefined") document.addEventListener("pointerup", () => { lastUp = Date.now(); }, true);

/** Son tıklama bu kadar yeniyse gelen pencere bulanıklaşması odağın geri verilmesidir (geri verme ≤ ~400 ms sürer). */
export const justPressed = () => Date.now() - lastUp < 700;

/** Yazı girilen alan: odak buradayken şerit penceresi odağı tutar (Başlat'taki arama kutusu, Ayarlar alanları). */
export const isTextEntry = (t: EventTarget | null) =>
  t instanceof HTMLElement && t.matches('textarea, [contenteditable="true"], input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])');
