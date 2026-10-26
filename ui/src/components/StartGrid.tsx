import { useLayoutEffect, useRef, useState } from "react";
import type { AppRef, StartItem } from "../bridge";
import { dropOnto, keyOf, moveTo, rename } from "../lib/startItems";
import { useFocusTrap } from "../lib/useFocusTrap";
import { AppIcon } from "./common";
import "../start-folders.css";

/**
 * Start's pinned grid with folders (owner-approved preview: ui/concepts/start-folders.*). Drag an app onto another app's icon:
 * a folder "Folder"; onto a folder: it joins; to a cell's edge: reorder. A folder opens in place over the grid (name field, its
 * apps); dragging an app out of it closes it and drops the app on the grid (a folder left with one app becomes that app).
 * Tiles never move while a drag hovers; on drop they slide to their new place (FLIP).
 */
export function StartGrid({ items, apps, onChange, onLaunch }: { items: StartItem[]; apps: Map<string, AppRef>; onChange: (next: StartItem[]) => void; onLaunch: (appId: string) => void }) {
  const grid = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<string | null>(null); // the open folder's key
  const folder = items.find((it) => it.kind === "folder" && keyOf(it) === open);
  const drag = useRef<{ key: string; x0: number; y0: number; el: HTMLElement; live: boolean; ghost?: HTMLElement; drop?: { merge: string } | { before: string; after: boolean } } | null>(null);
  const moved = useRef(false); // the click after a drag is not a click

  // FLIP: cells that changed place slide from where they were
  const rects = useRef(new Map<string, DOMRect>());
  const remember = () => { rects.current = new Map([...(grid.current?.querySelectorAll<HTMLElement>(".appCell") ?? [])].map((c) => [c.dataset.key!, c.getBoundingClientRect()])); };
  useLayoutEffect(() => {
    for (const c of grid.current?.querySelectorAll<HTMLElement>(".appCell") ?? []) {
      const b = rects.current.get(c.dataset.key!), a = c.getBoundingClientRect();
      if (b && (b.left !== a.left || b.top !== a.top)) c.animate([{ transform: `translate(${b.left - a.left}px,${b.top - a.top}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.32,.72,0,1)" });
    }
    rects.current.clear();
  }, [items]);
  const change = (next: StartItem[]) => { if (next !== items) { remember(); onChange(next); } };

  const clearHints = () => {
    grid.current?.querySelectorAll(".mergeTarget").forEach((c) => c.classList.remove("mergeTarget"));
    caret.current?.classList.remove("on");
  };
  /** What a drop here would do: merge into a cell (pointer over its icon) or go before/after it (over its edges). */
  const aim = (x: number, y: number) => {
    const d = drag.current!;
    clearHints();
    d.drop = undefined;
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>(".appCell");
    if (!cell || !grid.current?.contains(cell) || cell.dataset.key === d.key) return;
    const lt = cell.querySelector(".lt")!.getBoundingClientRect();
    if (d.key.startsWith("app:") && x > lt.left - 6 && x < lt.right + 6 && y > lt.top - 6 && y < lt.bottom + 6) { // a folder never goes into a folder
      cell.classList.add("mergeTarget");
      d.drop = { merge: cell.dataset.key! };
      return;
    }
    const r = cell.getBoundingClientRect(), g = grid.current.getBoundingClientRect(), after = x > r.left + r.width / 2;
    Object.assign(caret.current!.style, { left: `${(after ? r.right + 2 : r.left - 4) - g.left}px`, top: `${r.top - g.top + (r.height - 40) / 2}px` });
    caret.current!.classList.add("on");
    d.drop = { before: cell.dataset.key!, after };
  };

  const onDown = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".appCell");
    if (!el || e.button !== 0) return;
    drag.current = { key: el.dataset.key!, x0: e.clientX, y0: e.clientY, el, live: false };
    moved.current = false;
    const move = (m: PointerEvent) => {
      const d = drag.current!;
      if (!d.live) {
        if (Math.hypot(m.clientX - d.x0, m.clientY - d.y0) < 5) return;
        d.live = moved.current = true;
        d.el.classList.add("dragging");
        d.ghost = Object.assign(document.createElement("span"), { className: "startGhost" + (d.key.startsWith("folder:") ? " lt folderLt" : "") });
        d.ghost.innerHTML = d.el.querySelector(".lt")!.innerHTML;
        document.body.append(d.ghost);
      }
      Object.assign(d.ghost!.style, { left: `${m.clientX}px`, top: `${m.clientY}px` });
      // out of the open folder card with an app: the folder closes, the drag goes on over the grid
      if (cardRef.current && !cardRef.current.contains(document.elementFromPoint(m.clientX, m.clientY))) setOpen(null);
      aim(m.clientX, m.clientY);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      const d = drag.current!;
      drag.current = null;
      d.ghost?.remove();
      d.el.classList.remove("dragging");
      clearHints();
      setTimeout(() => { moved.current = false; }); // after the click this release makes
      if (!d.live || !d.drop) return;
      change("merge" in d.drop ? dropOnto(items, d.key.slice(4), d.drop.merge) : moveTo(items, d.key, d.drop.before, d.drop.after));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const cardRef = useRef<HTMLDivElement>(null);
  const cell = (it: StartItem, autofocus = false) => {
    const key = keyOf(it);
    const click = () => { if (moved.current) return; if (it.kind === "app") onLaunch(it.appId); else setOpen(key); };
    if (it.kind === "app") {
      const a = apps.get(it.appId);
      if (!a) return null; // not installed any more / the list is still loading
      return (
        <button key={key} data-key={key} className="appCell" data-autofocus={autofocus ? "" : undefined} onClick={click}>
          <span className="lt"><AppIcon src={a.icon} color={a.colorIcon} /></span><span className="appName" title={a.name}>{a.name}</span>
        </button>
      );
    }
    const shown = it.appIds.map((id) => apps.get(id)).filter((a): a is AppRef => !!a);
    return (
      <button key={key} data-key={key} className="appCell" aria-haspopup="dialog" aria-label={`${it.name}, folder, ${it.appIds.length} apps`} onClick={click}>
        <span className="lt folderLt">{shown.slice(0, 4).map((a) => <AppIcon key={a.appId} src={a.icon} color={a.colorIcon} size={14} />)}</span>
        <span className="appName" title={it.name}>{it.name}</span>
      </button>
    );
  };

  return (
    <div className="startGrid" onPointerDown={onDown}>
      <div className="appGrid" ref={grid}>
        {items.map((it) => cell(it))}
        <span className="startCaret" ref={caret} aria-hidden="true" />
      </div>
      {folder?.kind === "folder" && (
        <FolderCard key={open} folder={folder} anchor={grid.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(open!)}"]`) ?? null} grid={grid.current} cardRef={cardRef}
          onRename={(name) => change(rename(items, open!, name))} onClose={() => setOpen(null)}>
          {folder.appIds.map((id, i) => cell({ kind: "app", appId: id }, i === 0))}
        </FolderCard>
      )}
    </div>
  );
}

/** The open folder: a glass card over the grid, grown from its tile; focus stays inside, Esc closes and goes back to the tile. */
function FolderCard({ folder, anchor, grid, cardRef, onRename, onClose, children }: {
  folder: Extract<StartItem, { kind: "folder" }>; anchor: HTMLElement | null; grid: HTMLElement | null; cardRef: React.RefObject<HTMLDivElement | null>;
  onRename: (name: string) => void; onClose: () => void; children: React.ReactNode;
}) {
  const [name, setName] = useState(folder.name);
  const [pos, setPos] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    const host = cardRef.current?.offsetParent as HTMLElement | null;
    if (!host || !grid || !anchor) return;
    const h = host.getBoundingClientRect(), g = grid.getBoundingClientRect(), c = anchor.getBoundingClientRect();
    const left = Math.max(16, Math.min(g.left - h.left + (g.width - 360) / 2, h.width - 376)), top = g.top - h.top + host.scrollTop - 4;
    setPos({ left, top, "--ox": `${c.left + c.width / 2 - h.left - left}px`, "--oy": `${c.top + 20 - h.top + host.scrollTop - top}px` } as React.CSSProperties);
  }, [anchor, grid, cardRef]);
  const save = () => { const n = name.trim() || "Folder"; setName(n); if (n !== folder.name) onRename(n); };
  const close = () => { save(); onClose(); };
  useFocusTrap(cardRef, close);
  return (
    <>
      <div className="startScrim" onPointerDown={close} />
      <div className="startFolder" role="dialog" aria-label={`${folder.name} folder`} ref={cardRef} style={pos}>
        <input className="startFolderName" aria-label="Folder name" spellCheck={false} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); cardRef.current?.querySelector<HTMLElement>(".appCell")?.focus(); } }} />
        <div className="appGrid">{children}</div>
      </div>
    </>
  );
}
