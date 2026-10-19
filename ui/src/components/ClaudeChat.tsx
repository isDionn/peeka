// The Modules card's Claude chat tab: a plain conversation through the owner's own Claude Code (Rust: claude_chat.rs).
// One calm surface: status pill, messages (yours as grey pills on the right, Claude's as plain text), the 56 px ghost
// bottom left, one input row. Fixed height: the list scrolls inside, nothing else moves. Messages live in this module
// (page memory) so switching tabs keeps them; nothing is written to disk by Peeka.
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { bridge, type ClaudeChatState } from "../bridge";
import { Mascot } from "../mascot";
import "../claude-chat.css";

export type ChatMsg = { id: number; role: "user" | "claude" | "error"; text: string };
type Snap = { msgs: ChatMsg[]; busy: boolean; streaming: boolean };

/* ---------- store: one per page, fed by the bridge events (subscribed once) ---------- */
let snap: Snap = { msgs: [], busy: false, streaming: false };
let nextId = 1;
let subscribed = false;
const subs = new Set<() => void>();
const set = (s: Partial<Snap>) => { snap = { ...snap, ...s }; subs.forEach((f) => f()); };
const push = (role: ChatMsg["role"], text: string) => set({ msgs: [...snap.msgs, { id: nextId++, role, text }] });

const ERRORS: Record<string, string> = {
  denied: "Peeka is locked. Unlock it to chat.",
  missing: "Claude Code isn't installed on this PC.",
  refused: "Claude is still answering. Stop it first.",
  invalid: "That message is empty or too long (8000 characters at most).",
};

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  void bridge.on("claude_chat_delta", ({ text }) => {
    const last = snap.msgs[snap.msgs.length - 1];
    if (last?.role === "claude" && snap.streaming) set({ msgs: [...snap.msgs.slice(0, -1), { ...last, text: last.text + text }] });
    else set({ msgs: [...snap.msgs, { id: nextId++, role: "claude", text }], streaming: true });
  });
  void bridge.on("claude_chat_done", (d) => {
    set({ busy: false, streaming: false });
    if (!d.ok && !d.stopped && d.error) push("error", d.error);
  });
}

export async function sendChat(text: string) {
  const t = text.trim();
  if (!t || snap.busy) return false;
  subscribe();
  push("user", t);
  set({ busy: true, streaming: false });
  try { await bridge.call("claude_chat_send", { text: t }); return true; }
  catch (e) { set({ busy: false }); push("error", ERRORS[String(e)] ?? "Claude couldn't be reached. Try again."); return false; }
}
const stopChat = () => bridge.call("claude_chat_stop").catch(() => undefined);
const newChat = () => { set({ msgs: [], busy: false, streaming: false }); bridge.call("claude_chat_new").catch(() => undefined); };
/** Tests and the preview: start from an empty conversation. */
export const resetClaudeChat = (s: Partial<Snap> = {}) => { snap = { msgs: [], busy: false, streaming: false, ...s }; subs.forEach((f) => f()); };

/** A click on Send, Stop or New chat leaves the keyboard in the box (no blur: the island keeps the focus it asked for). */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

const useChat = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap);

/* ---------- the tab ---------- */
export function ClaudeChatTab({ still = false }: { /** Preview screenshots: the ghost holds a still frame. */ still?: boolean }) {
  const { msgs, busy, streaming } = useChat();
  const [cc, setCc] = useState<ClaudeChatState | null>(null);
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  const check = () => bridge.call("claude_chat_state").then(setCc).catch(() => setCc({ available: false, version: null, signedIn: false, busy: false }));
  useEffect(() => { subscribe(); void check(); }, []);
  // the input had the keyboard when the tab went away: give it back
  useEffect(() => () => { if (focused.current) bridge.call("typing_focus", { label: "island", on: false }).catch(() => undefined); }, []);
  // follow the reply while the reader is at the bottom
  const pinned = useRef(true);
  useLayoutEffect(() => { const l = list.current; if (l && pinned.current) l.scrollTop = l.scrollHeight; }, [msgs, busy]);

  const ready = !!cc?.available && cc.signedIn;
  const submit = async () => {
    if (!ready || !text.trim() || busy) return;
    pinned.current = true;
    if (await sendChat(text)) setText("");
  };
  const mood = busy ? (streaming ? "speaking" : "thinking") : "idle";
  const waiting = busy && !streaming;

  return (
    <section className="ccChat" aria-label="Claude chat">
      <header className="ccTop">
        <span className={"ccPill" + (ready ? " on" : "")} role="status">
          <i aria-hidden="true" />
          {cc === null ? "Claude" : !cc.available ? "Claude Code not found" : !cc.signedIn ? "Claude Code not signed in" : "Claude"}
        </span>
        {cc && !ready && (
          <span className="ccHint">
            {!cc.available ? "Install it, then run " : "Run "}<code>claude</code> once in a terminal to sign in.
            <button type="button" className="ccLink" onClick={() => void check()}>Check again</button>
          </span>
        )}
        {ready && <button type="button" className="ccNew" onMouseDown={keepFocus} onClick={newChat} disabled={msgs.length === 0 && !busy}>New chat</button>}
      </header>

      <div className="ccList" ref={list} role="log" aria-live="polite" aria-busy={busy}
        onScroll={(e) => { const l = e.currentTarget; pinned.current = l.scrollHeight - l.scrollTop - l.clientHeight < 24; }}>
        {msgs.length === 0 && !busy && <p className="ccEmpty">Messages go to Claude only when you press Send.</p>}
        {msgs.map((m) => m.role === "user"
          ? <p key={m.id} className="ccMe">{m.text}</p>
          : <p key={m.id} className={m.role === "error" ? "ccErr" : "ccAi"}>{m.text}</p>)}
        {waiting && <span className="ccDots" role="img" aria-label="Claude is thinking"><i /><i /><i /></span>}
      </div>

      <div className="ccGhost" aria-hidden="true">
        <Mascot size={56} mood={mood} isMainAssistant still={still} />
      </div>

      <form className="ccRow" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input ref={input} className="ccInput" value={text} maxLength={8000} disabled={!ready}
          placeholder={ready ? "Ask Claude…" : "Claude Code is needed to chat"} aria-label="Message to Claude"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => { focused.current = true; bridge.call("typing_focus", { label: "island", on: true }).catch(() => undefined); }}
          onBlur={() => { focused.current = false; bridge.call("typing_focus", { label: "island", on: false }).catch(() => undefined); }} />
        {busy
          ? <button type="button" className="ccSend" aria-label="Stop" onMouseDown={keepFocus} onClick={() => void stopChat()}><Square size={11} fill="currentColor" strokeWidth={0} /></button>
          : <button type="submit" className="ccSend" aria-label="Send" onMouseDown={keepFocus} disabled={!ready || !text.trim()}><ArrowUp size={16} strokeWidth={2.4} /></button>}
      </form>
    </section>
  );
}
