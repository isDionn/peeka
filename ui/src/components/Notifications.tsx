import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Folder, Sparkles, X } from "lucide-react";
import { bridge, type Alert, type Notice } from "../bridge";
import { useAlerts, useInput, useLock, useMainAssistant, useMirror } from "../hooks";
import { sendX } from "../lib/xwin";
import { ageLabel } from "../lib/alerts";
import { AlertIcon } from "../lib/alertIcon";
import { NotchIcon } from "./IslandCards";
import { EmptyBoard } from "./CardsExtra";
import { Lead } from "./Plugin";
import { initial, MASCOT_STATES, pluginName } from "../lib/plugin";
import { delOk, SAFE_ICON } from "./common";

/**
 * The notification has a one-time verification code (`hasCode`): "Copy code" calls `notif_copy_code`; Rust puts the code on the clipboard and clears it after 60 s.
 * The digits never reach the page and are never written here. No button while locked. Failures are silent.
 */
function useCopyCode(n: Notice) {
  const lock = useLock();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 5000); return () => clearTimeout(t); }, [done]);
  return { show: !!n.hasCode && !lock.locked, done, run: () => bridge.call("notif_copy_code", { id: n.id }).then(() => setDone(true)).catch(() => undefined) };
}
const CODE_DONE = "Copied · clears in 60s";

/**
 * R1-5: a removed row's space is held briefly (an empty slot) so the row below doesn't jump under the pointer; repeated "Remove" clicks don't delete the wrong item.
 * The slot closes when the pointer leaves the list or after 600 ms. shortcut: the slot index comes from DOM order at click time; very fast multiple removals can drift, visual only.
 */
const HOLD_MS = 600;
function useHeldSlots() {
  const [holds, setHolds] = useState<{ key: number; at: number; h: number; id: string }[]>([]);
  const seq = useRef(0);
  const release = (key: number) => setHolds((h) => h.filter((x) => x.key !== key));
  const hold = (e: { currentTarget: HTMLElement }, id: string) => {
    const row = e.currentTarget.closest<HTMLElement>(".notif");
    if (!row?.parentElement) return;
    const key = ++seq.current;
    setHolds((h) => [...h, { key, id, at: Array.prototype.indexOf.call(row.parentElement!.children, row), h: row.offsetHeight }]);
    setTimeout(() => release(key), HOLD_MS);
  };
  /** Inserts the held slots into the rows; no slot while the source item is still listed (the removal hasn't returned yet). */
  const fill = (rows: React.ReactElement[]) => {
    const out = [...rows];
    for (const x of [...holds].sort((a, b) => a.at - b.at)) {
      if (rows.some((r) => r.key === x.id)) continue;
      out.splice(Math.min(x.at, out.length), 0, <div key={"bos-" + x.key} className="notifEmpty" style={{ height: x.h }} aria-hidden="true" />);
    }
    return out;
  };
  return { hold, fill, clear: () => setHolds([]) };
}

