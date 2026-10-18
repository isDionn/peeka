import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowUpRight, Settings, Battery, BatteryCharging, Bluetooth, Brain, Camera, LoaderCircle, Mic, Moon, Power, ShieldAlert, Sun, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { bridge, type AssistantCounts, type MonitorInfo, type Radio, type Status } from "../bridge";
import { useMainAssistant, usePrivacy, useSurfaces } from "../hooks";
import { pluginName } from "../lib/plugin";
import { Mascot } from "../mascot";
import { NET_LABEL } from "./Strip";
import { Row } from "./common";
import "../fidelity-ayar.css";

function Slider({ icon, value, label, onChange }: { icon: ReactNode; value: number; label: string; onChange: (v: number) => void }) {
  return (
    <div className="dsat">
      <span className="l2">{icon}</span>
      <input type="range" className="hud" min={0} max={100} value={value} aria-label={label} aria-valuetext={`%${value}`}
        style={{ "--y": value + "%" } as CSSProperties} onChange={(e) => onChange(+e.target.value)} />
      <span className="num b6 t12">{value}</span>
    </div>
  );
}

function Tile({ icon, title, sub, on, label, onClick, first }: { icon: ReactNode; title: string; sub: string; on: boolean; label: string; onClick: () => void; first?: boolean }) {
  return (
    <button className={"kutuDug" + (on ? " on" : "")} aria-pressed={on} aria-label={label} data-autofocus={first ? "" : undefined} onClick={onClick}>
      {icon}<span className="t12 b6">{title}</span><span className="t11 l2">{sub}</span>
    </button>
  );
}

/** Ana asistan bölümü (maket o): başlığı eklentinin adı; yalnız ana asistan bağlıyken, sayısı sıfır olan satır çizilmez. Onay sayısı eklentinin gönderdiği (`assistant_counts().approvals`), yoksa eklenti yüzeylerindeki kartlardan; iş ve not sayıları Rust'tan. */
function AsistanSection() {
  const main = useMainAssistant();
  const { approvals } = useSurfaces();
  const [n, setN] = useState<AssistantCounts>({ jobs: 0, memory: 0 });
  useEffect(() => { if (main) bridge.call("assistant_counts").then(setN).catch(() => undefined); }, [main]);
  const waiting = n.approvals ?? approvals.length; // the plugin's own count when it sends one, else the card list
  if (!main || (!waiting && !n.jobs && !n.memory)) return null;
  return (
    <>
      <div className="asistanBas t12 b6 l2"><Mascot size={22} mood="idle" isMainAssistant single={false} still />{pluginName(main)}</div>
      <div className="liste cam" style={{ "--girinti": "28px" } as CSSProperties}>
        {waiting > 0 && (
          <div className="sat"><ShieldAlert className="uyariIk" /><span className="metin">{waiting} onay bekliyor</span><button className="btn kk ana" onClick={() => bridge.call("assistant_open", { kind: "approval" }).catch(() => undefined)}>Aç</button></div>
        )}
        {n.jobs > 0 && <div className="sat"><LoaderCircle className="don" /><span className="metin">{n.jobs} iş çalışıyor</span></div>}
        {n.memory > 0 && <div className="sat"><Brain /><span className="metin">{n.memory} not önerisi</span></div>}
      </div>
    </>
  );
}

