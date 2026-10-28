import { describe, expect, it } from "vitest";
import type { ApprovalItem } from "../bridge";
import { STUCK_GENERIC, STUCK_MS, stuckApproval, stuckPeek } from "../lib/stuckApproval";

const ap = (id: string) => ({ id, title: "Run rm -rf build", plugin: { id: "p", name: "P", main: true } }) as ApprovalItem;

describe("stuck approval reminder", () => {
  it("fires once after 3 minutes and not again; an answered approval is forgotten", () => {
    const first = new Map<string, number>(), done = new Set<string>();
    expect(stuckApproval(first, done, [ap("a")], 0)).toBeNull();
    expect(stuckApproval(first, done, [ap("a")], STUCK_MS - 1)).toBeNull();
    expect(stuckApproval(first, done, [ap("a")], STUCK_MS)?.id).toBe("a");
    expect(stuckApproval(first, done, [ap("a")], STUCK_MS * 2)).toBeNull();
    stuckApproval(first, done, [], STUCK_MS * 2);
    expect(first.size + done.size).toBe(0);
  });
  it("is generic text while locked or presenting", () => {
    expect(stuckPeek(ap("a"), true).title).toBe(STUCK_GENERIC);
    expect(stuckPeek(ap("a"), false).title).toContain("rm -rf");
  });
});
