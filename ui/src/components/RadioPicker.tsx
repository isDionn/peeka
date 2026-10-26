import { useEffect, useState, type CSSProperties } from "react";
import { ArrowUpRight, Bluetooth, Check, ChevronUp, Eye, EyeOff, Headphones, Keyboard, Laptop, LoaderCircle, Lock, Smartphone, Wifi, WifiHigh, WifiLow } from "lucide-react";
import { bridge, type BtDevice, type WifiError, type WifiNetwork } from "../bridge";
import "../radios.css";

// The Wi-Fi / Bluetooth lists that open in place under the Status tiles (RC4, ported from ui/concepts/rc4.tsx "radios").
// Rows update in place and never reorder while the list is open (nothing moves under the cursor).

/** `denied` (locked) shows a generic line only: network and device names are content. */
const failNote = (e: unknown, kind: "wifi" | "bt") => (e === "denied" ? "Not available while Peeka is locked." : e === "unsupported" && kind === "wifi" ? "No Wi-Fi adapter found." : "Couldn't read the list.");
export const bars = (signal: number) => (signal < 34 ? 1 : signal < 67 ? 2 : 3);
const BARS = { 1: WifiLow, 2: WifiHigh, 3: Wifi };
const DEV_ICON: Record<BtDevice["kind"], typeof Wifi> = { audio: Headphones, input: Keyboard, phone: Smartphone, computer: Laptop, other: Bluetooth };
const PW_ERR: Record<WifiError, string> = { wrong_password: "Wrong password. Try again.", failed: "Couldn't connect.", unsupported: "Couldn't connect." };

