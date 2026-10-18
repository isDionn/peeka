import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Brain, ChevronLeft, ChevronRight, Lock, Moon, PanelBottom, Power, RotateCcw, Search, Settings, SlidersHorizontal } from "lucide-react";
import { bridge, type AppRef, type MonitorInfo, type PinnedApp, type RecentItem, type SearchResult } from "../bridge";
import { fileKind } from "../lib/clip";
import { initial } from "../lib/plugin";
import { AppIcon, HoldButton, Kbd } from "./common";
import { FileIcon } from "./Pano";
import "../fidelity-ayar.css";

const PIN_COUNT = 12;

/** Başlat'ın 12 sabiti: Rust `start_pins` verirse o (Windows 11'de hep boş); boşsa şeridin sabitleri + sıradaki uygulamalar (Peeka'nın kendi listesi, Windows'unki değil). */
function useStartPins(pins: PinnedApp[], apps: AppRef[]): AppRef[] {
  const [own, setOwn] = useState<AppRef[] | null>(null);
  useEffect(() => { bridge.call("start_pins").then(setOwn).catch(() => setOwn(null)); }, []);
  return useMemo(() => {
    if (own?.length) return own.slice(0, PIN_COUNT);
    const seen = new Set<string>();
    return [...pins, ...apps].filter((a) => !seen.has(a.appId) && !!seen.add(a.appId)).slice(0, PIN_COUNT);
  }, [own, pins, apps]);
}

/** Önerilenler satırının sol simgesi: dosyada türüne göre renkli kutu, uygulamada tek renk simge. */
function RecentTile({ r }: { r: RecentItem }) {
  if (r.kind === "app") return r.icon ? <span className="tip"><AppIcon src={r.icon} size={18} /></span> : null;
  return <span className={"tip tip2 k-" + fileKind(r.name)}><FileIcon name={r.name} /></span>;
}

function ResultIcon({ r }: { r: SearchResult }) {
  if (r.kind === "app" || r.kind === "window") return <AppIcon src={r.icon} />;
  if (r.kind === "file") return <FileIcon name={r.title} />;
  return r.kind === "setting" ? <SlidersHorizontal /> : <Brain />;
}

