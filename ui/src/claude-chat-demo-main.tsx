// Claude chat tab preview (headless screenshots): claude-chat-demo.html?state=<id>, inside a Modules-card-sized frame (620 px).
// empty | chat (a short conversation) | thinking (sent, waiting) | streaming (reply arriving) | long (list scrolls) | missing (no Claude Code) | signin (not signed in) | error (CLI error reply)
import { createRoot } from "react-dom/client";
import { fakeBridge } from "./bridge.fake";
import { ClaudeChatTab, resetClaudeChat, sendChat, type ChatMsg } from "./components/ClaudeChat";
import "./notch.css";

const state = new URLSearchParams(location.search).get("state") ?? "empty";
const m = (id: number, role: ChatMsg["role"], text: string): ChatMsg => ({ id: id + 1000, role, text });
const CHAT: ChatMsg[] = [
  m(1, "user", "What's a good way to name a function that checks the lock first?"),
  m(2, "claude", "Name it after what it guarantees, not how. ensureUnlocked() or requireUnlocked() reads well at the call site: the caller knows it either passes or stops there."),
  m(3, "user", "And for a boolean?"),
  m(4, "claude", "isLocked() for the question, canSend() if the answer folds in more than the lock."),
];
if (state === "missing") fakeBridge.setClaudeChat({ available: false, version: null, signedIn: false });
if (state === "signin") fakeBridge.setClaudeChat({ signedIn: false });
if (state === "chat" || state === "streaming" || state === "thinking") resetClaudeChat({ msgs: CHAT });
if (state === "long") resetClaudeChat({ msgs: [...CHAT, ...CHAT.map((x) => ({ ...x, id: x.id + 100 })), ...CHAT.map((x) => ({ ...x, id: x.id + 200 }))] });
if (state === "error") fakeBridge.setClaudeChat({ error: "Failed to refresh OAuth token: sign in again with claude." });
if (state === "streaming" || state === "error") void sendChat("Give me one more example.");
if (state === "thinking") resetClaudeChat({ msgs: [...CHAT, m(5, "user", "Give me one more example.")], busy: true });

createRoot(document.getElementById("root")!).render(
  <div style={{ width: 620, padding: 16, margin: 24, background: "var(--card)", borderRadius: 34 }}>
    <ClaudeChatTab still={new URLSearchParams(location.search).has("still")} />
  </div>,
);
