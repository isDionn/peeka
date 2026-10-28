// Grouping of Ctrl+K results (mockup ara0-ara2): Apps, Open windows, Files, Settings, then plugin groups.
import type { SearchResult } from "../bridge";
import { prefixed } from "./plugin";

export interface SearchGroup { key: string; title: string; rows: SearchResult[]; /** No rows, but one line to say (e.g. index off). */ note?: string }

export const FILES_OFF = "Windows Search indexing is off, so files can't be searched.";
const BASE: [SearchResult["kind"], string][] = [["app", "Apps"], ["window", "Open windows"], ["file", "Files"], ["setting", "Settings"]];

/** Empty query: Rust's "recents" in one group, in the order received. With a query, by kind; while the index is off the Files group stays with a one-line notice. */
export function groupResults(results: SearchResult[], query: string, filesOff: boolean): SearchGroup[] {
  if (!query.trim()) return results.length ? [{ key: "recent", title: "Recent", rows: results }] : [];
  const groups: SearchGroup[] = BASE.map(([kind, title]) => ({ key: kind, title, rows: results.filter((r) => r.kind === kind), ...(kind === "file" && filesOff ? { note: FILES_OFF } : null) }));
  const plug = new Map<string, SearchGroup>();
  for (const r of results) {
    if (r.kind !== "plugin" || !r.plugin) continue;
    const title = prefixed(r.plugin, r.group); // Peeka prints the prefix
    const key = r.plugin.id + "|" + title;
    if (!plug.has(key)) plug.set(key, { key, title, rows: [] });
    plug.get(key)!.rows.push(r);
  }
  return [...groups, ...plug.values()].filter((g) => g.rows.length || g.note);
}

/** Result navigation order (arrow keys): the groups' rows back to back. */
export const flatten = (groups: SearchGroup[]) => groups.flatMap((g) => g.rows);

/** Splits out the first match (case-insensitive); null if no match. */
export function splitMatch(text: string, q: string): [string, string, string] | null {
  const t = q.trim();
  if (!t) return null;
  const i = text.toLocaleLowerCase("en-US").indexOf(t.toLocaleLowerCase("en-US"));
  return i < 0 ? null : [text.slice(0, i), text.slice(i, i + t.length), text.slice(i + t.length)];
}

const T_UNIT: Record<string, number> = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };
const T_WORD = "timer|countdown";
const T_RE = new RegExp(`^(?:(?:${T_WORD})\\s+)?(\\d{1,3})\\s*(seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|hrs|hr|h)?(?:\\s+(.+))?$`);

export interface TimerAsk { label: string; seconds: number; text: string }

/** "5 min", "timer 10 minutes", "25 min focus": a local timer request. Without the keyword a unit is required ("2026" isn't a timer). Otherwise null. */
export function parseTimer(q: string): TimerAsk | null {
  const t = q.trim().toLocaleLowerCase("en-US");
  const m = T_RE.exec(t);
  if (!m) return null;
  const keyword = new RegExp(`^(?:${T_WORD})\\s`).test(t);
  const unit = m[2] ?? (keyword ? "min" : null);
  if (!unit) return null;
  const n = Number(m[1]), seconds = n * T_UNIT[unit];
  if (!n || seconds > 24 * 3600) return null;
  const rest = (m[3] ?? "").replace(new RegExp(`^(?:${T_WORD})$`), "").trim();
  const label = rest ? Array.from(rest).slice(0, 24).map((c, i) => (i ? c : c.toLocaleUpperCase("en-US"))).join("") : "Timer";
  const text = seconds % 3600 === 0 ? `${seconds / 3600} h` : seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
  return { label, seconds, text: rest ? `${text} · ${label}` : text };
}

export interface SearchAnswer { text: string }

const UNITS: Record<string, { kind: string; scale: number }> = {
  b: { kind: "data", scale: 1 }, kb: { kind: "data", scale: 1e3 }, mb: { kind: "data", scale: 1e6 }, gb: { kind: "data", scale: 1e9 },
  m: { kind: "length", scale: 1 }, km: { kind: "length", scale: 1e3 }, mi: { kind: "length", scale: 1609.344 },
  s: { kind: "time", scale: 1 }, min: { kind: "time", scale: 60 }, h: { kind: "time", scale: 3600 },
};

const number = (n: number) => Number.isFinite(n) ? String(Number(n.toFixed(8))) : null;

/** A small local expression reader: numbers, + - * / ^ and parentheses; never executes input as code. */
function math(q: string) {
  let at = 0;
  const ws = () => { while (/\s/.test(q[at] ?? "")) at++; };
  const atom = (): number | null => {
    ws();
    if (q[at] === "(") { at++; const n = sum(); ws(); if (q[at++] !== ")") return null; return n; }
    const m = /^[0-9]+(?:\.[0-9]+)?/.exec(q.slice(at));
    if (!m) return null;
    at += m[0].length;
    let n = Number(m[0]);
    ws();
    if (q[at] === "%") { at++; n /= 100; }
    return n;
  };
  const power = (): number | null => { let n = atom(); ws(); if (n !== null && q[at] === "^") { at++; const r = power(); n = r === null ? null : n ** r; } return n; };
  const product = (): number | null => { let n = power(); while (n !== null) { ws(); const op = q[at]; if (op !== "*" && op !== "/") break; at++; const r = power(); n = r === null || (op === "/" && r === 0) ? null : op === "*" ? n * r : n / r; } return n; };
  const sum = (): number | null => { let n = product(); while (n !== null) { ws(); const op = q[at]; if (op !== "+" && op !== "-") break; at++; const r = product(); n = r === null ? null : op === "+" ? n + r : n - r; } return n; };
  const result = sum(); ws();
  return at === q.length ? result : null;
}

/** Calculator and offline unit conversion for search. shortcut: currency conversion needs a live exchange-rate source, so it is intentionally not offered here. */
export function parseSearchAnswer(q: string): SearchAnswer | null {
  const t = q.trim().toLocaleLowerCase("en-US");
  const c = /^(\d+(?:\.\d+)?)\s*(gb|mb|kb|b|km|mi|m|h|min|s|f|c)\s+(?:in|to)\s+(gb|mb|kb|b|km|mi|m|h|min|s|f|c)$/.exec(t);
  if (c) {
    const value = Number(c[1]), from = c[2], to = c[3];
    let out: number | null = null;
    if ((from === "f" || from === "c") && (to === "f" || to === "c")) out = from === to ? value : from === "f" ? (value - 32) * 5 / 9 : value * 9 / 5 + 32;
    else if (UNITS[from]?.kind === UNITS[to]?.kind) out = value * UNITS[from].scale / UNITS[to].scale;
    const shown = out === null ? null : number(out);
    return shown === null ? null : { text: `${shown} ${to}` };
  }
  const of = /^(\d+(?:\.\d+)?)%\s+of\s+(\d+(?:\.\d+)?)$/.exec(t);
  const value = of ? Number(of[1]) * Number(of[2]) / 100 : math(t);
  const shown = value === null ? null : number(value);
  return shown === null ? null : { text: shown };
}
