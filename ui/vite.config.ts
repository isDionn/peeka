import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const page = (f: string) => fileURLToPath(new URL(f, import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { rollupOptions: { input: { index: page("index.html"), island: page("island.html"), preview: page("preview.html"), consent: page("consent.html") } } },
  server: { host: "127.1.2.7", port: 5174, strictPort: true },
  // maxWorkers: the default (cores - 1 = 19 jsdom workers) starved the tests; the 5 s default timeout and real-time waits failed under load. With 8 workers every run is green (~45 s).
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], exclude: ["e2e/**", "node_modules/**", "dist/**"], maxWorkers: 8 },
});
