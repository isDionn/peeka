import { describe, expect, it } from "vitest";
import { createFakeBridge } from "../bridge.fake";
import { COMMAND_NAMES } from "../commands.generated";

describe("Rust contract", () => {
  it("the fake bridge's commands exactly match Rust's list (commands.generated.ts)", () => {
    const want = [...COMMAND_NAMES].sort();
    expect([...createFakeBridge().commands].sort()).toEqual(want);
  });
});
