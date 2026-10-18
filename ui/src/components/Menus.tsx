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

/** Sağ tık menüsü. Ok tuşlarıyla gezilir, Esc kapatır ve odak açan öğeye döner. Uygulama menüsü: Sabitle, Yeni pencere, Pencereyi kapat, Uygulamadan çık.
 * Şerit menüsü (maket sr): Peeka ayarları, Görev çubuğunu geri getir, Adayı geçici gizle, Peeka'yı kilitle; ortadaki çipin altında açılır. "Çık" onay sorusunu açar (`onQuit`). */
export function ContextMenu({ menu, pins, windows, locked, onClose, onPins, onSettings, onQuit }: {
  menu: MenuState; pins: PinnedApp[]; windows: WindowInfo[]; /** Peeka zaten kilitliyse "Peeka'yı kilitle" satırı çıkmaz. */ locked?: boolean; onClose: () => void;
  onPins: (appIds: string[]) => void; onSettings: () => void; /** "Çık": Peeka'nın kendi onay sorusunu açar (ADR-0062; Durum panelindeki "Peeka'yı kapat" ikinci yol, sahip kararı 2026-10-17). */ onQuit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false); // "Uygulamadan çık" kaydedilmemiş işi kaybettirebilir: ilk tık onay ister (O10)
  useFocusTrap(ref, onClose);
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  };
  const [denied, setDenied] = useState(false); // kapatma/çıkış reddedildi (yönetici pencere): menü açık kalır ve Görev Yöneticisi önerilir
  const attempt = (p: Promise<unknown>) => p.then(onClose, (e) => { if (String(e) === "denied") setDenied(true); else onClose(); });
  const done = (fn: () => void) => () => { fn(); onClose(); };
  const settings = useSettings();
  const hidden = useIslandHidden();

  if (menu.kind === "strip") {
    const hideKeys = settings?.shortcuts.hide_island ?? "Ctrl+Shift+A";
    return (
      <div ref={ref} className="baglam open" role="menu" aria-label="Peeka menüsü" style={{ left: menu.x }} data-hit onKeyDown={arrows}>
        <div className="baslik"><AppWindow />Peeka</div>
        <button role="menuitem" data-autofocus onClick={done(onSettings)}><Settings />Peeka ayarları</button>
        <button role="menuitem" onClick={done(() => bridge.call("restore_taskbar"))}><PanelBottom />Görev çubuğunu geri getir</button>
        <button role="menuitem" onClick={done(() => { bridge.call("island_hide", { on: !hidden }).catch(() => undefined); })}>
          {hidden ? <Eye /> : <EyeOff />}{hidden ? "Adayı geri getir" : "Adayı geçici gizle"}<span className="tus-ipucu" style={{ marginLeft: "auto" }}>{hideKeys}</span>
        </button>
        <hr />
        {!locked && <button role="menuitem" onClick={done(() => { bridge.call("lock_now").catch(() => undefined); })}><Lock />Peeka'yı kilitle</button>}
        <button role="menuitem" onClick={done(() => onQuit?.())}><Power />Çık</button>
      </div>
    );
  }
  const { pinned, tabs } = mergePins(pins, windows);
  const item = [...pinned, ...tabs].find((i) => i.appId === menu.appId);
  const isPinned = pins.some((p) => p.appId === menu.appId);
  const w = item ? pickWindow(item) : null;
  const ids = pins.map((p) => p.appId);
  return (
    <div ref={ref} className="baglam open" role="menu" aria-label={item?.name ?? "Uygulama"} style={{ left: menu.x }} data-hit onKeyDown={arrows}>
      {item && <div className="baslik"><AppIcon src={item.icon} /><span className="baslikAd" title={item.name}>{item.name}</span></div>}
      <button role="menuitem" onClick={done(() => onPins(isPinned ? ids.filter((i) => i !== menu.appId) : [...ids, menu.appId]))}>
        {isPinned ? <PinOff /> : <Pin />}{isPinned ? "Sabitlemeyi kaldır" : "Sabitle"}
      </button>
      <button role="menuitem" data-autofocus onClick={done(() => bridge.call("new_window", { appId: menu.appId }))}><AppWindow />Yeni pencere</button>
      {w && (
        <>
          <hr />
          <button role="menuitem" onClick={() => attempt(bridge.call("close_window", { hwnd: w.hwnd }))}><X />Pencereyi kapat</button>
          <button role="menuitem" className={armed ? "yikici" : undefined} onClick={armed ? () => attempt(bridge.call("quit_app", { appId: menu.appId })) : () => setArmed(true)}><CircleX />{armed ? "Emin misin? Tekrar tıkla" : "Uygulamadan çık"}</button>
          {(denied || w.elevated) && <button role="menuitem" onClick={done(() => { bridge.call("open_task_manager").catch(() => undefined); })}><Activity />Görev Yöneticisi'ni aç</button>}
        </>
      )}
    </div>
  );
}

/** Peeka'dan çıkış onayı: Peeka'nın kendi sorusu (Windows penceresi değil). Vazgeç varsayılan odak. */
export function QuitConfirm({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="govde" style={{ gap: 10 }}>
      <div className="t17 b6">Peeka'dan çıkılsın mı?</div>
      <div className="t13 l2 b4">Windows görev çubuğu geri gelir. Peeka'yı yeniden açana kadar şerit olmaz.</div>
      <div className="dugmeler" style={{ justifyContent: "flex-end" }}>
        <button className="btn cam" data-autofocus onClick={onCancel}>Vazgeç</button>
        <button className="btn yikiciDolu" onClick={() => { bridge.call("quit"); onCancel(); }}>Çık</button>
      </div>
    </div>
  );
}
