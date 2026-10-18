// MIT License (pending owner confirmation)
// Self-checks for the weather and pomodoro examples: no pipe, no network.
import test from "node:test";
import assert from "node:assert/strict";
import * as weather from "./weather.mjs";
import * as pomo from "./pomodoro.mjs";

const SCOPES = new Set(["island.protrusion", "card.module", "alerts.post"]);
const PROTRUSION_KEYS = new Set(["title", "subtitle", "icon", "state", "progress", "timer", "note", "actions"]);

test("manifests ask only known scopes, with a reason each", () => {
  for (const m of [weather.MANIFEST, pomo.MANIFEST]) {
    assert.match(m.id, /^[a-z0-9]+(\.[a-z0-9-]+)+$/);
    assert.ok(m.scopes.every((s) => SCOPES.has(s)));
    assert.deepEqual(Object.keys(m.why).sort(), [...m.scopes].sort());
  }
});

// A real Open-Meteo answer (fetched once for this test).
const CANNED = { current_units: { temperature_2m: "°C" }, current: { temperature_2m: 13.6, weather_code: 2 } };

test("weather: formats a canned Open-Meteo payload", () => {
  assert.deepEqual(weather.format(CANNED), { temp: "14°C", text: "Partly cloudy" });
  assert.equal(weather.format({}), null);
  assert.equal(weather.format({ current: { temperature_2m: "x" } }), null);
  assert.equal(weather.condition(999), "Unknown");
});

test("weather: config, url and card shape", () => {
  const cfg = weather.config({ WEATHER_LAT: "10.5", WEATHER_LON: "-20", WEATHER_UNITS: "imperial" });
  assert.match(weather.url(cfg), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=10\.5&longitude=-20&.*temperature_unit=fahrenheit/);
  assert.doesNotMatch(weather.url({ ...cfg, units: "metric" }), /temperature_unit/);
  assert.throws(() => weather.config({ WEATHER_LAT: "91" }));
  const p = weather.cardParams(weather.format(CANNED), cfg);
  assert.ok(p.tabs.length <= 3 && p.summary.length <= 3);
  assert.ok(p.tabs[0].blocks.every((b) => ["heading", "text", "kv"].includes(b.type)));
});

const cfg = { work: 3, break: 2 };

test("pomodoro: config defaults and validation", () => {
  assert.deepEqual(pomo.config({}), { work: 1500, break: 300 });
  assert.deepEqual(pomo.config({ POMODORO_WORK_MIN: "50", POMODORO_BREAK_MIN: "10" }), { work: 3000, break: 600 });
  assert.throws(() => pomo.config({ POMODORO_WORK_MIN: "0" }));
  assert.throws(() => pomo.config({ POMODORO_BREAK_MIN: "abc" }));
});

test("pomodoro: state machine runs work -> break -> work and reports each end", () => {
  let s = pomo.start(cfg), ended = [];
  for (let i = 0; i < 3 + 2 + 1; i++) { const r = pomo.tick(s, 1, cfg); s = r.s; if (r.ended) ended.push(r.ended); }
  assert.deepEqual(ended, ["work", "break"]);
  assert.deepEqual(s, { phase: "work", left: 2, running: true }); // second work phase, 1 s in (3 -> 2)
});

test("pomodoro: pause freezes the clock, skip ends the phase, unknown button is ignored", () => {
  let s = pomo.press(pomo.start(cfg), "toggle", cfg);
  assert.equal(s.running, false);
  assert.deepEqual(pomo.tick(s, 10, cfg), { s, ended: null });
  assert.equal(pomo.press(s, "toggle", cfg).running, true);
  assert.deepEqual(pomo.press(pomo.start(cfg), "skip", cfg), { phase: "break", left: 2, running: true });
  assert.deepEqual(pomo.press(s, "nope", cfg), s);
});

test("pomodoro: protrusion uses only contract fields, at most 2 actions, timer only while running", () => {
  const real = { work: 1500, break: 300 };
  const run = pomo.protrusion({ phase: "work", left: 1440, running: true }, real, Date.parse("2026-10-18T10:01:00Z"));
  assert.ok(Object.keys(run).every((k) => PROTRUSION_KEYS.has(k)));
  assert.equal(run.title, "Work: 24 min left");
  assert.equal(run.timer.started_at, "2026-10-18T10:00:00Z");
  assert.ok(run.actions.length <= 2 && run.progress > 0.03 && run.progress < 0.05);
  const paused = pomo.protrusion({ phase: "break", left: 61, running: false }, real);
  assert.equal(paused.title, "Break paused: 2 min left");
  assert.equal("timer" in paused, false);
  assert.deepEqual(pomo.alert("work").priority <= 69, true);
});
