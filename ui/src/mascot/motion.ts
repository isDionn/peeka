// Mascot motion numbers (pure, tested).

/** Keyframe track: each step is [target value, duration ms]; the start value is given separately. */
export type Track = readonly (readonly [number, number])[];

export const trackMs = (tr: Track) => tr.reduce((a, [, d]) => a + d, 0);

/** Value at t ms: each segment is smooth on its own (smoothstep), zero velocity at the ends (natural direction changes in a shake). */
export function sample(tr: Track, from: number, t: number): number {
  let v = from, at = 0;
  for (const [to, d] of tr) {
    if (t < at + d) { const u = (t - at) / d; return v + (to - v) * u * u * (3 - 2 * u); }
    v = to; at += d;
  }
  return v;
}

/** Error shake (px, for the 56 px card; scaled by size/56 on bigger cards): +4, -4, +2.5, 0 / 50, 70, 70, 90 ms. */
export const SHAKE: Track = [[4, 50], [-4, 70], [2.5, 70], [0, 90]];
export const shakeTrack = (size: number): Track => SHAKE.map(([v, d]) => [v * (size / 56), d] as const);

/** File swallow: sy 1 -> 0.78 -> 1.18 -> 1 (80/130/220 ms); sx the inverse. Mouth open 460 ms. */
export const SWALLOW_Y: Track = [[.78, 80], [1.18, 130], [1, 220]];
export const SWALLOW_X: Track = [[1.28, 80], [.92, 130], [1, 220]];
export const SWALLOW_MOUTH_MS = 460;
/** Chewing after the swallow: the file icon shrinks into the mouth in 320 ms; once the mouth closes, 3 chews (o/smile, 120 ms) + a slight squash. */
export const SWALLOW_FILE_MS = 320;
export const CHEW = { steps: 3, stepMs: 120 } as const;
export const CHEW_Y: Track = [[.96, 60], [1.02, 60], [.96, 60], [1.02, 60], [.97, 60], [1, 60]];

/** Click squash (sy 0.78 -> 1.1 -> 1; 70/130/170 ms) + dizzy eyes. */
export const POKE_Y: Track = [[.78, 70], [1.1, 130], [1, 170]];
export const POKE_X: Track = [[1.2, 70], [.94, 130], [1, 170]];

export const BADGE = { out: 90, delay: 100, inn: 280 } as const;
export const SPARKLE = { count: 5, startMs: 500, gapMs: 140, lifeMin: 1300, lifeMax: 1800, riseMin: .45, riseMax: .8 } as const;

export const DAZE = { one: 800, triple: 3300, windowMs: 1700, clicks: 3 } as const;
/** Click counter: 3 clicks within 1.7 s = a long daze, otherwise short. Returns the daze duration (ms). */
export function createClickCounter(now: () => number = () => performance.now()) {
  let stamps: number[] = [];
  return () => {
    const t = now();
    stamps = stamps.filter((s) => t - s <= DAZE.windowMs);
    stamps.push(t);
    if (stamps.length >= DAZE.clicks) { stamps = []; return DAZE.triple; }
    return DAZE.one;
  };
}
/** Daze sway: ±3° half-second steps, ending at 0. */
export function swayTrack(ms: number): Track {
  const out: [number, number][] = [];
  for (let t = 0, s = 1; t + 500 <= ms; t += 500, s = -s) out.push([3 * s, 500]);
  out.push([0, 300]);
  return out;
}

/** Gaze: target = tanh(dx/260), tanh(dy/200); smoothing step 1 - 0.0025^dt (dt in seconds). */
export const gazeTarget = (dx: number, dy: number): [number, number] => [Math.tanh(dx / 260), Math.tanh(dy / 200)];
export const gazeStep = (dt: number) => 1 - Math.pow(0.0025, dt);

/** Touch reactions. The numbers are starting values; tuned by eye. */
export const REACT = { slapMs: 600, slapGap: 350, loveHoverMs: 1900, loveMs: 2400, loveGap: 8000, hearts: 5, dizzyTaps: 5, dizzyWindow: 3000, dizzyMs: 2600 } as const;
/** Slap: squash (POKE) + horizontal shake together; eyes squint for `slapMs`. Then back to the previous look. */
/** Love only in calm moods (approval, error, sleep and attention are never covered). */
export const LOVE_MOODS: ReadonlySet<string> = new Set(["idle", "done", "listening", "music", "speaking"]);

/** Reaction gate (pure): a click flood mustn't loop slaps forever; love is spaced out. The clock is passed in. */
export function createReactionGate(now: () => number = () => performance.now()) {
  let lastSlap = -Infinity, lastLove = -Infinity, dizzyUntil = -Infinity, stamps: number[] = [];
  return {
    /** Click: "slap", "none" at the rate limit (the real action like opening a card still runs) or "dizzy" on 5 clicks in 3 s (no reactions meanwhile). */
    tap(): "slap" | "dizzy" | "none" {
      const t = now();
      if (t < dizzyUntil) return "none";
      stamps = stamps.filter((s) => t - s <= REACT.dizzyWindow); stamps.push(t);
      if (stamps.length >= REACT.dizzyTaps) { stamps = []; dizzyUntil = t + REACT.dizzyMs; return "dizzy"; }
      if (t - lastSlap < REACT.slapGap) return "none";
      lastSlap = t; return "slap";
    },
    /** After hovering 1.9 s: is love allowed (at most once every 8 s). */
    love(): boolean {
      const t = now();
      if (t - lastLove < REACT.loveGap) return false;
      lastLove = t; return true;
    },
  };
}

/** Dizzy: one roll (900 ms) then a slow ±3° sway; the final 360 = 0 (reset at the end of the track). */
export function dizzyTrack(ms: number): Track {
  const out: [number, number][] = [[360, 900]];
  for (let t = 900, s = 1; t + 500 <= ms; t += 500, s = -s) out.push([360 + 3 * s, 500]);
  out.push([360, 300]);
  return out;
}
