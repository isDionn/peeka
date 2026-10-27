import { describe, expect, it } from "vitest";
import type { Notice } from "../../bridge";
import { groupNotifications } from "../notifications";

const notice = (id: string, app: string, at: number): Notice => ({ id, app, at, title: id, body: null, tile: "", tileMono: true, ripple: false, openLabel: "Open app", canOpen: true });

describe("notification grouping", () => {
  it("keeps newest app groups first and their latest notification first", () => {
    const groups = groupNotifications([notice("older", "Mail", 1), notice("chat", "Chat", 3), notice("latest", "mail", 4)]);
    expect(groups.map((g) => g.map((n) => n.id))).toEqual([["latest", "older"], ["chat"]]);
  });
});
