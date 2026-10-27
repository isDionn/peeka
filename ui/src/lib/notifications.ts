import type { Notice } from "../bridge";

/** One newest-first group per app; the list keeps the app whose newest notification arrived first. */
export function groupNotifications(items: Notice[]): Notice[][] {
  const groups = new Map<string, Notice[]>();
  for (const item of [...items].sort((a, b) => b.at - a.at)) {
    const key = item.app.toLocaleLowerCase("en-US");
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  return [...groups.values()];
}