function WifiList({ onState }: { onState: (scanning: boolean) => void }) {
  const [nets, setNets] = useState<WifiNetwork[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    bridge.call("wifi_networks").then(setNets, (e) => setNote(failNote(e, "wifi"))).finally(() => onState(false));
  }, [onState]);
  const close = () => { setAsk(null); setVal(""); setErr(""); setShow(false); };
  const connect = async (ssid: string, password?: string) => {
    setBusy(ssid); setFailed(null);
    const r = await bridge.call("wifi_connect", password === undefined ? { ssid } : { ssid, password }).catch(() => "failed" as WifiError);
    setBusy(null);
    if (r === null) { close(); setNets((n) => n && n.map((x) => ({ ...x, connected: x.ssid === ssid, known: x.known || x.ssid === ssid }))); return; }
    if (password !== undefined || r === "wrong_password") { setAsk(ssid); setErr(password === undefined ? "" : PW_ERR[r]); } // wrong_password without one = "a password is needed"
    else setFailed(ssid);
  };
  const pick = (n: WifiNetwork) => {
    if (n.connected || busy) return;
    if (n.secure && !n.known) { if (ask === n.ssid) close(); else { close(); setAsk(n.ssid); } }
    else { close(); void connect(n.ssid); }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (val.length < 8) return setErr("Wi-Fi passwords have at least 8 characters.");
    const pw = val;
    setVal(""); // the password never stays in state after submit
    void connect(ask!, pw);
  };
  if (!nets) return note ? <div className="t12 l3 pickNote" role="status">{note}</div> : null;
  if (!nets.length) return <div className="t12 l3 pickNote" role="status">No networks found.</div>;
  return (
    <div className="list glass" style={{ "--indent": "40px" } as CSSProperties}>
      {nets.map((n) => {
        const b = bars(n.signal), B = BARS[b];
        const state = n.connected ? "Connected" : busy === n.ssid ? "Connecting…" : failed === n.ssid ? "Couldn't connect" : "";
        return (
          <div key={n.ssid} className="netItem">
            <button className="row" aria-expanded={n.secure && !n.known && !n.connected ? ask === n.ssid : undefined} onClick={() => pick(n)}
              aria-label={`${n.ssid}, ${["weak", "good", "strong"][b - 1]} signal${n.secure ? ", secured" : ", open"}${state ? ", " + state : ""}`}>
              <span className="bars">{b < 3 && <Wifi className="fan" />}<B /></span><span className="text">{n.ssid}</span>
              <span className="t12 l3 netState">{state}</span>{n.secure ? <Lock className="lockI" aria-hidden="true" /> : <span className="lockI" />}
              {n.connected ? <Check className="netCheck" /> : busy === n.ssid ? <LoaderCircle className="spin netCheck" /> : <span className="netCheck" />}
            </button>
            {ask === n.ssid && (
              <form className="pwForm" onSubmit={submit} onKeyDownCapture={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } }}>
                <label className="t12 l2" htmlFor="pkPw">Password for {n.ssid}</label>
                <div className="pwField">
                  <input id="pkPw" type={show ? "text" : "password"} value={val} autoFocus autoComplete="off" spellCheck={false} aria-invalid={!!err} aria-describedby="pkPwHint"
                    onChange={(e) => { setVal(e.target.value); setErr(""); }} />
                  <button type="button" className="pwEye" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button>
                </div>
                <div id="pkPwHint" className={"t11 " + (err ? "pwErr" : "l3")} role={err ? "alert" : undefined}>{err || "Windows keeps the password, Peeka never stores it."}</div>
                <div className="pwActions"><button type="button" className="btn kk glass" onClick={close}>Cancel</button><button type="submit" className="btn kk primary" disabled={!val || !!busy}>Connect</button></div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BtList() {
  const [devs, setDevs] = useState<BtDevice[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // a fresh read merged into the current order: rows never jump
  const load = () => bridge.call("bt_devices").then((fresh) => setDevs((cur) => (cur ? cur.map((d) => fresh.find((f) => f.id === d.id) ?? d) : fresh)), (e) => setNote(failNote(e, "bt")));
  useEffect(() => { void load(); }, []);
  const flip = async (d: BtDevice) => {
    setBusy(d.id); setFailed(null);
    const ok = await bridge.call("bt_set", { id: d.id, connect: !d.connected }).then(() => true, () => false);
    if (ok) await new Promise((r) => setTimeout(r, 1200)); // the state change arrives later (bt_set docs)
    await load();
    setBusy(null);
    if (!ok) setFailed(d.id);
  };
  if (!devs) return note ? <div className="t12 l3 pickNote" role="status">{note}</div> : null;
  if (!devs.length) return <div className="t12 l3 pickNote" role="status">No paired devices.</div>;
  const other = devs.some((d) => d.kind !== "audio");
  return (
    <>
      <div className="list glass" style={{ "--indent": "40px" } as CSSProperties}>
        {devs.map((d) => {
          const I = DEV_ICON[d.kind], audio = d.kind === "audio";
          const sub = busy === d.id ? (d.connected ? "Disconnecting…" : "Connecting…") : failed === d.id ? "Couldn't change it" : d.connected ? (d.battery !== null ? `Connected, battery ${d.battery}%` : "Connected") : "Paired, not connected";
          return (
            <div className="row" key={d.id}>
              <I /><span className="text"><span className="devName">{d.name}</span><span className="t12 l3 devSub">{sub}</span></span>
              <button className="btn kk glass devBtn" disabled={!audio || busy === d.id} title={audio ? undefined : "Windows connects this device itself"} aria-label={`${d.connected ? "Disconnect" : "Connect"} ${d.name}`} onClick={() => void flip(d)}>
                {busy === d.id ? <LoaderCircle className="spin" /> : d.connected ? "Disconnect" : "Connect"}
              </button>
            </div>
          );
        })}
      </div>
      {other && <div className="t11 l3 pickNote">Peeka connects audio devices. Others connect by themselves or in Bluetooth settings.</div>}
    </>
  );
}

export function RadioPicker({ kind, onClose }: { kind: "wifi" | "bt"; onClose: () => void }) {
  const [scan, setScan] = useState(true);
  return (
    <div className="pkPick" role="group" aria-label={kind === "wifi" ? "Wi-Fi networks" : "Bluetooth devices"}
      // capture: the panel's own Esc (focus trap, a native listener) would close the whole Status card first
      onKeyDownCapture={(e) => {
        if (e.key !== "Escape" || (e.target as Element).closest?.(".pwForm")) return; // the password form closes itself first
        e.stopPropagation(); e.preventDefault();
        onClose();
      }}>
      <div className="pickHead">
        <span className="t12 b6 l2">{kind === "wifi" ? "Wi-Fi networks" : "Paired devices"}</span>
        {kind === "wifi" && <LoaderCircle className="spin pickScan" data-on={scan ? "" : undefined} aria-label={scan ? "Searching" : undefined} />}
        <button className="pickDone" aria-label="Close list" title="Close list (Esc)" onClick={onClose}><ChevronUp /></button>
      </div>
      {kind === "wifi" ? <WifiList onState={setScan} /> : <BtList />}
      <button className="smallLink pickMore" onClick={() => bridge.call("open_windows_settings", { uri: kind === "wifi" ? "ms-settings:network-wifi" : "ms-settings:bluetooth" })}>{kind === "wifi" ? "Wi-Fi settings" : "Bluetooth settings"}<ArrowUpRight /></button>
    </div>
  );
}
