// Ses kartları (maket d1, d3): şeritte faz yazısı + renkli dalga, çıkıntıda "Sen" / asistan döküm kartı ve "Sürekli dinleme açık" ipucu.
// Veri, eklentinin `transcript.streamId` akışından gelir (`plugin_stream`, `speaker` = "Sen" ya da eklenti adı); metinler düz metin.
import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { bridge } from "../bridge";
import { plain } from "../lib/plugin";

/** Peeka'nın faz tablosu (maket FAZ): yazı ve dalga/çizgi rengi. Eklenti bunu değiştiremez. */
const PHASES = {
  dinliyor: { label: "Dinliyorum", color: "var(--mint)", mod: "dinle" },
  dusunuyor: { label: "Düşünüyorum", color: "var(--turuncu)", mod: "bekle" },
  konusuyor: { label: "Konuşuyorum", color: "var(--kizil)", mod: "konus" },
} as const;
export type Phase = (typeof PHASES)[keyof typeof PHASES];
export const phaseOf = (hal: unknown): Phase | null => (typeof hal === "string" && Object.hasOwn(PHASES, hal) ? PHASES[hal as keyof typeof PHASES] : null);

/** Akıştaki her konuşanın son metni (konuşan başına bir satır, geliş sırasıyla); akış değişince sıfırlanır. */
export function useTranscript(streamId: string | undefined, fallback = "Asistan"): { who: string; text: string }[] {
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

/** Çıkıntı: iki satırlı canlı döküm ("Sen" gri, eklenti kırmızı) ve ipucu. Boş satır çizilmez. */
export function Transcript({ streamId, name }: { streamId: string; name?: string }) {
  const rows = useTranscript(streamId, name ? plain(name, 24) : undefined);
  return (
    <div className="dokum" aria-live="polite" aria-label="Canlı döküm">
      {rows.map((r) => (
        <div key={r.who} className={"tr" + (r.who === "Sen" ? "" : " asistan")}><span className="kim">{r.who}</span><span className="metin">{plain(r.text, 400)}</span></div>
      ))}
      <div className="ipucu"><Mic />Sürekli dinleme açık. “Dur” dersen keser.</div>
    </div>
  );
}
