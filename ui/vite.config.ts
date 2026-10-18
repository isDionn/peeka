import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const page = (f: string) => fileURLToPath(new URL(f, import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { rollupOptions: { input: { index: page("index.html"), island: page("island.html"), preview: page("preview.html"), consent: page("consent.html") } } },
  server: { host: "127.1.2.7", port: 5174, strictPort: true },
  // maxWorkers: varsayılan (çekirdek - 1 = 19 jsdom) testleri birbirine aç bırakıyor; 5 sn'lik varsayılan süre ve gerçek zamanlı bekleyen testler yük altında düşüyordu. 8 işçide her koşu yeşil (~45 sn).
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"], exclude: ["e2e/**", "node_modules/**", "dist/**"], maxWorkers: 8 },
});
