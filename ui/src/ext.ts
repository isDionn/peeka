// Assistant slots: a build-time extension (at most one) draws its own UI in a few fixed places. The build picks up any
// `ui/src/ext/<name>/index.tsx` (default export: `PeekaExtension`); Peeka's own repo ships none, so every slot is empty
// and Peeka looks and behaves as without slots. docs: ui/src/ext/README.md.
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { AssistantEvent, SurfacesView } from "./plugin-api";
import type { createFakeBridge } from "./bridge.fake";

export type FakeBridge = ReturnType<typeof createFakeBridge>;
/** Sent as `ext-go` (strip / Ctrl+K -> island): open the card, `full` = full size, `target` = what the card reads. */
export type ExtGo = { full?: boolean; target?: unknown };

/** Y1: the strip's first button on the right (primary monitor). */
export interface StripButtonProps {
  surfaces: SurfacesView;
  /** The extension card is open (island -> strip). */
  open: boolean;
  /** Peeka focuses the island, then opens the card (`ext-go {}`). */
  onOpen(): void;
}

/** Y2: the island card, compact or full size. */
export interface CardProps {
  size: "compact" | "full";
  setSize(s: "compact" | "full"): void;
  /** From the last `ext-go`; the card clears it when used (`clearTarget`). */
  target?: unknown;
  clearTarget(): void;
  onClose(): void;
  surfaces: SurfacesView;
  /** The main assistant's `assistant.event`s, newest last, at most 200. */
  events: AssistantEvent[];
  /** One request to the main assistant (`lib/assistant.ts`): rejects with the error string or code, or "timeout". */
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
}
export interface CardSlot {
  Card: ComponentType<CardProps>;
  /** CSS px. */
  compactWidth: number;
  /** CSS px; the width is clamped to the island window. */
  full?: { width: number; height: number };
  /** Ctrl+Space, the "ask" message and the mascot / center click open this card instead of the composer. */
  takesAsk?: boolean;
}

/** Y3: Ctrl+K rows. `commands` match locally on "<label> <command label>"; `groups` ask the main assistant. */
export interface SearchSlot {
  commands?: { id: string; label: string; kind: string; icon: LucideIcon; go: ExtGo }[];
  groups?: { title: string; method: string; kind: string; icon: LucideIcon; toRows(result: unknown): { id: string; title: string; go: ExtGo }[] }[];
}

/** Y6: the preview and the fake bridge. */
export interface PreviewSlot {
  /** Fake `assistant_request`: a value = the result, a thrown number = that error code. */
  answer?(method: string, params: Record<string, unknown>): unknown | Promise<unknown>;
  /** Extra `?state=` keys for preview.html. */
  states?: Record<string, (fake: FakeBridge) => void>;
}

export interface PeekaExtension {
  /** Never shown: CSS scope and logs. */
  id: string;
  /** Shown text, e.g. "Back to <label>". */
  label: string;
  StripButton?: ComponentType<StripButtonProps>;
  card?: CardSlot;
  search?: SearchSlot;
  preview?: PreviewSlot;
}

const found = Object.values(import.meta.glob<{ default: PeekaExtension }>("./ext/*/index.tsx", { eager: true })).map((m) => m.default);
if (found.length > 1) throw new Error("ui/src/ext: at most one extension");
let current: PeekaExtension | null = found[0] ?? null;

/** The build's extension, or null (Peeka itself). */
export const ext = (): PeekaExtension | null => current;
/** Tests only: register a sample extension (null = none again). */
export function setExtForTest(e: PeekaExtension | null) { current = e; }
