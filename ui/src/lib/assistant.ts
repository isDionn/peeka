// Assistant slots (`ext.ts`): the page's way to the main assistant. `request` = one `assistant_request` (a name from the
// brand's `page_requests`) and its `assistant_reply`; `useAssistantEvents` = the main assistant's `assistant.event`s.
import { useEffect, useState } from "react";
import { bridge, type AssistantEvent, type AssistantReply } from "../bridge";

/** Rejects with the command's error ("denied", "not_connected", "invalid"), the reply's numeric `error.code`, or "timeout". */
export async function request<T>(method: string, params: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
  const early = new Map<number, AssistantReply>(); // a fast reply can come before the command returns its id
  let done: ((r: AssistantReply) => void) | null = null;
  let want = -1;
  const off = await bridge.on("assistant_reply", (r) => { if (r.id === want && done) done(r); else early.set(r.id, r); });
  try {
    const { id } = await bridge.call("assistant_request", { method, params });
    want = id;
    const r = early.get(id) ?? await new Promise<AssistantReply>((ok, no) => { done = ok; setTimeout(() => no("timeout"), timeoutMs); });
    if (r.error) throw r.error.code;
    return r.result as T;
  } finally {
    off();
  }
}

/** A paged list from the main assistant: asked again when `on` turns true or `params` change (by value). */
export function useAssistantList<T>(method: string, params: Record<string, unknown>, on = true) {
  const [s, setS] = useState<{ items: T[]; loading: boolean; err: string }>({ items: [], loading: false, err: "" });
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!on) return;
    let live = true;
    setS((p) => ({ ...p, loading: true, err: "" }));
    request<{ items?: T[] } | T[]>(method, JSON.parse(key)).then(
      (r) => { if (live) setS({ items: Array.isArray(r) ? r : r.items ?? [], loading: false, err: "" }); },
      (e) => { if (live) setS({ items: [], loading: false, err: String(e) }); },
    );
    return () => { live = false; };
  }, [method, key, on]);
  return s;
}

/** The page keeps at most this many events (newest last). */
export const EVENTS_MAX = 200;

/** The main assistant's `assistant.event`s since this page started, newest last (`on` false: not listened to). */
export function useAssistantEvents(on = true): AssistantEvent[] {
  const [list, setList] = useState<AssistantEvent[]>([]);
  useEffect(() => {
    if (!on) return;
    const off = bridge.on("assistant_event", (e) => setList((l) => [...l.slice(-(EVENTS_MAX - 1)), e]));
    return () => { off.then((f) => f()); };
  }, [on]);
  return list;
}
