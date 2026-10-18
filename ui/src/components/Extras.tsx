// Wave 5 small peeks (FPV §0i item 12; mockup sarj, pil, bt, zam, g0, g): charging, low battery, Bluetooth headphones, timer, shelf.
// Each has two parts: the strip center (`*Center`) and the peek or card below it (`*Bump`, `ShelfCard`). Data comes from Rust (bridge.ts, status_changed).
import type { CSSProperties } from "react";
import { BatteryCharging, BatteryLow, Download, File, FileImage, FileSpreadsheet, FileText, FileVideo, Headphones, Inbox, Pause, Play, Share, Sparkles, Square, Bell, Timer, TimerOff, Wifi, WifiOff } from "lucide-react";
import { bridge, type PluginInfo, type ShelfItem, type Status, type TimerState } from "../bridge";
import { askLabel, timerLeft, useSecond } from "../hooks";
import { fmtTime } from "../lib/media";
import { flat } from "../lib/plugin";
import { Lead } from "./Plugin";

type Battery = NonNullable<Status["battery"]>;
const noop = () => undefined;
const mmss = (s: number) => fmtTime(Math.ceil(s)); // past an hour: 1:30:00

/* ---- charging ---- */
export const ChargeCenter = ({ b }: { b: Battery }) => <span className="ms"><BatteryCharging /><span className="b6">Charging</span>{b.percent !== null && <span className="l2 num">{b.percent}%</span>}</span>;
/** "About ... until full": just the bar when Windows doesn't give the remaining time. */
export const ChargeBump = ({ b }: { b: Battery }) => (
  <div className="peekBar">
    {b.percent !== null && <span className="miniProgress" style={{ "--y": b.percent / 100 } as CSSProperties}><b /></span>}
    <span className="t12 l2 num">{b.remaining ? `About ${b.remaining} until full` : "Charging"}</span>
  </div>
);

/* ---- low battery ---- */
export const LowBatteryCenter = ({ b }: { b: Battery }) => <span className="ms"><span style={{ color: "var(--orange)" }}><BatteryLow /></span><span className="b6">Battery {b.percent}%</span></span>;
export const LowBatteryBump = ({ b }: { b: Battery }) => (
  <div className="peekBar">
    {b.remaining && <span className="t12 l2 num">About {b.remaining} left</span>}
    <button className="btn kk gray" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:batterysaver" }).catch(noop)}>Battery saver settings</button>
  </div>
);

/* ---- Bluetooth headphones: no case battery; no peek for devices that don't report battery ---- */
export const BtCenter = ({ name }: { name: string }) => <span className="ms"><Headphones /><span className="b6">{flat(name, 40)} connected</span></span>;
export const BtBump = ({ battery }: { battery: number }) => (
  <div className="peekBar">
    <span className="t12 l2 num">Battery {Math.round(battery)}%</span>
    <span className="miniProgress" style={{ "--y": battery / 100, width: 56 } as CSSProperties}><b /></span>
  </div>
);

