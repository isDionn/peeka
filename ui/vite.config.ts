import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const page = (f: string) => fileURLToPath(new URL(f, import.meta.url));
// The build's identity (brand file, same as Rust's build.rs): `NOTCH_BRAND` relative to the repo root, else brand/peeka.json.
const brand = JSON.parse(readFileSync(page("../" + (process.env.NOTCH_BRAND ?? "brand/peeka.json")), "utf8"));
// `hide`: parts of the UI a brand leaves out (Peeka: none); the same ids as `Hidden` in src/brand.ts, an unknown one stops the build
const HIDE = ["module.claude", "module.usage", "module.cc", "settings.agent-hooks", "settings.about-line", "settings.demo", "settings.intro"];
const badHide = (brand.hide ?? []).filter((h: string) => !HIDE.includes(h));
if (badHide.length) throw new Error(`brand: unknown hide id ${badHide.join(", ")}`);

export default defineConfig({
  plugins: [react()],
  define: { __BRAND__: JSON.stringify({ exeName: brand.exe_name, hookArg: brand.hook_arg, updatesUrl: brand.updates_url, productName: brand.product_name, mascot: brand.mascot ?? true, hide: brand.hide ?? [] }) },
  clearScreen: false,
  build: { rollupOptions: { input: { index: page("index.html"), island: page("island.html"), preview: page("preview.html"), consent: page("consent.html") } } },
  server: { host: "127.1.2.7", port: 5174, strictPort: true },
  // maxWorkers: the default (cores - 1 = 19 jsdom workers) starved the tests; the 5 s default timeout and real-time waits failed under load. With 8 workers every run is green (~45 s).
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], exclude: ["e2e/**", "node_modules/**", "dist/**"], maxWorkers: 8 },
});
