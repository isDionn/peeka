/** The build's identity, from the brand file at build time (`vite.config.ts` define; Rust reads the same file). */
declare const __BRAND__: { exeName: string; hookArg: string; updatesUrl: string | null; productName: string; mascot: boolean; hide: Hidden[] };
export const BRAND = __BRAND__;
/** Parts of the UI a brand can leave out (brand file `hide`; vite.config.ts checks the same list). */
export type Hidden = "module.claude" | "module.usage" | "module.cc" | "settings.agent-hooks" | "settings.about-line" | "settings.demo" | "settings.intro";
export const brandHides = (id: Hidden) => BRAND.hide.includes(id);
