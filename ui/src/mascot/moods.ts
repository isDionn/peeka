// Hayalet maskotun hal tablosu ve boy kuralları (FPV §0i madde 19 ve 23; kaynak: maskot-motor.js).
export type Mood =
  | "idle" | "drowsy" | "listening" | "thinking" | "speaking" | "approval" | "serious"
  | "attention" | "tired" | "done" | "error" | "quiet" | "sleeping" | "music"
  | "searching" | "question" | "ratelimit" | "dizzy";

export type Body = "notr" | "eller-yukari" | "cene" | "yanaklar" | "egik" | "basik" | "uzun" | "ucceyrek";
export type Fx = "zzz" | "mintSol" | "mintSag" | "nokta" | "kirmiziSag" | "kirmiziSol" | "tabela" | "pirilti" | "pirilti2" | "nota" | "nota2" | "halka" | "amber" | "sallama" | "ter";
export type Silhouette = "acik" | "kapali" | "eller" | "ucceyrek";

export interface MoodSpec {
  body: Body; eyes: string; mouth: string; fx: Fx[];
  light: string | null;   // asistan çizgisi jetonu (karar 9); müzikte ışık yok
  speed: number; talk?: boolean; sway?: boolean;
  sil: Silhouette;         // 20 px şeritte kullanılan siluet
  /** Küçük rozet (>=40 px): "?" soru, "dot" turuncu nokta (kota). Onayın "!" rozeti ayrıdır (>=56 px). */
  tag?: "?" | "dot";
  tilt?: number;           // baş yatışı (derece)
  roll?: boolean;          // hale girerken bir tur yuvarlanır
  scan?: boolean;          // gözler soldan sağa tarar
}

const GULUS = "agiz-gulus";
export const MOODS: Record<Mood, MoodSpec> = {
  idle:      { body: "notr",         eyes: "goz-acik",   mouth: GULUS,          fx: [],                       light: null,                 speed: .6,  sil: "acik" },
  drowsy:    { body: "egik",         eyes: "goz-uykulu", mouth: GULUS,          fx: ["zzz"],                  light: null,                 speed: .7,  sil: "kapali" },
  listening: { body: "yanaklar",     eyes: "goz-kasli",  mouth: GULUS,          fx: ["mintSol", "mintSag"],   light: "var(--mint,#63E6E2)",   speed: 1,   sil: "acik" },
  thinking:  { body: "cene",         eyes: "goz-yukari", mouth: GULUS,          fx: ["nokta"],                light: "var(--turuncu,#FF9F0A)", speed: .9, sil: "acik" },
  speaking:  { body: "notr",         eyes: "goz-acik",   mouth: "agiz-kahkaha", fx: ["kirmiziSag", "kirmiziSol"], light: "var(--kizil,#F2555A)", speed: 1.1, talk: true, sil: "acik" },
  approval:  { body: "ucceyrek",     eyes: "goz-kirpma", mouth: GULUS,          fx: ["tabela", "sallama"],               light: "var(--turuncu,#FF9F0A)", speed: 1,  sil: "ucceyrek" },
  serious:   { body: "notr",         eyes: "goz-acik",   mouth: "agiz-dalga",   fx: [],                       light: "var(--turuncu,#FF9F0A)", speed: .6, sil: "acik" },
  attention: { body: "ucceyrek",     eyes: "goz-saskin", mouth: "agiz-o",       fx: [],                       light: "var(--turuncu,#FF9F0A)", speed: .8, sil: "ucceyrek" },
  tired:     { body: "egik",         eyes: "goz-kisik",  mouth: "agiz-dalga",   fx: [],                       light: null,                 speed: .5,  sil: "kapali" },
  done:      { body: "eller-yukari", eyes: "goz-mutlu",  mouth: GULUS,          fx: ["pirilti", "pirilti2"],  light: "var(--yesil,#30D158)",  speed: 1.1, sil: "eller" },
  error:     { body: "notr",         eyes: "goz-sersem", mouth: "agiz-dalga",   fx: ["halka"],                light: null,                 speed: .8,  sil: "acik" },
  quiet:     { body: "notr",         eyes: "goz-huzurlu", mouth: GULUS,         fx: [],                       light: null,                 speed: 0,   sil: "kapali" },
  sleeping:  { body: "egik",         eyes: "goz-kapali", mouth: GULUS,          fx: ["zzz"],                  light: null,                 speed: .5,  sil: "kapali" },
  // Peeka'nın kendi halleri (asistandan bağımsız): arıyor, soru, kota doldu, sersem
  searching: { body: "notr",         eyes: "goz-acik",   mouth: GULUS,          fx: [],                       light: "var(--mavi,#64D2FF)",  speed: .9,  scan: true, sil: "acik" },
  question:  { body: "egik",         eyes: "goz-yukari", mouth: GULUS,          fx: [],                       light: "var(--mor,#BF5AF2)",   speed: .8,  tag: "?", tilt: 6, sil: "ucceyrek" },
  ratelimit: { body: "egik",         eyes: "goz-uzgun",  mouth: "agiz-dalga",   fx: ["ter"],                  light: "var(--kota,#FF7A1A)",  speed: .5,  tag: "dot", sil: "kapali" },
  dizzy:     { body: "egik",         eyes: "goz-sersem", mouth: "agiz-dil",     fx: ["halka"],                light: "var(--sari,#FFD60A)",  speed: 1.2, roll: true, tilt: -5, sil: "acik" },
  music:     { body: "egik",         eyes: "goz-kapali", mouth: GULUS,          fx: ["nota", "nota2"],        light: null,                 speed: 1,   sway: true, sil: "kapali" },
};

export const CLOSED_EYES = new Set(["goz-mutlu", "goz-kapali", "goz-huzurlu", "goz-cizgi", "goz-sersem", "goz-uykulu"]);

/** Boy kuralları: 24 px şeritte siluet (27 ve altı) (allık, efekt, el, ışık, göz takibi yok); 28 px ve üstünde parçalı, allıklı.
 *  56 ve üstü kart: "!" rozeti, hata titremesi, bitti pırıltısı. 40 = şeritte asılı poz (şerit sınırından taşar). */
export const SILHOUETTE_MAX = 27;
export const HANG_SIZE = 40;
export const DAZE_SIZE = 96;
/** Asılı poz (40 px): kutu 40x30 (şerit yüksekliği); hayalet kutusu 3,5 px yukarı kayar, gövde şeridin altına ~12 px sarkar.
 *  `hit` = tıklanabilir gövde dikdörtgeni, kutunun sol-üstüne göre (px); altındaki saydam alan tıklamayı engellemez. */
export const HANG = { box: { w: 40, h: 30 }, shiftY: -3.5, hit: { x: 5, y: 5, w: 30, h: 37 } } as const;
export function sizePlan(size: number) {
  const sil = size <= SILHOUETTE_MAX;
  const card = size >= 56;
  return { silhouette: sil, blush: !sil, effects: !sil, eyeTracking: !sil, sign: card, badge: card, shake: card, sparkle: card, hang: size === HANG_SIZE, tag: size >= HANG_SIZE };
}

/** Siluet dosyası için DPI ölçeği: 1x / 2x / 3x (1,25 ve 1,5 yukarı yuvarlanır, keskin kalsın). */
export function pickScale(dpr: number): 1 | 2 | 3 {
  return dpr <= 1 ? 1 : dpr <= 2 ? 2 : 3;
}
