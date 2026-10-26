import type { StartItem } from "../bridge";

/** Start's pinned grid as data (owner 2026-10-26): apps and folders of two or more apps. Pure; Rust cleans what is saved. */

/** A cell's key: an app is in exactly one place, so its id names it; a folder is named by its first app. */
export const keyOf = (it: StartItem) => (it.kind === "app" ? `app:${it.appId}` : `folder:${it.appIds[0]}`);
const appKey = (id: string) => `app:${id}`;

/** Before folders: the grid is just these apps. */
export const derive = (appIds: string[]): StartItem[] => appIds.map((appId) => ({ kind: "app", appId }));

/** The app taken out of wherever it is; a folder left with one app becomes that app, an empty one goes. */
export function withoutApp(items: StartItem[], appId: string): StartItem[] {
  return items.flatMap((it): StartItem[] => {
    if (it.kind === "app") return it.appId === appId ? [] : [it];
    const appIds = it.appIds.filter((a) => a !== appId);
    return appIds.length === it.appIds.length ? [it] : appIds.length === 1 ? [{ kind: "app", appId: appIds[0] }] : appIds.length ? [{ ...it, appIds }] : [];
  });
}

/** An app dropped on a cell: on an app, both become a folder "Folder" in the target's place; on a folder, it joins (last). */
export function dropOnto(items: StartItem[], appId: string, targetKey: string): StartItem[] {
  if (targetKey === appKey(appId)) return items;
  const rest = withoutApp(items, appId);
  const i = rest.findIndex((it) => keyOf(it) === targetKey);
  if (i < 0) return [...rest, { kind: "app", appId }]; // its own folder, dissolved by the take
  const t = rest[i];
  const next: StartItem = t.kind === "app" ? { kind: "folder", name: "Folder", appIds: [t.appId, appId] } : { ...t, appIds: [...t.appIds, appId] };
  return rest.map((it, j) => (j === i ? next : it));
}

/** A cell moved before (or after) another one. An app coming out of a folder lands as a plain app. */
export function moveTo(items: StartItem[], key: string, beforeKey: string, after: boolean): StartItem[] {
  if (key === beforeKey) return items;
  const moving = items.find((it) => keyOf(it) === key);
  const appId = key.startsWith("app:") ? key.slice(4) : null;
  if (!moving && !appId) return items;
  const item: StartItem = moving ?? { kind: "app", appId: appId! };
  const rest = moving ? items.filter((it) => it !== moving) : withoutApp(items, appId!);
  const i = rest.findIndex((it) => keyOf(it) === beforeKey);
  const at = i < 0 ? rest.length : i + (after ? 1 : 0);
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** A folder renamed; a blank name is "Folder" (Rust also cuts it to 40 characters). */
export const rename = (items: StartItem[], key: string, name: string): StartItem[] =>
  items.map((it) => (it.kind === "folder" && keyOf(it) === key ? { ...it, name: name.trim() || "Folder" } : it));
