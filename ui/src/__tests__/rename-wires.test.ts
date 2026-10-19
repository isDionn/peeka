// Names that are only joined at run time, so tsc can't check them (v0.2.0 rename: a template-built asset path and
// class names silently pointed at old Turkish names). Reads the sources the way contract.rs does; cwd = ui/.
// @ts-expect-error node types are not installed; vitest runs on Node
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "../commands.generated";

const files = (readdirSync("src", { recursive: true }) as string[]).map((f) => "src/" + f.replace(/\\/g, "/")).filter((f) => !f.includes("__tests__"));
const read = (f: string) => readFileSync(f, "utf8") as string;
const code = files.filter((f) => /\.tsx?$/.test(f)).map((f) => [f, read(f)] as const);
const css = files.filter((f) => f.endsWith(".css")).map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));

describe("rename wires", () => {
  it("every event Rust emits has a bridge.on listener in the UI, and the UI listens to nothing else", () => {
    const heard = new Set(code.flatMap(([, s]) => [...s.matchAll(/bridge\.on\(\s*"([^"]+)"/g)].map((m) => m[1])));
    expect([...heard].sort()).toEqual([...EVENT_NAMES].sort());
  });

  it("every ghost effect gets a styled .fx-<name> wrapper class", () => {
    const ghost = read("src/mascot/ghost.ts");
    const table = ghost.slice(ghost.indexOf("const FX:"), ghost.indexOf("};", ghost.indexOf("const FX:")));
    const keys = [...table.matchAll(/^\s+(\w+): \[/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(10);
    expect(ghost).toContain("`g-fxw fx-${name}`");
    const UNANIMATED = ["amber", "point", "qsign"]; // amber: no mood uses it; point/qsign: M1b hands placed by ghost.ts, not animated; the image still shows and hides
    expect(keys.filter((k) => !UNANIMATED.includes(k) && !defined.has(`fx-${k}`))).toEqual([]);
  });

  it("every literal class in a className is defined in some stylesheet", () => {
    // unstyled hooks for tests and e2e (css-renames "added by integration"), and the panel-<side> modifier nobody styles
    const HOOKS = new Set(["mockCard", "consentDeny", "islandShadow", "runningTimer", "panel-"]);
    const missing = new Set<string>();
    for (const [f, s] of code) {
      // className="a b", className={"a b" + ...}, className={`a ${x}`}: the literal pieces only
      for (const m of s.matchAll(/className=(?:"([^"]*)"|\{"([^"]*)"|\{`([^`]*)`)/g)) {
        // a piece glued to a value ("m" + mode, `k-${kind}`) is a prefix: some class must start with it
        const text = m[1] ?? (m[2] !== undefined ? m[2] + (/\S$/.test(m[2]) ? "${" : "") : m[3]);
        for (const t of text.split(/\s+/)) {
          const prefix = t.includes("${"), c = t.split("${")[0];
          if (!/^-?[A-Za-z_][\w-]*$/.test(c) || HOOKS.has(c)) continue;
          if (prefix ? ![...defined].some((d) => d.startsWith(c)) : !defined.has(c)) missing.add(`${c} (${f})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
