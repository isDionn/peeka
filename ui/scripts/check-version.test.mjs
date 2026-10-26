import { describe, expect, it } from "vitest";
import { mismatches, versions } from "./check-version.mjs";

const cargo = (v) => `[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "${v}"\nedition = "2021"\n\n[workspace.dependencies]\nserde = { version = "1", features = ["derive"] }\nversion = "9.9.9"\n`;
const files = (c, t, p) => ({ cargoToml: cargo(c), tauriConf: JSON.stringify({ productName: "Peeka", version: t }), packageJson: JSON.stringify({ name: "ui", version: p }) });

describe("release tag = every version file", () => {
  it("reads [workspace.package]'s version, not a dependency's", () => {
    expect(versions(files("0.3.5", "0.3.5", "0.3.5"))["Cargo.toml"]).toBe("0.3.5");
  });
  it("passes only when all three match the tag", () => {
    expect(mismatches("v0.3.5", files("0.3.5", "0.3.5", "0.3.5"))).toEqual([]);
    expect(mismatches("v0.3.5", files("0.3.5", "0.3.4", "0.3.5"))).toEqual(["crates/notch-app/tauri.conf.json has 0.3.4, tag v0.3.5 says 0.3.5"]);
    expect(mismatches("v0.3.5", files("0.3.4", "0.3.5", "0.3.6"))).toHaveLength(2);
  });
  it("a file without a version fails", () => {
    expect(mismatches("v1.0.0", { ...files("1.0.0", "1.0.0", "1.0.0"), packageJson: "{}" })).toEqual(["ui/package.json has no version, tag v1.0.0 says 1.0.0"]);
  });
});