/** Notifications list (click the clock, top-right card): Peeka's own alert list, monochrome app tile; "Clear all" only empties the list. */
export function NotificationList({ onReview, onClose }: { onReview: (a: Alert) => void; onClose?: () => void }) {
  const { alerts } = useAlerts();
  const mirror = useMirror().items;
  const total = alerts.length + mirror.length;
  const lock = useLock();
  const presenting = useInput().presentation; // presentation mode (row 37): content is hidden the same way as when locked
  const hide = lock.locked || presenting;
  const main = useMainAssistant();
  const nowMs = bridge.now().getTime();
  const held = useHeldSlots();
  const rows = [
    ...alerts.map((a) => (
          <div key={a.id} role="listitem" className="notif plat glass">
            {main && a.icon && MASCOT_STATES.has(a.icon)
              ? <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot={a.icon} size={24} />
              : <span className="app"><AlertIcon name={a.icon} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="b6">{a.title}</div>
              {a.subtitle && <div className="t12 l3 b4">{a.subtitle}</div>}
            </div>
            {a.review ? <button className="btn kk glass" onClick={() => onReview(a)}>Review</button> : <span className="t12 l3">{ageLabel((nowMs - a.updatedAt) / 1000)}</span>}
            {a.action && <button className="mini" title="Open link" aria-label={`${a.title}, open link`} onClick={() => bridge.call("open_alert", { id: a.id }).catch(() => undefined)}><ArrowUpRight /></button>}
            <button className="mini" title="Remove" aria-label={`${a.title}, remove`} onClick={(e) => { if (delOk()) { held.hold(e, a.id); bridge.call("dismiss_alert", { id: a.id }); } }}><X /></button>
          </div>
    )),
    ...mirror.map((n) => <MirrorCard key={n.id} n={n} onClose={onClose} onHold={held.hold} />),
  ];
  return (
    <div className="body">
      <div style={{ display: "flex", alignItems: "center" }}>
        <span className="t17 b6" style={{ flex: 1 }}>Notifications</span>
        <button className="btn kk glass" onClick={() => bridge.call("clear_alerts")}>Clear all</button>
      </div>
      {hide && <div className="noResults" role="status">{lock.locked ? "Peeka is locked" : "Presenting"}: notification content is hidden{total > 0 ? ` (${total})` : ""}</div>}
      {/* while locked only the app name of Windows notifications is drawn; title and body never enter the DOM (Rust still sends them) */}
      {hide && mirror.length > 0 && <div className="notifs" role="list">
        {mirror.map((n) => <div key={n.id} role="listitem" className="notif plat glass"><span className="app"><b aria-hidden="true">{initial(n.app)}</b></span><div style={{ flex: 1, minWidth: 0 }}><div className="b6">{n.app}</div><div className="t12 l3">{lock.locked ? "Locked" : "Hidden"}</div></div></div>)}
      </div>}
      {!hide && total === 0 && <EmptyBoard title="No notifications" hint="You're all caught up. New alerts land here." mood="sleeping" />}
      {!hide && <div className="notifs" role="list" onPointerLeave={held.clear}>{held.fill(rows)}</div>}
    </div>
  );
}

/**
 * Windows notification (Wave 6 mirror): only here, no wave on the strip. The tile is always monochrome (alpha mask, ignores `colorIcons`);
 * the app's initial when there's no icon. Buttons: "Open app" (`canOpen`), "Reply with <assistant>" (main assistant only; the reply view opens when done).
 */
export function MirrorCard({ n, onClose, onHold }: { n: Notice; onClose?: () => void; onHold?: (e: { currentTarget: HTMLElement }, id: string) => void }) {
  const main = useMainAssistant();
  const code = useCopyCode(n);
  const [err, setErr] = useState<string | null>(null);
  const tile = SAFE_ICON.test(n.tile) ? ({ WebkitMaskImage: `url("${n.tile}")`, maskImage: `url("${n.tile}")` } as CSSProperties) : null;
  const ask = () => bridge.call("mirror_ask", { id: n.id }).then(() => { sendX({ t: "ask" }); onClose?.(); }).catch((e) => setErr(e === "not_connected" ? "Main assistant isn't connected" : "Couldn't reply right now"));
  return (
    <div role="listitem" className="notif notifM plat glass" data-mirror={n.id}>
      <span className="app">{tile ? <span className="appIcon mono" style={tile} aria-hidden="true" /> : <b aria-hidden="true">{initial(n.app)}</b>}</span>
      <div className="mBody">
        <div className="t12 l3 b4">{n.app}</div>
        <div className="b6">{n.title}</div>
        {n.body && <div className="t12 l2 mText">{n.body}</div>}
        <div className="mBtn">
          {n.canOpen && <button className="btn kk glass" onClick={() => bridge.call("mirror_open_app", { id: n.id }).then(() => onClose?.()).catch(() => setErr("Couldn't open the app"))}>{n.openLabel}</button>}
          <button className="btn kk glass" disabled={!main} title={main ? undefined : "Main assistant isn't connected"} onClick={ask}>Reply with {main ? pluginName(main) : "assistant"}</button>
          {code.show && <button className="btn kk glass" onClick={code.run}>Copy code</button>}
          {code.done && <span className="t12 l3" role="status">{CODE_DONE}</span>}
          {err && <span className="t12 l3" role="alert">{err}</span>}
        </div>
      </div>
      <button className="mini" title="Remove" aria-label={`${n.app}, ${n.title}, remove`} onClick={(e) => { if (delOk()) { onHold?.(e, n.id); bridge.call("mirror_dismiss", { id: n.id }).catch(() => undefined); } }}><X /></button>
    </div>
  );
}

/** Cleanup approval (`mt`): shows what will be deleted. Clicks in the first 300 ms are ignored; "Cancel" has default focus. */
export function ReviewCard({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const born = useRef(0);
  useEffect(() => { born.current = performance.now(); }, []);
  const r = alert.review!;
  const main = useMainAssistant();
  const confirm = () => {
    if (performance.now() - born.current < 300) return;
    // The plugin does the deleting (Wave 3); in this wave Peeka only removes the alert from the list.
    bridge.call("dismiss_alert", { id: alert.id }).then(onClose);
  };
  return (
    <div className="body">
      <div className="mkHead">
        {main ? <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="approval" size={56} /> : <NotchIcon size={56} />}
        <div style={{ flex: 1 }}><div className="t17 b6">{r.title}</div><div className="t13 l2 b4">{main ? pluginName(main) + " · " : ""}{r.detail}</div></div>
      </div>
      <div className="list glass" style={{ "--indent": "30px" } as React.CSSProperties}>
        {r.items.map((it) => <div key={it.name} className="row"><Folder /><span className="text">{it.name}</span><span className="t12 l3 num">{it.size}</span></div>)}
      </div>
      <div className="buttons">
        <button className="btn primary" onClick={confirm}>Delete</button>
        <button className="btn glass" data-autofocus onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ---- top-right Windows notification card (mockup n, n2): 360 px, closes after 6 s, a thin line at the bottom shows the time left ---- */
function NoticeShell({ children }: { children: React.ReactNode }) {
  return (
    <div id="right" className="dangling toast" data-hit role="dialog" aria-label="Windows notification" style={{ width: 360 }}>
      <div className="cut"><div className="body" style={{ position: "relative" }}>{children}</div></div>
    </div>
  );
}
const Tile = ({ n }: { n: Notice }) => {
  const tile = SAFE_ICON.test(n.tile) ? ({ WebkitMaskImage: `url("${n.tile}")`, maskImage: `url("${n.tile}")` } as CSSProperties) : null;
  return <span className="app">{tile ? <span className="appIcon mono" style={tile} aria-hidden="true" /> : <b aria-hidden="true">{initial(n.app)}</b>}</span>;
};

/** Incoming Windows notification: "Open app", "Reply with <assistant>", close. `onAsk` runs after it's handed to the assistant (draft view). */
export function NoticeToast({ n, onClose, onAsk }: { n: Notice; onClose?: () => void; /** `mirror_ask` returned; `turn` is the assistant's draft turn. */ onAsk?: (turn: number) => void }) {
  const main = useMainAssistant();
  const code = useCopyCode(n);
  return (
    <NoticeShell>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Tile n={n} />
        <div style={{ flex: 1, minWidth: 0 }}><div className="b6">{n.title}</div>{n.body && <div className="t13 l2 b4">{n.body}</div>}</div>
        <span className="t12 l3">now</span>
      </div>
      <div className="buttons">
        {n.canOpen && <button className="btn glass" style={{ flex: 1 }} onClick={() => bridge.call("mirror_open_app", { id: n.id }).then(() => onClose?.()).catch(() => undefined)}>{n.openLabel}</button>}
        <button className="btn assistant" style={{ flex: 1 }} disabled={!main} onClick={() => bridge.call("mirror_ask", { id: n.id }).then((r) => onAsk?.(r.turn)).catch(() => undefined)}><Sparkles />Reply with {main ? pluginName(main) : "assistant"}</button>
        <button className="btn glass icon" title="Close" aria-label="Close" onClick={() => bridge.call("mirror_dismiss", { id: n.id }).then(() => onClose?.()).catch(() => undefined)}><X /></button>
      </div>
      {code.show && <div className="buttons"><button className="btn glass" style={{ flex: 1 }} onClick={code.run}>Copy code</button></div>}
      {code.done && <div className="t12 l3" role="status">{CODE_DONE}</div>}
      <span className="timeLine" style={{ "--dur": "6s" } as CSSProperties} />
    </NoticeShell>
  );
}

/** The assistant's reply draft. Sending is a second step (an assistant desktop task, with approval); without `onSend`, "Send" is disabled (no backend). */
export function NoticeDraft({ n, draft, onClose, onSend, onEdit }: { n: Notice; draft: string; onClose?: () => void; onSend?: () => void; onEdit?: () => void }) {
  return (
    <NoticeShell>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}><Tile n={n} /><div style={{ flex: 1, minWidth: 0 }}><div className="b6">{n.title}</div><div className="t12 l2 b4">Draft</div></div></div>
      <div className="draft glass">{draft}</div>
      {!onSend && <div className="t12 l3">Sending isn't available yet. The assistant will do it in a later step, with your approval.</div>}
      <div className="buttons">
        <button className="btn primary" style={{ flex: 1 }} disabled={!onSend} title={onSend ? undefined : "Sending isn't available yet. The assistant will do it in a later step, with your approval"} onClick={onSend}>Send</button>
        <button className="btn glass" style={{ flex: 1 }} disabled={!onEdit} onClick={onEdit}>Edit</button>
        <button className="btn glass" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
      </div>
    </NoticeShell>
  );
}

/** Draft view: the assistant's reply for that turn streams in via `composer_event`; shows "Drafting…" until done. */
export function NoticeReply({ n, turn, onClose }: { n: Notice; turn: number; onClose: () => void }) {
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    const off = bridge.on("composer_event", (e) => {
      if (e.turn !== turn) return;
      if (e.kind === "delta") setText((t) => t + (e.text ?? ""));
      else setDone(true);
    });
    return () => { off.then((f) => f()); };
  }, [turn]);
  return <NoticeDraft n={n} draft={done || text ? text.trim() || "Couldn't write a draft." : "Drafting…"} onClose={onClose} />;
}