export function StartPanel({ monitor, pins, onClose, onSettings }: { monitor: MonitorInfo; pins: PinnedApp[]; onClose: () => void; onSettings?: () => void }) {
  const [apps, setApps] = useState<AppRef[]>([]);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false); // "Daha fazla": dördün ötesi önerileri aç
  const [all, setAll] = useState(false); // "Tüm uygulamalar": sabit ızgara yerine tam liste
  const [found, setFound] = useState<SearchResult[]>([]);
  const [sel, setSel] = useState(0); // aramada seçili satır: Enter'ın açacağı satır görünür olsun (O7)
  useEffect(() => { bridge.call("list_apps").then(setApps); bridge.call("recent_files").then((r) => setRecent(r.slice(0, 12))).catch(() => undefined); }, []);
  const t = q.trim();
  // arama uygulama, pencere, dosya ve ayar arar (Ctrl+K ile aynı komut); boşken ızgara görünür
  useEffect(() => {
    if (!t) { setFound([]); return; }
    let live = true;
    bridge.call("search", { query: t }).then((r) => { if (live) { setFound(r); setSel(0); } }).catch(() => undefined);
    return () => { live = false; };
  }, [t]);
  const startPins = useStartPins(pins, apps);
  const launch = (appId: string) => { bridge.call("launch_app", { appId }); onClose(); };
  const openFound = (r: SearchResult) => { bridge.call("search_open", { id: r.id }).catch(() => undefined); onClose(); };
  const openRecent = (r: RecentItem) => { bridge.call("open_recent", { id: r.id }).catch(() => undefined); onClose(); };

  return (
    <div className="govde">
      <div className="yazkutu cam">
        <Search className="l3" />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Uygulama, pencere, dosya ya da ayar ara" aria-label="Başlat'ta ara"
          onKeyDown={(e) => {
            if (e.key === "Enter" && found[sel]) openFound(found[sel]);
            else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, Math.min(found.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))); }
          }} />
        <span style={{ margin: "0 6px 0 4px" }}><Kbd keys="Ctrl+K" /></span>
      </div>
      <div className="baslatOrta">
      {t ? (
        <div className="liste cam baslatSonuc" role="group" aria-label="Arama sonuçları" style={{ "--girinti": "36px" } as React.CSSProperties}>
          {found.map((r, i) => (
            <button key={r.id} className={"sat" + (i === sel ? " sec" : "")} onMouseMove={() => setSel(i)} onClick={() => openFound(r)}>
              <ResultIcon r={r} /><span className="metin" style={{ textAlign: "left" }}>{r.title}</span>{r.subtitle && r.kind !== "app" && <span className="t12 l3">{r.subtitle}</span>}
            </button>
          ))}
          {!found.length && <div className="bosSonuc">“{t}” için sonuç yok.</div>}
        </div>
      ) : (
        <>
          <div className="bolumBas">
            <span>{all ? "Tüm uygulamalar" : "Sabitlenmiş"}</span>
            <button className="btn kk cam" aria-expanded={all} onClick={() => setAll(!all)}>{all ? <><ChevronLeft />Sabitlenmiş</> : <>Tüm uygulamalar<ChevronRight /></>}</button>
          </div>
          {all ? (
            <div className="oneriIzgara tumUyg" role="group" aria-label="Tüm uygulamalar">
              {apps.map((a) => (
                <button key={a.appId} className="sat" onClick={() => launch(a.appId)}>
                  <AppIcon src={a.icon} /><span className="metin" style={{ textAlign: "left" }} title={a.name}>{a.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="uygIzgara">
                {startPins.map((a) => (
                  <button key={a.appId} className="uygHucre" onClick={() => launch(a.appId)}>
                    <span className="lt"><AppIcon src={a.icon} /></span><span className="uygAd" title={a.name}>{a.name}</span>
                  </button>
                ))}
              </div>
              {recent.length > 0 && (
                <>
                  <div className="bolumBas"><span>Önerilenler</span>{recent.length > 4 && <button className="btn kk cam" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Daha az" : "Daha fazla"}<ChevronRight /></button>}</div>
                  <div className="oneriIzgara">
                    {(more ? recent : recent.slice(0, 4)).map((r) => (
                      <button key={r.id} className="sat" onClick={() => openRecent(r)}>
                        <RecentTile r={r} /><div className="alt"><div className="metin" title={r.name}>{r.name}</div><div className="t12 l3" title={r.sub}>{r.sub}</div></div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
      </div>
      <div className="basAlt">
        <span className="avatar" aria-hidden="true">{initial(monitor.user)}</span>
        <span className="b6 kullaniciAd" title={monitor.user}>{monitor.user}</span>
        <span style={{ flex: 1 }} />
        <div className="guc">
          <button className="btn kk cam" onClick={() => { bridge.call("power", { action: "lock" }); onClose(); }}><Lock />Kilitle</button>
          <button className="btn kk cam" onClick={() => { bridge.call("power", { action: "sleep" }); onClose(); }}><Moon />Uyku</button>
          <HoldButton label="Yeniden başlat" icon={<RotateCcw />} onDone={() => bridge.call("power", { action: "restart" })} />
          <HoldButton label="Kapat" icon={<Power />} danger onDone={() => bridge.call("power", { action: "shutdown" })} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ display: "flex", gap: 14 }}>
          {onSettings && <button className="kucukLink" onClick={onSettings}><Settings />Peeka ayarları</button>}
          <button className="kucukLink" onClick={() => { bridge.call("restore_taskbar"); onClose(); }}><PanelBottom />Görev çubuğunu geri getir</button>
        </span>
        <button className="kucukLink" onClick={() => { bridge.call("open_start_menu").catch(() => undefined); onClose(); }}>Windows Başlat'ı aç<ArrowUpRight /></button>
      </div>
    </div>
  );
}
