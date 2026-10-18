// Voice cards (mockup d1, d3): phase text + colored wave on the strip; in the peek, the "You" / assistant transcript card and the "Always listening" hint.
// Data comes from the plugin's `transcript.streamId` stream (`plugin_stream`, `speaker` = "You" or the plugin name); all text is plain text.
import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { bridge } from "../bridge";
import { plain } from "../lib/plugin";

/** Peeka's phase table (mockup FAZ): label and wave/line color. Plugins can't change it. */
const PHASES = {
  listening: { label: "Listening", color: "var(--mint)", mod: "listen" },
  thinking: { label: "Thinking", color: "var(--orange)", mod: "wait" },
  speaking: { label: "Speaking", color: "var(--crimson)", mod: "speak" },
} as const;
export type Phase = (typeof PHASES)[keyof typeof PHASES];
export const phaseOf = (state: unknown): Phase | null => (typeof state === "string" && Object.hasOwn(PHASES, state) ? PHASES[state as keyof typeof PHASES] : null);

/** Each speaker's latest text in the stream (one row per speaker, in arrival order); resets when the stream changes. */
export function useTranscript(streamId: string | undefined, fallback = "Assistant"): { who: string; text: string }[] {
  const [rows, setRows] = useState<{ who: string; text: string }[]>([]);
  useEffect(() => {
    if (!streamId) return;
    const off = bridge.on("plugin_stream", (e) => {
      if (e.streamId !== streamId) return;
      const who = plain(e.speaker, 24) || fallback;
      setRows((cur) => (cur.some((r) => r.who === who) ? cur.map((r) => (r.who === who ? { who, text: e.text } : r)) : [...cur, { who, text: e.text }].slice(-2)));
    });
    return () => { off.then((f) => f()); setRows([]); };
  }, [streamId, fallback]);
  return rows;
}

/** Peek: two-line live transcript ("You" gray, plugin red) and a hint. Empty rows are not drawn. */
export function Transcript({ streamId, name }: { streamId: string; name?: string }) {
  const rows = useTranscript(streamId, name ? plain(name, 24) : undefined);
  return (
    <div className="transcript" aria-live="polite" aria-label="Live transcript">
      {rows.map((r) => (
        <div key={r.who} className={"tr" + (r.who === "You" ? "" : " assistant")}><span className="who">{r.who}</span><span className="text">{plain(r.text, 400)}</span></div>
      ))}
      <div className="hint"><Mic />Always listening. Say “Stop” to end.</div>
    </div>
  );
}
