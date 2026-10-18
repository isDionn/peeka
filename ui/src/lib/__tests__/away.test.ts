import { describe, expect, it } from "vitest";
import { awayLabel, createAway } from "../away";

describe("createAway", () => {
  it("what existed at the start doesn't count; what arrives during the absence becomes a summary when it ends", () => {
    const a = createAway();
    expect(a.sync(true, ["n1"], [])).toBeNull();
    expect(a.sync(true, ["n1", "n2", "n3"], ["o1"])).toBeNull();
    a.done(); a.done();
    expect(a.sync(true, ["n1", "n2", "n3"], ["o1"])).toBeNull(); // the same id isn't counted twice
    expect(a.sync(false, ["n1", "n2", "n3"], ["o1"])).toEqual({ notif: 2, approval: 1, done: 2 });
    expect(a.sync(false, [], [])).toBeNull(); // returned once
  });
  it("no summary if nothing arrived; a job done outside the absence doesn't count", () => {
    const a = createAway();
    a.done();
    a.sync(true, [], []);
    expect(a.sync(false, [], [])).toBeNull();
    a.done();
    a.sync(true, [], []);
    expect(a.sync(false, [], [])).toBeNull();
  });
});

describe("awayLabel", () => {
  it("zeros are left out; the generic label gives no counts", () => {
    expect(awayLabel({ notif: 3, approval: 1, done: 2 })).toBe("While you were away: 3 notifications, 1 approval, 2 jobs done");
    expect(awayLabel({ notif: 0, approval: 0, done: 1 })).toBe("While you were away: 1 job done");
    expect(awayLabel({ notif: 3, approval: 1, done: 2 }, true)).not.toMatch(/\d/);
  });
});
