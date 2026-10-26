/** The build's identity, from the brand file at build time (`vite.config.ts` define; Rust reads the same file). */
declare const __BRAND__: { exeName: string; hookArg: string; updatesUrl: string | null };
export const BRAND = __BRAND__;
