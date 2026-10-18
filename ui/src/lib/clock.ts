const GUN = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const GUN_UZUN = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const AY_UZUN = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** "Per 16 Eki" ve "14:32" ayrı (saat kalın yazılır). Intl tr-TR sırası "16 Eki Per" çıktığı için elle birleştirilir. */
export function clockParts(d: Date) {
  return {
    date: `${GUN[d.getDay()]} ${d.getDate()} ${AY[d.getMonth()]}`,
    time: `${p2(d.getHours())}:${p2(d.getMinutes())}`,
    label: `${GUN_UZUN[d.getDay()]} ${d.getDate()} ${AY_UZUN[d.getMonth()]}, ${p2(d.getHours())}:${p2(d.getMinutes())}`,
  };
}
