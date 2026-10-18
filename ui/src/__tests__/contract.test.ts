import { describe, expect, it } from "vitest";
import { createFakeBridge } from "../bridge.fake";
import { COMMAND_NAMES } from "../commands.generated";

describe("Rust sözleşmesi", () => {
  it("sahte köprünün komutları Rust'ın listesi (commands.generated.ts) ile birebir eşit", () => {
    const want = [...COMMAND_NAMES].sort();
    expect([...createFakeBridge().commands].sort()).toEqual(want);
  });
});
