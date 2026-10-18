// Plugin consent window (ADR-0062 §4.5, mockup `eo`): Peeka draws it; only name, publisher, version, id and `why` come from the plugin, as plain text.
// Nine parts: Peeka icon and title; initial tile + name + version + id + publisher; program path and signature; lookalike-name warning;
// scopes in three levels; what's never granted; the network sentence; Deny (default focus, Esc) and Allow (first 300 ms ignored); auto-Deny after 2 min.
import { useEffect, useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { bridge, type ConsentRequest } from "../bridge";
import { useSecond } from "../hooks";
import { flat, plain } from "../lib/plugin";
import { scopeInfo, type Level } from "../lib/scopes";
import { useGuard } from "../lib/useGuard";
import { NotchIcon } from "./IslandCards";
import { Panel } from "./common";

const GROUPS: [Level, string][] = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
const RISK_NOTE = "The plugin states its own risk level. Peeka can't verify it.";
/** "C:\Program Files\Compass\compass.exe" -> "C:\…\Compass\compass.exe" (drive and last two parts). */
const shortPath = (p: string) => { const a = plain(p, 260).split("\\"); return a.length > 3 ? [a[0], "…", ...a.slice(-2)].join("\\") : a.join("\\"); };
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function Check({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <span className={"checkbox" + (on ? " on" : "")} role="checkbox" aria-checked={on} aria-label={label} tabIndex={0}
    onClick={() => onChange(!on)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onChange(!on); } }} />;
}

export function ConsentBody({ req, onClose }: { req: ConsentRequest; onClose: () => void }) {
  const known = req.scopes.map(scopeInfo);
  // low and medium start checked, high starts unchecked
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(known.map((k) => [k.scope, k.level !== "high"])));
  const [main, setMain] = useState(false);
  const now = useSecond();
  const guard = useGuard(); // "Allow": 600 ms + pointer rule via a ref on the button (after open, spring, shift)
  const done = useRef(false);
  const left = req.expiresAt - now;
  const wantsMain = req.scopes.includes("composer.handler") || req.scopes.includes("voice.line");
  const name = flat(req.plugin.name, 64) || "Plugin";

  const finish = (allow: boolean, never = false) => {
    if (done.current) return;
    done.current = true;
    bridge.call("consent_answer", { requestId: req.requestId, allow, scopes: allow ? req.scopes.filter((s) => on[s]) : [], mainAssistant: allow && wantsMain && main, never }).catch(() => undefined).finally(onClose);
  };
  useEffect(() => { if (left <= 0) finish(false); }); // no answer in 2 minutes: Deny

  return (
    <div className="body consentBody" style={{ gap: 10 }}>
      <div className="mkHead"><NotchIcon size={32} /><div className="t17 b6" style={{ flex: 1 }}>A new plugin wants to connect</div><span className="t12 l3 num consentCountdown" role="timer">Denies in {mmss(left)}</span></div>
      <div className="mkHead" style={{ gap: 10 }}>
        <span className="initials" aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="b6">{name} <span className="l3 b4">{plain(req.plugin.version, 24)} · {flat(req.plugin.id, 64)}</span></div>
          <div className="t12 l3 b4" style={{ overflowWrap: "anywhere" }}>Publisher: {flat(req.plugin.publisher, 64) || "—"} · not verified · Program: {shortPath(req.program.path)} · {req.program.signedBy ? `Signed by: ${plain(req.program.signedBy, 60)}` : "Unsigned"} · not verified</div>
        </div>
      </div>
      {req.lookalike && <div className="consentWarning" role="alert"><TriangleAlert />This name looks like a plugin that's already connected.</div>}
      <div className="list glass" style={{ "--indent": "30px" } as React.CSSProperties}>
        {GROUPS.map(([level, title]) => {
          const rows = known.filter((k) => k.level === level);
          return rows.length === 0 ? null : (
            <div key={level}>
              <div className="groupHead">{title}</div>
              {rows.map((k) => (
                <div key={k.scope}>
                  <div className="row">
                    <Check on={!!on[k.scope]} label={k.text} onChange={(v) => setOn({ ...on, [k.scope]: v })} />
                    <span className="text" style={{ whiteSpace: "normal" }}>{k.text}{req.why[k.scope] && <> <span className="l3">“{plain(req.why[k.scope], 140)}”</span></>}{k.scope === "approvals.prompt" && <div className="t12 l3 b4">{RISK_NOTE}</div>}</span>
                  </div>
                  {(k.scope === "composer.handler" || k.scope === "voice.line") && (
                    <div className="row" style={{ "--indent": "58px" } as React.CSSProperties}>
                      <span style={{ width: 20 }} /><Check on={main} label="Make it the main assistant?" onChange={setMain} />
                      <span className="text" style={{ whiteSpace: "normal" }}>Make it the main assistant? <span className="l3">(gets the mascot and Ctrl+Space)</span></span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="t12 l2 b4">No plugin can see your passwords, keystrokes or Peeka settings, or run commands on your PC.</div>
      <div className="t12 l3 b4">This plugin may use its own internet connection. Peeka can't control that.</div>
      <div className="buttons">
        <button className="btn primary consentDeny" data-autofocus onClick={() => finish(false)}><X />Deny</button>
        <button ref={guard.ref} className="btn glass" data-guarded onClick={guard(() => finish(true))}>Allow</button>
        <span style={{ flex: 1 }} />
        <button className="smallLink" onClick={() => finish(false, true)}>Don't ask again for this plugin</button>
      </div>
    </div>
  );
}

/** Consent window page: empty with no pending request; otherwise a card that opens centered below the strip. Esc = Deny. */
export function ConsentWindow({ req: given }: { req?: ConsentRequest | null }) {
  const [req, setReq] = useState<ConsentRequest | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) return;
    const load = () => bridge.call("consent_get").then(setReq).catch(() => undefined);
    load();
    const off = bridge.on("consent_changed", load);
    return () => { off.then((f) => f()); };
  }, [given]);
  const esc = () => { if (req) bridge.call("consent_answer", { requestId: req.requestId, allow: false, scopes: [], mainAssistant: false, never: false }).catch(() => undefined).finally(() => setReq(null)); };
  return (
    <Panel side="center" width={600} label="Plugin permission" dataKind="consent" open={!!req} onClose={esc}>
      {req && <ConsentBody key={req.requestId} req={req} onClose={() => setReq(null)} />}
    </Panel>
  );
}
