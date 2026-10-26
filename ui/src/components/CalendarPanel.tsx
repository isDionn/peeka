import { useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { bridge } from "../bridge";
import "../calendar.css";

// The clock's month panel (RC4, ported from ui/concepts/rc4.tsx "calendar"): dates only, nothing leaves the PC.
const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d: Date, n: number) => { const t = new Date(d.getFullYear(), d.getMonth() + n, 1); const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)); };
const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const monthName = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const longName = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
function relative(d: Date, today: Date) {
  const n = Math.round((day0(d).getTime() - today.getTime()) / 86_400_000);
  return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : n > 0 ? `In ${n} days` : `${-n} days ago`;
}
/** Always 6 weeks from the Monday on or before the 1st: the grid never changes height between months. */
export function weeks(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
}

export function CalendarPanel() {
  const today = day0(bridge.now());
  const [focus, setFocus] = useState(today);
  const [sel, setSel] = useState(today);
  const [step, setStep] = useState(0); // -1 / +1: the last month change, for the slide direction
  const grid = useRef<HTMLDivElement>(null);
  const month = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const go = (d: Date, fromKeys = false) => {
    const m = d.getFullYear() * 12 + d.getMonth() - (focus.getFullYear() * 12 + focus.getMonth());
    if (m) setStep(Math.sign(m));
    setFocus(d);
    if (fromKeys) requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus());
  };
  const keys = (e: React.KeyboardEvent) => {
    const k = e.key;
    const to = k === "ArrowLeft" ? addDays(focus, -1) : k === "ArrowRight" ? addDays(focus, 1) : k === "ArrowUp" ? addDays(focus, -7) : k === "ArrowDown" ? addDays(focus, 7)
      : k === "Home" ? today : k === "PageUp" ? addMonths(focus, e.shiftKey ? -12 : -1) : k === "PageDown" ? addMonths(focus, e.shiftKey ? 12 : 1) : null;
    if (!to) return;
    e.preventDefault();
    go(to, true);
  };
  const away = month.getMonth() !== today.getMonth() || month.getFullYear() !== today.getFullYear();
  return (
    <div className="body cal">
      <div className="calHead">
        <h2 className="calTitle" id="calTitle" aria-live="polite">{monthName(month)}</h2>
        <button className="calToday t12 b6" aria-hidden={!away} tabIndex={away ? 0 : -1} data-away={away ? "" : undefined} onClick={() => { go(today, true); setSel(today); }}>Today</button>
        <button className="calNav" aria-label="Previous month" title="Previous month (Page Up)" onClick={() => go(addMonths(focus, -1))}><ChevronLeft /></button>
        <button className="calNav" aria-label="Next month" title="Next month (Page Down)" onClick={() => go(addMonths(focus, 1))}><ChevronRight /></button>
      </div>
      <div role="grid" aria-labelledby="calTitle" className="calGrid" ref={grid} onKeyDown={keys}>
        <div role="row" className="calRow calDow">{DOW.map((d) => <span key={d} role="columnheader" aria-label={d} className="t11 b6 l3">{d.slice(0, 2)}</span>)}</div>
        <div className="calWeeks" key={month.getTime()} data-step={step}>
          {weeks(month).map((w) => (
            <div role="row" className="calRow" key={w[0].getTime()}>
              {w.map((d) => {
                const out = d.getMonth() !== month.getMonth(), isToday = same(d, today);
                return (
                  <button key={d.getTime()} role="gridcell" className={"calDay num" + (out ? " out" : "") + (isToday ? " today" : "") + (same(d, sel) ? " sel" : "")}
                    tabIndex={same(d, focus) ? 0 : -1} data-autofocus={same(d, focus) ? "" : undefined} aria-selected={same(d, sel)} aria-current={isToday ? "date" : undefined} aria-label={longName(d)}
                    onClick={() => { setSel(d); go(d); }}>{d.getDate()}</button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="calFoot">
        <div><div className="t13 b6">{longName(sel)}</div><div className="t12 l3">{relative(sel, today)}</div></div>
        <button className="smallLink" title="Open the Windows calendar (Win+N)" onClick={() => bridge.call("open_calendar").catch(() => undefined)}>Windows calendar<ArrowUpRight /></button>
      </div>
    </div>
  );
}
