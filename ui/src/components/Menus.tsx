import { useRef, useState } from "react";
import { Activity, AppWindow, CircleX, Eye, EyeOff, Lock, PanelBottom, Pin, PinOff, Power, Settings, X } from "lucide-react";
import { bridge, type PinnedApp, type WindowInfo } from "../bridge";
import { pickWindow } from "./Strip";
import { mergePins } from "../lib/mergePins";
import { AppIcon } from "./common";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useSettings } from "../hooks";
import { useIslandHidden } from "../hooks.fidelity";
import type { MenuState } from "./Strip";

/** Right-click menu. Arrow keys move, Esc closes and focus returns to the opener. App menu: Pin, New window, Close window, Quit app.
 * Strip menu (mockup sr): Peeka settings, Restore taskbar, Hide island for now, Lock Peeka; opens under the center chip. "Quit" opens the confirmation (`onQuit`). */
export function ContextMenu({ menu, pins, windows, locked, onClose, onPins, onSettings, onQuit }: {
  menu: MenuState; pins: PinnedApp[]; windows: WindowInfo[]; /** No "Lock Peeka" item when Peeka is already locked. */ locked?: boolean; onClose: () => void;
  onPins: (appIds: string[]) => void; onSettings: () => void; /** "Quit": opens Peeka's own confirmation (ADR-0062; "Quit Peeka" in the Status panel is the second route, owner decision 2026-10-17). */ onQuit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false); // "Quit app" can lose unsaved work: the first click asks for confirmation (O10)
  useFocusTrap(ref, onClose);
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  const [denied, setDenied] = useState(false); // close/quit was denied (elevated window): the menu stays open and offers Task Manager
  const attempt = (p: Promise<unknown>) => p.then(onClose, (e) => { if (String(e) === "denied") setDenied(true); else onClose(); });
  const done = (fn: () => void) => () => { fn(); onClose(); };
  const settings = useSettings();
  const hidden = useIslandHidden();

  if (menu.kind === "strip") {
    const hideKeys = settings?.shortcuts.hide_island ?? "Ctrl+Shift+A";
    return (
      <div ref={ref} className="context open" role="menu" aria-label="Peeka menu" style={{ left: menu.x }} data-hit onKeyDown={arrows}>
        <div className="title"><AppWindow />Peeka</div>
        <button role="menuitem" data-autofocus onClick={done(onSettings)}><Settings />Peeka settings</button>
        <button role="menuitem" onClick={done(() => bridge.call("restore_taskbar"))}><PanelBottom />Restore taskbar</button>
        <button role="menuitem" onClick={done(() => { bridge.call("island_hide", { on: !hidden }).catch(() => undefined); })}>
          {hidden ? <Eye /> : <EyeOff />}{hidden ? "Show island" : "Hide island for now"}<span className="key-hint" style={{ marginLeft: "auto" }}>{hideKeys}</span>
        </button>
        <hr />
        {!locked && <button role="menuitem" onClick={done(() => { bridge.call("lock_now").catch(() => undefined); })}><Lock />Lock Peeka</button>}
        <button role="menuitem" onClick={done(() => onQuit?.())}><Power />Quit</button>
      </div>
    );
  }
  const { pinned, tabs } = mergePins(pins, windows);
  const item = [...pinned, ...tabs].find((i) => i.appId === menu.appId);
  const isPinned = pins.some((p) => p.appId === menu.appId);
  const w = item ? pickWindow(item) : null;
  const ids = pins.map((p) => p.appId);
  return (
    <div ref={ref} className="context open" role="menu" aria-label={item?.name ?? "App"} style={{ left: menu.x }} data-hit onKeyDown={arrows}>
      {item && <div className="title"><AppIcon src={item.icon} /><span className="titleName" title={item.name}>{item.name}</span></div>}
      <button role="menuitem" onClick={done(() => onPins(isPinned ? ids.filter((i) => i !== menu.appId) : [...ids, menu.appId]))}>
        {isPinned ? <PinOff /> : <Pin />}{isPinned ? "Unpin" : "Pin"}
      </button>
      <button role="menuitem" data-autofocus onClick={done(() => bridge.call("new_window", { appId: menu.appId }))}><AppWindow />New window</button>
      {w && (
        <>
          <hr />
          <button role="menuitem" onClick={() => attempt(bridge.call("close_window", { hwnd: w.hwnd }))}><X />Close window</button>
          <button role="menuitem" className={armed ? "destructive" : undefined} onClick={armed ? () => attempt(bridge.call("quit_app", { appId: menu.appId })) : () => setArmed(true)}><CircleX />{armed ? "Sure? Click again" : "Quit app"}</button>
          {(denied || w.elevated) && <button role="menuitem" onClick={done(() => { bridge.call("open_task_manager").catch(() => undefined); })}><Activity />Open Task Manager</button>}
        </>
      )}
    </div>
  );
}

/** Quit confirmation: Peeka's own prompt (not a Windows dialog). Cancel has default focus. */
export function QuitConfirm({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="body" style={{ gap: 10 }}>
      <div className="t17 b6">Quit Peeka?</div>
      <div className="t13 l2 b4">The Windows taskbar comes back. The strip stays off until you open Peeka again.</div>
      <div className="buttons" style={{ justifyContent: "flex-end" }}>
        <button className="btn glass" data-autofocus onClick={onCancel}>Cancel</button>
        <button className="btn destructiveFill" onClick={() => { bridge.call("quit"); onCancel(); }}>Quit</button>
      </div>
    </div>
  );
}
