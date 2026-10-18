// Setup wizard (mockup kur, FPV §0i item 11): three steps, on first run and on request. Step 2 is the mockup's three rows: taskbar, optional notification mirror, Windows banners.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bell, BellOff, CircleCheck, Keyboard, PanelTopClose } from "lucide-react";
import { bridge, type MirrorState } from "../bridge";
import { useSettings } from "../hooks";
import { Kbd, NO_INDENT, Panel, Row, Switch } from "./common";
import "../fidelity-settings.css";

export const SETUP_KEY = "notch.setup";
const OLD_SETUP_KEY = "notch.kurulum"; // the pre-English key: moved to SETUP_KEY once so existing users don't see the wizard again
export const setupDone = () => {
  try {
    if (localStorage.getItem(OLD_SETUP_KEY) === "1") { localStorage.setItem(SETUP_KEY, "1"); localStorage.removeItem(OLD_SETUP_KEY); }
    return localStorage.getItem(SETUP_KEY) === "1";
  } catch { return false; }
};
export const markSetup = () => { try { localStorage.setItem(SETUP_KEY, "1"); } catch { /* no storage: asks on every launch */ } };
export const resetSetup = () => { try { localStorage.removeItem(SETUP_KEY); localStorage.removeItem(OLD_SETUP_KEY); } catch { /* no storage */ } };

const STEPS = 3;

function Step({ n }: { n: number }) {
  const settings = useSettings();
  const [mirror, setMirror] = useState<MirrorState | null>(null);
  useEffect(() => { bridge.call("mirror_state").then(setMirror).catch(() => undefined); }, []);
  const k = settings?.shortcuts;
  if (n === 0) {
    return (
      <>
        <div className="t13 l2 b4">This strip replaces the taskbar: your apps on the left, the island in the middle, the clock and status on the right.</div>
        <div className="list glass" style={{ "--indent": "30px" } as React.CSSProperties}>
          <div className="row"><Keyboard /><span className="text">Search</span>{k && <Kbd keys={k.search} />}</div>
          <div className="row"><Keyboard /><span className="text">Ask the assistant</span>{k && <Kbd keys={k.ask} />}</div>
          <div className="row"><Keyboard /><span className="text">Hide island for now</span>{k && <Kbd keys={k.hide_island} />}</div>
        </div>
      </>
    );
  }
  if (n === 1) {
    const hidden = settings ? settings.taskbarHide !== "off" : true;
    const blocked = !!mirror?.enabled && !!mirror.blocker;
    return (
      <div className="list glass" style={{ "--indent": "30px" } as React.CSSProperties}>
        <div className="row">
          {hidden ? <span className="tick" role="img" aria-label="Done"><CircleCheck /></span> : <PanelTopClose />}
          <div style={{ flex: 1 }}><div>Hide the Windows taskbar</div><div className="t12 l3 b4">To bring it back: {k?.emergency ?? "Ctrl+Alt+Shift+T"}, Start, or right-click the strip</div></div>
          {!hidden && <button className="btn kk glass" onClick={() => bridge.call("taskbar_set_mode", { mode: "full" })}>Hide</button>}
        </div>
        <div className="row">
          <Bell />
          <div style={{ flex: 1 }}><div>Show Windows notifications at top right</div><div className="t12 l3 b4">{blocked ? "Windows didn't allow it, or Developer Mode is off. Details in Settings › Appearance" : "Optional. Needs Developer Mode and Windows permission"}</div></div>
          <Switch on={!!mirror?.enabled} label="Show Windows notifications at top right" onChange={(v) => bridge.call(v ? "mirror_enable" : "mirror_disable").then(setMirror).catch(() => undefined)} />
        </div>
        <div className="row">
          <BellOff />
          <div style={{ flex: 1 }}><div>Turn off Windows banners at bottom right</div><div className="t12 l3 b4">Set per app in Windows settings. Recommended, not done automatically</div></div>
          <button className="btn kk glass" onClick={() => bridge.call("open_windows_settings", { uri: "ms-settings:notifications" }).catch(() => undefined)}>Open settings<ArrowUpRight /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="list glass" style={NO_INDENT}>
      <Row title="You're all set" sub="Change anything later in Peeka settings. Right-click the strip to open them." />
    </div>
  );
}

/** Wizard body. `onDone` runs on "Done" (setup is marked complete) and on any close other than Esc. */
export function SetupWizard({ onDone, startStep = 0 }: { onDone: () => void; /** Preview: shows mockup kur step 2 (0-based 1). */ startStep?: number }) {
  const [n, setN] = useState(startStep);
  const last = n === STEPS - 1;
  const arrived = useRef(0);
  // "Done" appears where "Next" was: a click within 300 ms of reaching the last step (a double-click) doesn't finish the wizard
  const next = () => {
    if (!last) { arrived.current = performance.now(); setN(n + 1); }
    else if (performance.now() - arrived.current >= 300) { markSetup(); onDone(); }
  };
  return (
    <div className="body setup">
      <div className="t17 b6">Setup</div>
      <div className="setupStep"><Step n={n} /></div>
      <div className="steps" role="img" aria-label={`Step ${n + 1} of ${STEPS}`}>{Array.from({ length: STEPS }, (_, i) => <i key={i} className={i === n ? "on" : undefined} />)}</div>
      <div className="buttons" style={{ justifyContent: "flex-end" }}>
        <button className="btn glass" disabled={n === 0} onClick={() => setN(n - 1)}>Back</button>
        <button className="btn primary" data-autofocus onClick={next}>{last ? "Done" : "Next"}</button>
      </div>
    </div>
  );
}

/** Setup card hanging below the strip (centered, same size as the settings card). Shell drives it with `open`. */
export function SetupPanel({ open, onClose, startStep }: { open: boolean; onClose: () => void; startStep?: number }) {
  return <Panel side="center" width={600} label="Setup" dataKind="setup" open={open} onClose={onClose}><SetupWizard onDone={onClose} startStep={startStep} /></Panel>;
}
