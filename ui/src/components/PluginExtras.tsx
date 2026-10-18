// Ayarlar › Eklentiler altındaki üç parça (maket aye): Claude Code köprüsü satırı, "İzinlerin geçmişi" ve genel "erişimini geri al".
import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { bridge, type BridgeState, type PermissionEvent } from "../bridge";
import { usePlugins, useSettings } from "../hooks";
import { ageLabel } from "../lib/alerts";
import { flat, pluginName } from "../lib/plugin";
import { scopeInfo } from "../lib/scopes";
import { HoldButton, NO_INDENT } from "./common";
import "../fidelity-ayar.css";

const SUF: Record<string, string> = { a: "ın", ı: "ın", e: "in", i: "in", o: "un", u: "un", ö: "ün", ü: "ün" };
/** Tamlayan eki ("asistanın", "Claude'nin"); ünlü uyumu son ünlüye göre. */
export const genitive = (n: string): string => {
  const v = [...n.toLocaleLowerCase("tr")].reverse().find((c) => c in SUF);
  return `${n}'${/[aeıioöuü]$/i.test(n) ? "n" : ""}${v ? SUF[v] : "ın"}`;
};

export const bridgeSub = (s: BridgeState): string => {
  const ev = s.lastEventAgoS === null ? "" : ` · son olay ${ageLabel(s.lastEventAgoS)} önce`;
  return s.installed ? `Kurulu · ${s.healthy ? "bu Peeka'ya bağlı" : "başka bir kopyayı gösteriyor"}${ev}` : "Kurulu değil";
};

/**
 * Claude Code hook köprüsü: durum (kurulu mu, bu Peeka'yı mı gösteriyor, son olay) ve tek düğme. Satır yalnız Rust `claude_bridge_state` cevap verirse çizilir (uydurma durum yok).
 * Düğme yalnız elle tıklanınca çalışır; demo kipinde kapalı (Rust da reddeder). Düğme sabit genişlikte: etiket değişince satır kaymaz. Hata nedeni Rust bildirimiyle gelir.
 */
function BridgeRow() {
  const [st, setSt] = useState<BridgeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const demo = !!useSettings()?.demo;
  useEffect(() => { bridge.call("claude_bridge_state").then(setSt).catch(() => undefined); }, []);
  if (!st) return null;
  const ok = st.installed && st.healthy;
  const run = () => {
    setBusy(true); setFailed(false);
    bridge.call(ok ? "claude_bridge_remove" : "claude_bridge_install").then(setSt, () => setFailed(true)).finally(() => setBusy(false));
  };
  return (
    <div className="liste cam" style={NO_INDENT}>
      <div className="sat">
        <div style={{ flex: 1 }}><div>Claude Code köprüsü</div><div className="t12 l3 b4" role="status">{failed ? "Yapılamadı: nedeni bildirimde" : bridgeSub(st)}</div></div>
        <span style={{ color: ok ? "var(--yesil)" : "var(--turuncu)", display: "grid" }} role="img" aria-label={ok ? "Sağlıklı" : "Sorunlu"}>{ok ? <CircleCheck /> : <TriangleAlert />}</span>
        <button className="btn kk cam" style={{ width: 92 }} disabled={busy || demo} title={demo ? "Demo kipinde kurulmaz" : undefined} onClick={run}>{!st.installed ? "Kur" : st.healthy ? "Kaldır" : "Yeniden kur"}</button>
      </div>
    </div>
  );
}

function History() {
  const [rows, setRows] = useState<PermissionEvent[] | null>(null);
  useEffect(() => { bridge.call("permission_history").then(setRows).catch(() => setRows([])); }, []);
  const now = Date.now();
  return (
    <div className="liste cam izinGecmis" style={NO_INDENT} aria-label="İzinlerin geçmişi">
      {rows && rows.length === 0 && <div className="sat"><span className="l3">Henüz kayıt yok.</span></div>}
      {rows?.map((r, i) => (
        <div className="sat" key={i}>
          <div style={{ flex: 1 }}><div>{flat(r.plugin, 64)}: {scopeInfo(r.scope).text}</div></div>
          <span className="t12 l3">{r.granted ? "verildi" : "geri alındı"} · {ageLabel(Math.max(0, (now - r.at) / 1000))} önce</span>
        </div>
      ))}
    </div>
  );
}

export function PluginExtras() {
  const list = usePlugins();
  const [hist, setHist] = useState(false);
  const main = list.find((p) => p.main);
  const label = main ? `${genitive(pluginName(main))} erişimini geri al` : "Eklentilerin erişimini geri al";
  return (
    <>
      <BridgeRow />
      <div className="ayarAlt">
        <button className="btn kk cam" aria-expanded={hist} onClick={() => setHist(!hist)}>İzinlerin geçmişi</button>
        {list.length > 0 && <HoldButton danger label={label} icon={<X />} onDone={() => list.forEach((p) => bridge.call("plugin_remove", { id: p.id }))} />}
      </div>
      {hist && <History />}
    </>
  );
}
