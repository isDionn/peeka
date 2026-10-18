// Eklenti onay penceresi (ADR-0062 §4.5, maket `eo`): Peeka çizer, eklentiden yalnız ad, yayıncı, sürüm, kimlik ve `why` düz metin alınır.
// Dokuz madde: Peeka simgesi ve başlık; baş harf karosu + ad + sürüm + kimlik + yayıncı; program yolu ve imza; benzer ad uyarısı;
// üç düzeyde kapsam; hiç verilmeyenler; ağ cümlesi; Reddet (varsayılan odak, Esc) ve İzin ver (ilk 300 ms yok sayılır); 2 dk sonra Reddet.
import { useEffect, useRef, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { bridge, type ConsentRequest } from "../bridge";
import { useSecond } from "../hooks";
import { flat, plain } from "../lib/plugin";
import { scopeInfo, type Level } from "../lib/scopes";
import { useGuard } from "../lib/useGuard";
import { NotchIk } from "./IslandCards";
import { Panel } from "./common";

const GROUPS: [Level, string][] = [["low", "Düşük"], ["medium", "Orta"], ["high", "Yüksek"]];
const RISK_NOTE = "Risk düzeyini eklenti söyler, Peeka doğrulayamaz.";
/** "C:\Program Files\Pusula\pusula.exe" -> "C:\…\Pusula\pusula.exe" (sürücü ve son iki parça). */
const shortPath = (p: string) => { const a = plain(p, 260).split("\\"); return a.length > 3 ? [a[0], "…", ...a.slice(-2)].join("\\") : a.join("\\"); };
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function Check({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <span className={"kutucuk" + (on ? " on" : "")} role="checkbox" aria-checked={on} aria-label={label} tabIndex={0}
    onClick={() => onChange(!on)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onChange(!on); } }} />;
}

export function ConsentBody({ req, onClose }: { req: ConsentRequest; onClose: () => void }) {
  const known = req.scopes.map(scopeInfo);
  // düşük ve orta işaretli, yüksek işaretsiz gelir
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(known.map((k) => [k.scope, k.level !== "high"])));
  const [main, setMain] = useState(false);
  const now = useSecond();
  const guard = useGuard(); // "İzin ver": düğmeye bağlı ref ile 600 ms + imleç kuralı (açılış, yay, kayma sonrası)
  const done = useRef(false);
  const left = req.expiresAt - now;
  const wantsMain = req.scopes.includes("composer.handler") || req.scopes.includes("voice.line");
  const name = flat(req.plugin.name, 64) || "Eklenti";

  const finish = (allow: boolean, never = false) => {
    if (done.current) return;
    done.current = true;
    bridge.call("consent_answer", { requestId: req.requestId, allow, scopes: allow ? req.scopes.filter((s) => on[s]) : [], mainAssistant: allow && wantsMain && main, never }).catch(() => undefined).finally(onClose);
  };
  useEffect(() => { if (left <= 0) finish(false); }); // 2 dakikada cevap yoksa Reddet

  return (
    <div className="govde eoGovde" style={{ gap: 10 }}>
      <div className="mkBas"><NotchIk size={32} /><div className="t17 b6" style={{ flex: 1 }}>Yeni eklenti bağlanmak istiyor</div><span className="t12 l3 num eoSayac" role="timer">{mmss(left)} sonra reddedilir</span></div>
      <div className="mkBas" style={{ gap: 10 }}>
        <span className="basHarf" aria-hidden="true">{Array.from(name)[0]?.toLocaleUpperCase("tr")}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="b6">{name} <span className="l3 b4">{plain(req.plugin.version, 24)} · {flat(req.plugin.id, 64)}</span></div>
          <div className="t12 l3 b4" style={{ overflowWrap: "anywhere" }}>Yayıncı: {flat(req.plugin.publisher, 64) || "—"} · doğrulanmadı · Program: {shortPath(req.program.path)} · {req.program.signedBy ? `İmzalı: ${plain(req.program.signedBy, 60)}` : "İmzasız"} · doğrulanmadı</div>
        </div>
      </div>
      {req.lookalike && <div className="eoUyari" role="alert"><TriangleAlert />Bu ad zaten bağlı bir eklentiye benziyor.</div>}
      <div className="liste cam" style={{ "--girinti": "30px" } as React.CSSProperties}>
        {GROUPS.map(([level, title]) => {
          const rows = known.filter((k) => k.level === level);
          return rows.length === 0 ? null : (
            <div key={level}>
              <div className="grupBas">{title}</div>
              {rows.map((k) => (
                <div key={k.scope}>
                  <div className="sat">
                    <Check on={!!on[k.scope]} label={k.text} onChange={(v) => setOn({ ...on, [k.scope]: v })} />
                    <span className="metin" style={{ whiteSpace: "normal" }}>{k.text}{req.why[k.scope] && <> <span className="l3">“{plain(req.why[k.scope], 140)}”</span></>}{k.scope === "approvals.prompt" && <div className="t12 l3 b4">{RISK_NOTE}</div>}</span>
                  </div>
                  {(k.scope === "composer.handler" || k.scope === "voice.line") && (
                    <div className="sat" style={{ "--girinti": "58px" } as React.CSSProperties}>
                      <span style={{ width: 20 }} /><Check on={main} label="Ana asistan yapılsın mı?" onChange={setMain} />
                      <span className="metin" style={{ whiteSpace: "normal" }}>Ana asistan yapılsın mı? <span className="l3">(maskotu ve Ctrl+Space'i alır)</span></span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="t12 l2 b4">Hiçbir eklenti parolalarını, klavye girişini, Peeka ayarlarını göremez ve bilgisayarında komut çalıştıramaz.</div>
      <div className="t12 l3 b4">Bu eklenti kendi internet bağlantısını kullanabilir; Peeka bunu denetleyemez.</div>
      <div className="dugmeler">
        <button className="btn ana eoReddet" data-autofocus onClick={() => finish(false)}><X />Reddet</button>
        <button ref={guard.ref} className="btn cam" data-korumali onClick={guard(() => finish(true))}>İzin ver</button>
        <span style={{ flex: 1 }} />
        <button className="kucukLink" onClick={() => finish(false, true)}>Bu eklentiyi bir daha sorma</button>
      </div>
    </div>
  );
}

/** Onay penceresi sayfası: bekleyen istek yoksa boş; varsa şeridin altında ortada açılan kart. Esc = Reddet. */
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
    <Panel side="center" width={600} label="Eklenti izni" dataKind="consent" open={!!req} onClose={esc}>
      {req && <ConsentBody key={req.requestId} req={req} onClose={() => setReq(null)} />}
    </Panel>
  );
}