/* ---- timer ---- */
export function TimerCenter({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  return <span className="ms"><Timer /><span className="b6 counter" style={{ minWidth: fmtTime(t.totalS).length + "ch" }}>{mmss(timerLeft(t, now))}</span><span className="l3">{flat(t.label, 24)}</span></span>;
}
export function TimerBump({ t }: { t: TimerState }) {
  const now = useSecond(t.running);
  const y = t.totalS > 0 ? Math.min(1, timerLeft(t, now) / t.totalS) : 0;
  const ctl = (action: "pause" | "resume" | "add5" | "stop") => () => bridge.call("timer_control", { action }).catch(noop);
  return (
    <div className="peekBar">
      <span className="miniProgress" style={{ "--y": y } as CSSProperties}><b /></span>
      <button className="mini filled" title={t.running ? "Pause" : "Resume"} aria-label={t.running ? "Pause" : "Resume"} onClick={ctl(t.running ? "pause" : "resume")}>{t.running ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button>
      <button className="btn kk gray" onClick={ctl("add5")}>+5 min</button>
      <button className="mini" title="Stop" aria-label="Stop" onClick={ctl("stop")}><Square /></button>
    </div>
  );
}

/* ---- timer done (decision 2026-10-17: no sound, stays until the owner closes it) ---- */
export const TimerDoneCenter = ({ label }: { label: string | null }) => <span className="ms"><TimerOff /><span className="b6">Time's up</span>{label && <span className="l3">{flat(label, 24)}</span>}</span>;
/** "+5 min": tries `timer_control add5` first; if Rust refuses on a finished timer, a new 5 min timer starts with the same name. */
export function TimerDoneBump({ label, onDone }: { label: string; onDone: () => void }) {
  const add5 = () => { onDone(); bridge.call("timer_control", { action: "add5" }).catch(() => bridge.call("timer_start", { label, seconds: 300 }).catch(noop)); };
  const stop = () => { onDone(); bridge.call("timer_control", { action: "stop" }).catch(noop); };
  return (
    <div className="peekBar">
      <span className="t12 l2">{label ? `${flat(label, 24)} is done` : "Timer done"}</span>
      <button className="btn kk gray" onClick={add5}>+5 min</button>
      <button className="btn kk" onClick={stop}>Close</button>
    </div>
  );
}

/* ---- connection lost / back (separate from the assistant's "Offline mode") ---- */
export const NetCenter = ({ lost }: { lost: boolean }) => <span className="ms">{lost ? <WifiOff /> : <Wifi />}<span className="b6">{lost ? "Connection lost" : "Back online"}</span></span>;
export const NetBump = ({ lost }: { lost: boolean }) => (
  <div className="peekBar">
    <span className="t12 l2">{lost ? "No internet connection" : "Internet is back"}</span>
    {lost && <button className="btn kk gray" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:network-wifi" }).catch(noop)}>Network settings</button>}
  </div>
);

/* ---- "While you were away" summary: one click opens the notification list ---- */
export const AwayCenter = () => <span className="ms"><Bell /><span className="b6">While you were away</span></span>;
export const AwayBump = ({ text, onOpen }: { text: string; onOpen: () => void }) => (
  <div className="peekBar">
    <button className="btn kk gray" onClick={onOpen}><Bell />{text}</button>
  </div>
);

/* ---- shelf ---- */
const FILE_ICON = { pdf: FileText, video: FileVideo, sheet: FileSpreadsheet, image: FileImage, other: File } as const;
const FILE_TONE = { pdf: "var(--red)", video: "var(--cyan)", sheet: "var(--green)", image: "var(--cyan)", other: "var(--l2)" } as const;

export function ShelfCenter({ main, count }: { main: PluginInfo | null; count: number }) {
  return (
    <span className="ms">
      {main && <Lead plugin={{ id: main.id, name: main.name, main: true }} mascot="ready" size={24} />}
      <Inbox /><span className="b6">Shelf</span>{count > 0 && <span className="l3">{count === 1 ? "1 file" : `${count} files`}</span>}
    </span>
  );
}
/** Two drop targets while a file is dragged onto the island (Rust handles the drop; the UI only draws the targets). */
export const ShelfBump = ({ main }: { main: PluginInfo | null }) => (
  <div className="peekBar">
    {main && <span className="dropSmall"><Sparkles />{askLabel(main)}</span>}
    <span className="dropSmall"><Download />Add to Shelf</span>
  </div>
);

export function ShelfCard({ items, main }: { items: ShelfItem[]; main: PluginInfo | null }) {
  return (
    <div className="body">
      <div className="shelf">
        {items.slice(0, 2).map((f) => {
          const I = FILE_ICON[f.kind];
          return (
            <div className="file plat glass" key={f.id} data-shelf={f.id}>
              <span className="tip" style={{ background: `color-mix(in srgb, ${FILE_TONE[f.kind]} 18%, transparent)`, color: FILE_TONE[f.kind] }}><I /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="b6" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flat(f.name, 60)}</div>
                <div className="t12 l3" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{flat(f.sub, 60)}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <button className="mini" title="Share" aria-label={`${flat(f.name, 60)}, share`} onClick={() => bridge.call("share_open", { id: f.id }).catch(noop)}><Share /></button>
                  {main && <button className="mini ask" title={askLabel(main)} aria-label={`${flat(f.name, 60)}, ${askLabel(main)}`} onClick={() => bridge.call("shelf_ask", { id: f.id }).catch(noop)}><Sparkles /></button>}
                </div>
              </div>
            </div>
          );
        })}
        <div className="drop"><Download />Drop here</div>
      </div>
      {items.length === 0 && <div className="t13 l2 b4">Shelf is empty. Drag a file onto the island to keep it here.</div>}
    </div>
  );
}
