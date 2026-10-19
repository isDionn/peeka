// The ghost mascot's mood table and size rules (FPV §0i items 19 and 23; source: maskot-motor.js).
// Body, eye, mouth and silhouette names are the artwork file names under public/mascot (rename both together).
export type Mood =
  | "idle" | "drowsy" | "listening" | "thinking" | "speaking" | "approval" | "serious"
  | "attention" | "tired" | "done" | "error" | "quiet" | "sleeping" | "music"
  | "searching" | "question" | "ratelimit" | "dizzy" | "hello" | "message";

export type Body = "neutral" | "hands-up" | "chin" | "cheeks" | "tilted" | "squashed" | "tall" | "three-quarter";
export type Fx = "zzz" | "mintLeft" | "mintRight" | "dots" | "redRight" | "redLeft" | "sign" | "sparkle" | "sparkle2" | "note" | "note2" | "ring" | "amber" | "wave" | "sweat";
export type Silhouette = "open" | "closed" | "hands" | "three-quarter";

export interface MoodSpec {
  body: Body; eyes: string; mouth: string; fx: Fx[];
  light: string | null;   // assistant line token (decision 9); no light for music
  speed: number; talk?: boolean; sway?: boolean;
  sil: Silhouette;         // silhouette used on the 20 px strip
  /** Small badge (>=40 px): "?" question, "dot" orange dot (quota). The approval "!" badge is separate (>=56 px). */
  tag?: "?" | "dot";
  tilt?: number;           // head tilt (degrees)
  roll?: boolean;          // rolls once on entering the mood
  scan?: boolean;          // eyes scan left to right
}

const SMILE = "mouth-smile";
export const MOODS: Record<Mood, MoodSpec> = {
  idle:      { body: "neutral",         eyes: "eye-open",   mouth: SMILE,          fx: [],                       light: null,                 speed: .6,  sil: "open" },
  drowsy:    { body: "tilted",         eyes: "eye-sleepy", mouth: SMILE,          fx: ["zzz"],                  light: null,                 speed: .7,  sil: "closed" },
  listening: { body: "cheeks",     eyes: "eye-brows",  mouth: SMILE,          fx: ["mintLeft", "mintRight"],   light: "var(--mint,#63E6E2)",   speed: 1,   sil: "open" },
  thinking:  { body: "chin",         eyes: "eye-up", mouth: SMILE,          fx: ["dots"],                light: "var(--orange,#FF9F0A)", speed: .9, sil: "open" },
  speaking:  { body: "neutral",         eyes: "eye-open",   mouth: "mouth-laugh", fx: ["redRight", "redLeft"], light: "var(--crimson,#F2555A)", speed: 1.1, talk: true, sil: "open" },
  approval:  { body: "three-quarter",     eyes: "eye-wink", mouth: SMILE,          fx: ["sign", "wave"],               light: "var(--orange,#FF9F0A)", speed: 1,  sil: "three-quarter" },
  serious:   { body: "neutral",         eyes: "eye-open",   mouth: "mouth-wavy",   fx: [],                       light: "var(--orange,#FF9F0A)", speed: .6, sil: "open" },
  attention: { body: "three-quarter",     eyes: "eye-surprised", mouth: "mouth-o",       fx: [],                       light: "var(--orange,#FF9F0A)", speed: .8, sil: "three-quarter" },
  tired:     { body: "tilted",         eyes: "eye-narrow",  mouth: "mouth-wavy",   fx: [],                       light: null,                 speed: .5,  sil: "closed" },
  done:      { body: "hands-up", eyes: "eye-happy",  mouth: SMILE,          fx: ["sparkle", "sparkle2"],  light: "var(--green,#30D158)",  speed: 1.1, sil: "hands" },
  error:     { body: "neutral",         eyes: "eye-dizzy", mouth: "mouth-wavy",   fx: ["ring"],                light: null,                 speed: .8,  sil: "open" },
  quiet:     { body: "neutral",         eyes: "eye-calm", mouth: SMILE,         fx: [],                       light: null,                 speed: 0,   sil: "closed" },
  sleeping:  { body: "tilted",         eyes: "eye-closed", mouth: SMILE,          fx: ["zzz"],                  light: null,                 speed: .5,  sil: "closed" },
  // Peeka's own moods (independent of the assistant): searching, question, quota reached, dizzy
  searching: { body: "neutral",         eyes: "eye-open",   mouth: SMILE,          fx: [],                       light: "var(--blue,#64D2FF)",  speed: .9,  scan: true, sil: "open" },
  question:  { body: "tilted",         eyes: "eye-up", mouth: SMILE,          fx: [],                       light: "var(--purple,#BF5AF2)",   speed: .8,  tag: "?", tilt: 6, sil: "three-quarter" },
  ratelimit: { body: "tilted",         eyes: "eye-sad",  mouth: "mouth-wavy",   fx: ["sweat"],                  light: "var(--quota,#FF7A1A)",  speed: .5,  tag: "dot", sil: "closed" },
  dizzy:     { body: "tilted",         eyes: "eye-dizzy", mouth: "mouth-tongue",     fx: ["ring"],                light: "var(--yellow,#FFD60A)",  speed: 1.2, roll: true, tilt: -5, sil: "open" },
  // M1 short reactions (Peeka's own, never sent by plugins): launch greeting (waves once), a new message (raised brows + small sparkle)
  hello:     { body: "neutral",         eyes: "eye-happy",  mouth: SMILE,          fx: ["wave"],                 light: null,                 speed: 1,   sil: "hands" },
  message:   { body: "neutral",         eyes: "eye-brows-2", mouth: SMILE,         fx: ["sparkle2"],             light: null,                 speed: .8,  sil: "open" },
  music:     { body: "tilted",         eyes: "eye-closed", mouth: SMILE,          fx: ["note", "note2"],        light: null,                 speed: 1,   sway: true, sil: "closed" },
};

export const CLOSED_EYES = new Set(["eye-happy", "eye-closed", "eye-calm", "eye-line", "eye-dizzy", "eye-sleepy"]);

/** Size rules: silhouette on the 24 px strip (27 and below) (no blush, effects, hands, light or eye tracking); from 28 px up, layered parts with blush.
 *  56 and up (card): "!" badge, error shake, done sparkle. 40 = hanging pose on the strip (overflows the strip edge). */
export const SILHOUETTE_MAX = 27;
export const HANG_SIZE = 40;
export const DAZE_SIZE = 96;
/** Hanging pose (40 px): box 40x30 (strip height); the ghost box shifts 3.5 px up, the body hangs ~12 px below the strip.
 *  `hit` = clickable body rectangle relative to the box's top left (px); the transparent area below doesn't block clicks. */
export const HANG = { box: { w: 40, h: 30 }, shiftY: -3.5, hit: { x: 5, y: 5, w: 30, h: 37 } } as const;
export function sizePlan(size: number) {
  const sil = size <= SILHOUETTE_MAX;
  const card = size >= 56;
  return { silhouette: sil, blush: !sil, effects: !sil, eyeTracking: !sil, sign: card, badge: card, shake: card, sparkle: card, hang: size === HANG_SIZE, tag: size >= HANG_SIZE };
}

/** DPI scale for the silhouette file: 1x / 2x / 3x (1.25 and 1.5 round up to stay sharp). */
export function pickScale(dpr: number): 1 | 2 | 3 {
  return dpr <= 1 ? 1 : dpr <= 2 ? 2 : 3;
}
