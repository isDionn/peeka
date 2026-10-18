// Scope levels and plain-language descriptions are Peeka's own table (the plugin only sends `why`). Source: plugin-api.md §4.
export type Level = "low" | "medium" | "high";
export interface ScopeInfo { scope: string; level: Level; text: string }

const TABLE: Record<string, [Level, string]> = {
  "island.protrusion": ["low", "Show status and peeks on the island"],
  "card.module": ["low", "Show up to 3 tabs and summary rows on the Modules card"],
  "alerts.post": ["low", "Show short alerts and ongoing activity"],
  "notifications.post": ["low", "Add entries to the Notifications list"],
  "search.provider": ["medium", "Provide Ctrl+K search results (sees what you type)"],
  "composer.handler": ["medium", "Receive Ctrl+Space questions"],
  "voice.line": ["medium", "Control the voice line and live transcript under the strip"],
  "approvals.prompt": ["medium", "Ask for approval"],
  "files.drop": ["medium", "Get the paths of files you drop on the island"],
  "lock.signal": ["medium", "Lock Peeka"],
  "media.read": ["medium", "Read the title and artist of what's playing"],
  "windows.read": ["high", "See the names of open windows"],
  "clipboard.read": ["high", "Read clipboard history (passwords are never shared)"],
  "notifications.read": ["high", "Read Windows notifications"],
};

/** An unknown scope counts as high (arrives unchecked); Rust rejects unknown ones anyway. */
export const scopeInfo = (scope: string): ScopeInfo => {
  const [level, text] = TABLE[scope] ?? ["high", "Unknown permission"];
  return { scope, level, text };
};
export const LEVEL_NAME: Record<Level, string> = { low: "low", medium: "medium", high: "high" };
