// Mascot preview page (for headless Playwright frames).
// Default: every mood x {20, 28, 40 hanging, 56}. ?still a still frame, ?mood=x one mood, ?view=fx behavior page (badge, shake, sparkle, gaze, swallow, daze, strip).
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../notch.css";
import { Mascot, type MascotHandle } from "./Mascot";
import { MOODS, type Mood } from "./moods";

const q = new URLSearchParams(location.search);
const still = q.has("still");
const only = q.get("mood");
const moods = (only ? [only] : Object.keys(MOODS)) as Mood[];
const SIZES = [20, 28, 40, 56];

function Grid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px repeat(4, 1fr)", gap: 8, padding: 16, background: "var(--card)", width: "max-content" }}>
      {moods.map((m) => (
        <div key={m} data-row={m} style={{ display: "contents" }}>
          <span style={{ color: "var(--l2)", alignSelf: "center" }}>{m}</span>
          {SIZES.map((s) => (
            <div key={s} data-cell={`${m}-${s}`} style={{ width: 96, height: 90, display: "grid", placeItems: s === 40 ? "start center" : "center", background: s === 20 ? "var(--strip)" : "var(--card2)", borderRadius: 12, paddingTop: s === 40 ? 0 : undefined }}>
              <Mascot size={s} mood={m} isMainAssistant single={false} still={still} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const box = { background: "var(--card2)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8, alignItems: "center", minWidth: 170 } as const;
const btn = { font: "inherit", color: "var(--l1, #fff)", background: "rgba(255,255,255,.12)", border: 0, borderRadius: 8, padding: "4px 10px", cursor: "pointer" } as const;
const kbd = { font: "600 10px system-ui", background: "rgba(255,255,255,.18)", borderRadius: 4, padding: "1px 5px", color: "#fff" } as const;

function Fx() {
  const [mood, setMood] = useState<Record<string, Mood>>({ perm: "idle", err: "idle", done: "idle", sw: "idle", st: "idle" });
  const set = (k: string, m: Mood) => setMood((s) => ({ ...s, [k]: m }));
  const touch = useRef<MascotHandle>(null), swallow = useRef<MascotHandle>(null), strip = useRef<MascotHandle>(null), idle = useRef<MascotHandle>(null);
  const [drops, setDrops] = useState(0);
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => { const f = (e: PointerEvent) => setCur({ x: e.clientX, y: e.clientY }); addEventListener("pointermove", f); return () => removeEventListener("pointermove", f); }, []);
  const [run, setRun] = useState("");
  const [hit, setHit] = useState("");
  const cycle = (k: string, a: Mood, b: Mood) => <button style={btn} data-act={k} onClick={() => set(k, mood[k] === a ? b : a)}>{a} / {b}</button>;
  return (
    <div style={{ padding: 16, background: "var(--card)", color: "var(--l1, #fff)", display: "flex", flexDirection: "column", gap: 12, width: 1000 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={box} data-box="perm"><b>Approval: badge + amber light</b>
          <Mascot size={56} mood={mood.perm} isMainAssistant single={false} badgeHint={<span style={kbd}>Y</span>} />
          {cycle("perm", "idle", "approval")}
        </div>
        <div style={box} data-box="err"><b>Error shake</b>
          <Mascot size={56} mood={mood.err} isMainAssistant single={false} />
          {cycle("err", "idle", "error")}
        </div>
        <div style={box} data-box="done"><b>Done sparkle</b>
          <Mascot size={56} mood={mood.done} isMainAssistant single={false} />
          {cycle("done", "idle", "done")}
        </div>
        <div style={box} data-box="gaze"><b>Gaze (follows the mouse)</b>
          <Mascot size={56} mood="idle" isMainAssistant single={false} cursor={cur} />
          <Mascot size={28} mood="idle" isMainAssistant single={false} cursor={cur} />
        </div>
        <div style={box} data-box="sw"><b>File swallow ({drops})</b>
          <Mascot ref={swallow} size={56} mood={mood.sw} isMainAssistant single={false} onFileDrop={() => setDrops((n) => n + 1)} />
          <button style={btn} data-act="swallow" onClick={() => swallow.current?.swallow()}>swallow()</button>
          <span style={{ opacity: .6, fontSize: 11 }}>drop a file on it</span>
        </div>
        <div style={box} data-box="daze"><b>Dizzy (96 only)</b>
          <Mascot size={96} mood="sleeping" isMainAssistant single={false} />
          <span style={{ opacity: .6, fontSize: 11 }}>1 click: 800 ms · 3 clicks/1.7 s: 3.3 s</span>
        </div>
        <div style={box} data-box="touch"><b>Touch: slap / love</b>
          <Mascot ref={touch} size={56} mood="idle" isMainAssistant single={false} />
          <div style={{ display: "flex", gap: 6 }}>
            <button style={btn} data-act="slap" onClick={() => touch.current?.slap()}>slap()</button>
            <button style={btn} data-act="love" onClick={() => touch.current?.love()}>love()</button>
          </div>
          <span style={{ opacity: .6, fontSize: 11 }}>click = slap · hover 1.9 s = love</span>
        </div>
        <div style={box} data-box="idle"><b>Idle loop</b>
          <Mascot ref={idle} size={56} mood="idle" isMainAssistant single={false} />
          <button style={btn} data-act="run" onClick={() => setRun(String(idle.current?.running()))}>running()?</button>
          <span data-out="run">{run}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div data-box="strip">
          <b>Strip: 24 px (inside) and 40 px hanging pose (overflows the strip)</b>
          <div style={{ position: "relative", marginTop: 8, width: 420 }}>
            <div data-strip style={{ height: 30, background: "var(--strip, #000)", borderRadius: "0 0 15px 15px", display: "flex", alignItems: "center", gap: 18, padding: "0 14px", overflow: "visible" }}>
              <Mascot size={24} mood={mood.st} isMainAssistant single={false} />
              <Mascot ref={strip} size={40} mood={mood.st} isMainAssistant single={false} onPoke={() => setHit("poke")} />
              <span style={{ opacity: .7, fontSize: 12 }}>Compass ready</span>
            </div>
            <div data-under style={{ marginTop: 6, height: 30, background: "var(--card2)", borderRadius: 8, display: "grid", placeItems: "center", fontSize: 11 }} onPointerDown={() => setHit("area-below")}>area below (clickable)</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {(["idle", "listening", "thinking", "approval", "done", "error", "sleeping"] as Mood[]).map((m) => <button key={m} style={btn} data-st={m} onClick={() => set("st", m)}>{m}</button>)}
            <button style={btn} data-act="hit" onClick={() => { const r = strip.current?.hitRect(); setHit(r ? `${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.width}x${r.height}` : "none"); }}>hitRect()</button>
          </div>
          <div data-out="hit">{hit}</div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(q.get("view") === "fx" ? <Fx /> : <Grid />);
