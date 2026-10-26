import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Battery, BatteryCharging, Bluetooth, Brain, Camera, Check, ChevronDown, LoaderCircle, Mic, MicOff, Monitor, Moon, Power, ShieldAlert, Speaker, Sun, Volume2, VolumeX, Wifi, WifiOff } from "lucide-react";
import { bridge, type Audio, type AssistantCounts, type MonitorInfo, type Radio, type Status } from "../bridge";
import { useMainAssistant, usePrivacy, useSurfaces } from "../hooks";
import { pluginName } from "../lib/plugin";
import { Mascot } from "../mascot";
import { NET_LABEL } from "./Strip";
import { Row } from "./common";
import { RadioPicker } from "./RadioPicker";
import "../fidelity-settings.css";

function Slider({ icon, value, label, onChange }: { icon: ReactNode; value: number; label: string; onChange: (v: number) => void }) {
  return (
    <div className="dsat">
      <span className="l2">{icon}</span>
      <input type="range" className="hud" min={0} max={100} value={value} aria-label={label} aria-valuetext={`${value}%`}
        style={{ "--y": value + "%" } as CSSProperties} onChange={(e) => onChange(+e.target.value)} />
      <span className="num b6 t12">{value}</span>
    </div>
  );
}

const HOLD_MS = 520;

/** `onHold`: a press held 0.52 s (a ring fills around the icon after a quiet 120 ms) or Shift+Enter; a short click stays `onClick`. */
function Tile({ icon, title, sub, on, label, onClick, onHold, first }: { icon: ReactNode; title: string; sub: string; on: boolean; label: string; onClick: () => void; onHold?: () => void; first?: boolean }) {
  const [ring, setRing] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const stop = () => { clearTimeout(timer.current); setRing(null); };
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onHold || e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect(), i = e.currentTarget.querySelector("svg")!.getBoundingClientRect();
    setRing({ left: i.left - box.left + i.width / 2 - 16, top: i.top - box.top + i.height / 2 - 16 });
    held.current = false;
    timer.current = setTimeout(() => { held.current = true; setRing(null); onHold(); }, HOLD_MS);
  };
  return (
    <button className={"boxBtn" + (on ? " on" : "") + (ring ? " holding" : "")} aria-pressed={on} aria-label={label} data-autofocus={first ? "" : undefined}
      title={onHold ? `Click to turn ${title} on or off. Press and hold for the list (Shift+Enter).` : undefined}
      onPointerDown={down} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { held.current = false; if (onHold && e.key === "Enter" && e.shiftKey) { e.preventDefault(); onHold(); } }}
      onClick={() => { if (held.current) held.current = false; else onClick(); }}>
      {icon}<span className="t12 b6">{title}</span><span className="t11 l2">{sub}</span>
      {ring && <svg className="holdRing" viewBox="0 0 32 32" aria-hidden="true" style={ring}><circle className="trk" cx="16" cy="16" r="14" /><circle className="arc" cx="16" cy="16" r="14" pathLength="100" /></svg>}
    </button>
  );
}

/** Audio switcher under the volume slider: one fixed 40 px row naming the default output; it opens in place, the device
 * rows go below it in Windows's order (nothing above moves, and a row never jumps after a switch). A refused switch
 * (the undocumented IPolicyConfig) says so in the header's right slot, no extra row. */
