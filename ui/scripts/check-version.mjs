// Release gate: the pushed tag (v1.2.3) must equal every version file, else the release fails before anything is built.
// Usage (repo root): node ui/scripts/check-version.mjs v1.2.3
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The versions each file declares; Cargo.toml's is `[workspace.package]`'s line-start `version =` (not a dependency's inline one). */
export function versions({ cargoToml, tauriConf, packageJson }) {
  const ws = cargoToml.split(/^\[/m).find((s) => s.startsWith("workspace.package]")) ?? "";
  return {
    "Cargo.toml": ws.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null,
    "crates/notch-app/tauri.conf.json": JSON.parse(tauriConf).version ?? null,
    "ui/package.json": JSON.parse(packageJson).version ?? null,
  };
}

/** The mismatch messages; empty = the tag matches every file. */
export function mismatches(tag, files) {
  const want = tag.replace(/^v/, "");
  return Object.entries(versions(files)).filter(([, v]) => v !== want).map(([f, v]) => `${f} has ${v ?? "no version"}, tag ${tag} says ${want}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tag = process.argv[2] ?? "";
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const read = (f) => readFileSync(join(root, f), "utf8");
  const bad = /^v\d/.test(tag) ? mismatches(tag, { cargoToml: read("Cargo.toml"), tauriConf: read("crates/notch-app/tauri.conf.json"), packageJson: read("ui/package.json") }) : [`not a version tag: "${tag}"`];
  for (const m of bad) console.error(m);
  if (bad.length) process.exit(1);
  console.log(`${tag} matches every version file`);
}
