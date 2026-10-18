import '@testing-library/react';

// jsdom has no ResizeObserver; components only react to size changes, and in tests the size is 0 anyway.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

// jsdom has no Web Animations; the mascot (blinking) and other components call `element.animate`.
if (typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function () { return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation; };
}

// jsdom's requestAnimationFrame timestamp uses its own clock (from window open) while performance.now() uses the process clock: the difference came out
// seconds negative and the spring engine blew up with a negative dt (-1.3e13 px in cok-monitor). Same clock, on top of setTimeout: consistent with fake timers too.
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafId = 0;
globalThis.requestAnimationFrame = (cb) => { const id = ++rafId; rafTimers.set(id, setTimeout(() => { rafTimers.delete(id); cb(performance.now()); }, 16)); return id; };
globalThis.cancelAnimationFrame = (id) => { clearTimeout(rafTimers.get(id)); rafTimers.delete(id); };