function OutputSwitcher({ audio, reload }: { audio: Audio; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = audio.outputs.find((o) => o.default);
  const pick = (id: string) => { setFailed(false); bridge.call("set_audio_output", { id }).then(reload, () => setFailed(true)); };
  return (
    <div className="list glass audioOut" style={{ "--indent": "28px" } as CSSProperties}>
      <button className="row" aria-expanded={open} aria-label={`Audio output, ${current?.name ?? "none"}`} onClick={() => { setOpen(!open); setFailed(false); if (!open) reload(); }}>
        <Speaker /><span className="text">{current?.name ?? "Output"}</span>
        {failed && <span className="t12 l3" role="alert">Couldn't switch</span>}
        <ChevronDown className="chev" aria-hidden="true" />
      </button>
      {open && audio.outputs.map((o) => (
        <button key={o.id} className="row" aria-pressed={o.default} onClick={() => !o.default && pick(o.id)}>
          {o.default ? <Check /> : <span className="tickSlot" />}<span className="text">{o.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Main assistant section (mockup o): titled with the plugin's name; only while a main assistant is connected, and rows with a zero count aren't drawn. The approval count is the plugin's own (`assistant_counts().approvals`), else from the cards on plugin surfaces; job and note counts come from Rust. */
function AssistantSection() {
  const main = useMainAssistant();
  const { approvals } = useSurfaces();
  const [n, setN] = useState<AssistantCounts>({ jobs: 0, memory: 0 });
  useEffect(() => { if (main) bridge.call("assistant_counts").then(setN).catch(() => undefined); }, [main]);
  const waiting = n.approvals ?? approvals.length; // the plugin's own count when it sends one, else the card list
  if (!main || (!waiting && !n.jobs && !n.memory)) return null;
  return (
    <>
      <div className="assistantHead t12 b6 l2"><Mascot size={22} mood="idle" isMainAssistant single={false} still />{pluginName(main)}</div>
      <div className="list glass" style={{ "--indent": "28px" } as CSSProperties}>
        {waiting > 0 && (
          <div className="row"><ShieldAlert className="alertIcon" /><span className="text">{waiting} awaiting approval</span><button className="btn kk primary" onClick={() => bridge.call("assistant_open", { kind: "approval" }).catch(() => undefined)}>Open</button></div>
        )}
        {n.jobs > 0 && <div className="row"><LoaderCircle className="spin" /><span className="text">{n.jobs} running</span></div>}
        {n.memory > 0 && <div className="row"><Brain /><span className="text">{n.memory} suggested notes</span></div>}
      </div>
    </>
  );
}

export function StatusCard({ monitor, status, setStatus, onQuit }: { monitor: MonitorInfo; status: Status; setStatus: (s: Status) => void; /** "Quit Peeka": opens Peeka's quit confirmation (ADR-0062; owner decision 2026-10-17: the second route after the menu). */ onQuit?: () => void }) {
  const denied = monitor.radios === "denied"; // if access was denied the button opens the Windows settings page
  const radio = (kind: "wifi" | "bluetooth", r: Radio) => {
    const page = () => bridge.call("open_windows_settings", { uri: kind === "wifi" ? "ms-settings:network-wifi" : "ms-settings:bluetooth" });
    if (denied) page();
    else bridge.call("set_radio", { kind, on: !r.on }).catch(page); // if refused (access, device) the settings page opens
  };
  const { wifi, bluetooth, battery, network } = status;
  const state = (on: boolean) => (on ? "on" : "off");
  const privacy = usePrivacy();
  const firstTile = wifi ? "wifi" : bluetooth ? "bt" : "dnd"; // focus starts on the first tile (mockup o)
  const [audio, setAudio] = useState<Audio | null>(null);
  const loadAudio = () => { bridge.call("audio_get").then(setAudio).catch(() => undefined); };
  useEffect(loadAudio, []); // shortcut: read on open and on the switcher's clicks, not live; poll if the owner notices staleness
  const micMuted = audio?.micMuted ?? null;
  const [pick, setPick] = useState<"wifi" | "bt" | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const closePick = () => { const k = pick; setPick(null); requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[aria-label^="${k === "wifi" ? "Wi-Fi" : "Bluetooth"}"]`)?.focus()); };
  return (
    <div className="body">
      {status.volume !== null && (
        <Slider icon={status.muted ? <VolumeX /> : <Volume2 />} value={status.volume} label="Volume" onChange={(v) => { setStatus({ ...status, volume: v, muted: v === 0 }); bridge.call("set_volume", { value: v }); }} />
      )}
      {audio && audio.outputs.length > 1 && <OutputSwitcher audio={audio} reload={loadAudio} />}
      {status.brightness !== null && ( // live value: null when brightness can't be read
        <Slider icon={<Sun />} value={status.brightness} label="Brightness" onChange={(v) => { setStatus({ ...status, brightness: v }); bridge.call("set_brightness", { value: v }); }} />
      )}
      <div className="controlGrid" ref={grid}>
        {wifi && <Tile first={firstTile === "wifi"} icon={wifi.on ? <Wifi /> : <WifiOff />} title="Wi-Fi" sub={wifi.on ? wifi.name ?? "On" : "Off"} on={wifi.on} label={`Wi-Fi, ${state(wifi.on)}${wifi.name ? ", " + wifi.name : ""}`} onClick={() => radio("wifi", wifi)} onHold={() => setPick("wifi")} />}
        {bluetooth && <Tile first={firstTile === "bt"} icon={<Bluetooth />} title="Bluetooth" sub={bluetooth.on ? bluetooth.name ?? "On" : "Off"} on={bluetooth.on} label={`Bluetooth, ${state(bluetooth.on)}${bluetooth.name ? ", " + bluetooth.name : ""}`} onClick={() => radio("bluetooth", bluetooth)} onHold={() => setPick("bt")} />}
        <Tile first={firstTile === "dnd"} icon={<Moon />} title="Do not disturb" sub={status.dnd ? "On" : "Off"} on={status.dnd} label={`Do not disturb, ${state(status.dnd)}`} onClick={() => { setStatus({ ...status, dnd: !status.dnd }); bridge.call("set_dnd", { on: !status.dnd }); }} />
      </div>
      {pick && <RadioPicker key={pick} kind={pick} onClose={closePick} />}
      <div className="list glass" style={{ "--indent": "28px" } as CSSProperties}>
        {network !== "internet" && ( // no row when all is well (mockup): only connection problems are shown
          <div className="row">
            {network === "none" ? <WifiOff /> : <Wifi />}
            <span className="text">{NET_LABEL[network]}</span>
          </div>
        )}
        {battery && (
          <div className="row">
            {battery.charging ? <BatteryCharging /> : <Battery />}
            <span className="text">{battery.percent === null ? "Battery" : `Battery ${battery.percent}%`}</span>
            <span className="t12 l3">{battery.charging ? "Charging" : battery.remaining ?? ""}</span>
          </div>
        )}
        <div className="row">
          {micMuted ? <MicOff /> : <Mic />}<span className="text">Microphone</span><span className="t12 l3">{privacy.mic.length ? "In use" : "Not in use"}</span>
          {micMuted !== null && (
            <button className="btn kk glass micMute" aria-label="Mute microphone" aria-pressed={micMuted}
              onClick={() => { setAudio({ ...audio!, micMuted: !micMuted }); bridge.call("set_mic_muted", { muted: !micMuted }).catch(loadAudio); }}>
              {micMuted ? <MicOff /> : <Mic />}
            </button>
          )}
        </div>
        <div className="row"><Camera /><span className="text">Camera</span><span className="t12 l3">{privacy.camera.length ? "In use" : "Not in use"}</span></div>
        <div className="row"><Monitor /><span className="text">Screen sharing</span><span className="t12 l3">{privacy.screen ? "On" : "Off"}</span></div>
      </div>
      <AssistantSection />
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 12px" }}>
        <button className="smallLink" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:quiethours" })}>Windows Focus settings<ArrowUpRight /></button>
        <button className="smallLink" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:" })}>Windows settings<ArrowUpRight /></button>
      </div>
      {onQuit && (
        <div className="list glass" style={{ "--indent": "28px" } as CSSProperties}>
          <Row title="Quit Peeka"><button className="btn kk glass destructive" aria-label="Quit Peeka" onClick={onQuit}><Power />Quit</button></Row>
        </div>
      )}
    </div>
  );
}
