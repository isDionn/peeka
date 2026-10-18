// MIT License (pending owner confirmation) - Copyright (c) Peeka authors.
// Weather example: current temperature and condition from Open-Meteo (no API key) on the modules card, every 15 minutes.
// NETWORK: this plugin calls https://api.open-meteo.com itself. Peeka makes no network request for it and cannot control it.
// Run: WEATHER_LAT=41.01 WEATHER_LON=28.98 WEATHER_UNITS=metric node weather.mjs
import { fileURLToPath } from "node:url";
import { runPlugin } from "./plugin-runner.mjs";

export const MANIFEST = {
  id: "com.example.weather", name: "Weather", publisher: "Example", version: "0.1.0", api: 1,
  scopes: ["card.module"], why: { "card.module": "Show the current weather in the modules card" },
};
const REFRESH_MS = 15 * 60 * 1000;

// WMO weather codes (Open-Meteo `weather_code`), grouped into plain-text labels.
const WMO = [[[0], "Clear sky"], [[1, 2], "Partly cloudy"], [[3], "Overcast"], [[45, 48], "Fog"], [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"], [[71, 73, 75, 77, 85, 86], "Snow"], [[95, 96, 99], "Thunderstorm"]];
export const condition = (code) => WMO.find(([codes]) => codes.includes(code))?.[1] ?? "Unknown";

export function config(env = process.env) {
  const lat = Number(env.WEATHER_LAT ?? 41.01), lon = Number(env.WEATHER_LON ?? 28.98);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) throw new Error("WEATHER_LAT / WEATHER_LON out of range");
  return { lat, lon, units: env.WEATHER_UNITS === "imperial" ? "imperial" : "metric" };
}

export function url({ lat, lon, units }) {
  const unit = units === "imperial" ? "&temperature_unit=fahrenheit" : "";
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code${unit}`;
}

/** Open-Meteo response -> the text we show, or null when the payload is not what we expect. */
export function format(json) {
  const c = json?.current, unit = json?.current_units?.temperature_2m;
  if (typeof c?.temperature_2m !== "number" || typeof unit !== "string") return null;
  return { temp: `${Math.round(c.temperature_2m)}${unit}`, text: condition(c.weather_code) };
}

export const cardParams = ({ temp, text }, { lat, lon }) => ({
  tabs: [{ id: "weather", title: "Weather", blocks: [
    { type: "heading", text: temp }, { type: "text", text },
    { type: "kv", rows: [{ key: "Location", value: `${lat}, ${lon}` }] }] }],
  summary: [{ title: "Weather", subtitle: text, value: temp }],
});

async function fetchWeather(cfg) {
  try {
    const res = await fetch(url(cfg), { signal: AbortSignal.timeout(10_000) });
    return res.ok ? format(await res.json()) : null;
  } catch { return null; } // offline, DNS, timeout: stay quiet and keep the last card until the next try
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = config();
  runPlugin({
    manifest: MANIFEST,
    start(send) {
      const refresh = async () => { const w = await fetchWeather(cfg); if (w) send("card.module.set", cardParams(w, cfg)); };
      refresh();
      const timer = setInterval(refresh, REFRESH_MS);
      return () => clearInterval(timer);
    },
  });
}
