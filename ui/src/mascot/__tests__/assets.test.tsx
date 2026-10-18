// Every mascot artwork file the code can request must exist under public/mascot (a missing body layer leaves only the dark eyes: v0.2.0 bug).
import { render } from "@testing-library/react";
// @ts-expect-error node types are not installed; vitest runs on Node (cwd = ui/)
import { existsSync, readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { Mascot } from "../Mascot";
import { MOODS, type Mood } from "../moods";
import { resetMascotRegistry } from "../useSingleMascot";

afterEach(resetMascotRegistry);

const PUB = "public";
const PARTS = "public/mascot/parts";
const missing = (files: string[]) => [...new Set(files)].filter((f) => !existsSync(f));

it("every image a rendered mascot requests exists (all moods, silhouette and layered sizes)", () => {
  const files: string[] = [];
  for (const mood of Object.keys(MOODS) as Mood[]) for (const size of [24, 40, 96]) {
    const { container, unmount } = render(<Mascot size={size} mood={mood} isMainAssistant still single={false} />);
    for (const im of container.querySelectorAll("img")) {
      const urls = [im.getAttribute("src") ?? "", ...(im.getAttribute("srcset") ?? "").split(",").map((s) => s.trim().split(" ")[0])];
      for (const u of urls) if (u) files.push(PUB + new URL(u, "http://x/").pathname);
    }
    unmount();
  }
  expect(files.some((f) => f.includes("body-"))).toBe(true);
  expect(missing(files)).toEqual([]);
});

it("every part name in moods, ghost.ts literals and index.json exists", () => {
  const src = ["src/mascot/ghost.ts", "src/mascot/moods.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
  const names = [...src.matchAll(/"((?:eye|mouth|fx|hand|body|skirt|tuft)-[a-z0-9-]+|question-sign|blush)"/g)].map((m) => m[1]);
  const index = JSON.parse(readFileSync(PARTS + "/index.json", "utf8"));
  names.push(...Object.keys(index.parts));
  expect(names.length).toBeGreaterThan(30);
  expect(missing(names.map((n) => `${PARTS}/${n}.webp`))).toEqual([]);
});
