import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { bridge } from "../bridge";
import { ext, type ExtGo } from "../ext";
import { request } from "../lib/assistant";
import { sendX } from "../lib/xwin";

/** Y3: one Ctrl+K row from the extension. */
export interface ExtRow { id: string; title: string; kind: string; Icon: LucideIcon; go: () => void }
export const EXT_SEARCH_OFF = "Search is off while the screen is locked, shared or presenting.";
const SHOWN = 5;

/** ext-go to the island (focus first, as the strip button does), then the panel closes. */
const goTo = (g: ExtGo, onClose: () => void) => () => { bridge.call("focus_island").catch(() => undefined).finally(() => sendX({ t: "ext-go", ...g })); onClose(); };

/**
 * The extension's Ctrl+K rows: `lead` (its commands, matched locally) and `tail` (groups asked from the main assistant
 * 200 ms after the last key, never while the privacy gate is closed). Without an extension: nothing, no request.
 */
export function useExtSearch(query: string, main: boolean, onClose: () => void) {
  const x = ext(), s = x?.search;
  const asks = !!s?.groups?.length && main;
  const [priv, setPriv] = useState(false);
  useEffect(() => {
    if (!asks) return;
    bridge.call("plugin_surfaces").then((v) => setPriv(!!v.private)).catch(() => undefined);
    const off = bridge.on("plugin_surfaces_changed", (v) => setPriv(!!v.private));
    return () => { off.then((f) => f()); };
  }, [asks]);
  const q = query.slice(0, 200);
  const want = asks && q.length >= 2 && !priv;
  const [res, setRes] = useState<{ q: string; rows: { title: string; rows: ExtRow[] }[] } | null>(null);
  useEffect(() => {
    if (!want || !s?.groups) return;
    let live = true;
    const t = setTimeout(() => {
      Promise.all(s.groups!.map((g) => request<unknown>(g.method, { query: q }).then(
        (r) => ({ title: g.title, rows: g.toRows(r).slice(0, SHOWN).map((h) => ({ id: h.id, title: h.title, kind: g.kind, Icon: g.icon, go: goTo(h.go, onClose) })) }),
        () => ({ title: g.title, rows: [] }),
      ))).then((rows) => { if (live) setRes({ q, rows }); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [want, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const lq = q.toLocaleLowerCase("en-US");
  const lead: ExtRow[] = x && s?.commands && q.length >= 2
    ? s.commands.filter((c) => `${x.label} ${c.label}`.toLocaleLowerCase("en-US").includes(lq)).map((c) => ({ id: "ext-" + c.id, title: c.label, kind: c.kind, Icon: c.icon, go: goTo(c.go, onClose) }))
    : [];
  const fresh = want && res?.q === q;
  const tail = fresh ? res.rows.filter((g) => g.rows.length > 0) : [];
  const status = !asks || q.length < 2 ? "" : priv ? EXT_SEARCH_OFF : fresh ? "" : "Searching…";
  return { lead, tail, tailCount: tail.reduce((n, g) => n + g.rows.length, 0), status };
}

/** One group of extension rows, styled like Peeka's own results. */
export function ExtGroup({ title, rows, start, cur, idp, onHover }: { title: string; rows: ExtRow[]; start: number; cur: number; idp: string; onHover: (i: number) => void }) {
  return (
    <div role="group" aria-label={title}>
      <div className="groupHead">{title}</div>
      {rows.map((r, k) => {
        const i = start + k;
        return (
          <div key={r.id} id={`${idp}-${i}`} role="option" aria-selected={i === cur} className={"result" + (i === cur ? " selected" : "")} onMouseMove={() => onHover(i)} onClick={r.go}>
            <span className="tile"><r.Icon /></span>
            <span className="name" title={r.title}>{r.title}</span>
            <span className="kind">{r.kind}</span>
            <span className="enter key-hint">Open<kbd>↵</kbd></span>
          </div>
        );
      })}
    </div>
  );
}