export function StatusCard({ monitor, status, setStatus, onSettings, onQuit }: { monitor: MonitorInfo; status: Status; setStatus: (s: Status) => void; onSettings?: () => void; /** "Peeka'yı kapat": Peeka'nın çıkış onayını açar (ADR-0062; sahip kararı 2026-10-17: menüden sonra ikinci yol). */ onQuit?: () => void }) {
  const denied = monitor.radios === "denied"; // erişim reddedildiyse düğme Windows ayar sayfasını açar
  const radio = (kind: "wifi" | "bluetooth", r: Radio) => {
    const page = () => bridge.call("open_windows_settings", { uri: kind === "wifi" ? "ms-settings:network-wifi" : "ms-settings:bluetooth" });
    if (denied) page();
    else bridge.call("set_radio", { kind, on: !r.on }).catch(page); // reddedilirse (erişim, aygıt) ayar sayfası açılır
  };
  const { wifi, bluetooth, battery, network } = status;
  const state = (on: boolean) => (on ? "açık" : "kapalı");
  const privacy = usePrivacy();
  const firstTile = wifi ? "wifi" : bluetooth ? "bt" : "dnd"; // açılışta odak ilk karoda (maket o)
  return (
    <div className="govde">
      {status.volume !== null && (
        <Slider icon={status.muted ? <VolumeX /> : <Volume2 />} value={status.volume} label="Ses" onChange={(v) => { setStatus({ ...status, volume: v, muted: v === 0 }); bridge.call("set_volume", { value: v }); }} />
      )}
      {status.brightness !== null && ( // canlı değer: parlaklık okunamıyorsa null gelir
        <Slider icon={<Sun />} value={status.brightness} label="Parlaklık" onChange={(v) => { setStatus({ ...status, brightness: v }); bridge.call("set_brightness", { value: v }); }} />
      )}
      <div className="kontrolIzgara">
        {wifi && <Tile first={firstTile === "wifi"} icon={wifi.on ? <Wifi /> : <WifiOff />} title="Wi-Fi" sub={wifi.on ? wifi.name ?? "Açık" : "Kapalı"} on={wifi.on} label={`Wi-Fi, ${state(wifi.on)}${wifi.name ? ", " + wifi.name : ""}`} onClick={() => radio("wifi", wifi)} />}
        {bluetooth && <Tile first={firstTile === "bt"} icon={<Bluetooth />} title="Bluetooth" sub={bluetooth.on ? bluetooth.name ?? "Açık" : "Kapalı"} on={bluetooth.on} label={`Bluetooth, ${state(bluetooth.on)}${bluetooth.name ? ", " + bluetooth.name : ""}`} onClick={() => radio("bluetooth", bluetooth)} />}
        <Tile first={firstTile === "dnd"} icon={<Moon />} title="Rahatsız etme" sub={status.dnd ? "Açık" : "Kapalı"} on={status.dnd} label={`Rahatsız etme, ${state(status.dnd)}`} onClick={() => { setStatus({ ...status, dnd: !status.dnd }); bridge.call("set_dnd", { on: !status.dnd }); }} />
      </div>
      <div className="liste cam" style={{ "--girinti": "28px" } as CSSProperties}>
        {network !== "internet" && ( // sorun yoksa satır yok (maket): yalnız bağlantı sorunu söylenir
          <div className="sat">
            {network === "none" ? <WifiOff /> : <Wifi />}
            <span className="metin">{NET_LABEL[network]}</span>
          </div>
        )}
        {battery && (
          <div className="sat">
            {battery.charging ? <BatteryCharging /> : <Battery />}
            <span className="metin">{battery.percent === null ? "Pil" : `Pil %${battery.percent}`}</span>
            <span className="t12 l3">{battery.charging ? "Şarj oluyor" : battery.remaining ?? ""}</span>
          </div>
        )}
        <div className="sat"><Mic /><span className="metin">Mikrofon</span><span className="t12 l3">{privacy.mic.length ? `${privacy.mic.join(", ")} dinliyor` : "kullanılmıyor"}</span></div>
        <div className="sat"><Camera /><span className="metin">Kamera</span><span className="t12 l3">{privacy.camera.length ? `${privacy.camera.join(", ")} kullanıyor` : "kullanılmıyor"}</span></div>
      </div>
      <AsistanSection />
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 12px" }}>
        {onSettings && <button className="kucukLink" style={{ flexBasis: "100%", justifyContent: "flex-start" }} onClick={onSettings}><Settings />Peeka ayarları</button>}
        <button className="kucukLink" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:quiethours" })}>Windows Odak ayarları<ArrowUpRight /></button>
        <button className="kucukLink" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:" })}>Windows ayarları<ArrowUpRight /></button>
      </div>
      {onQuit && (
        <div className="liste cam" style={{ "--girinti": "28px" } as CSSProperties}>
          <Row title="Peeka'yı kapat"><button className="btn kk cam yikici" aria-label="Peeka'yı kapat" onClick={onQuit}><Power />Çık</button></Row>
        </div>
      )}
    </div>
  );
}
