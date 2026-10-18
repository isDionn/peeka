import '@testing-library/react';

// jsdom'da ResizeObserver yok; bileşenler yalnız ölçü değişince tepki verir, testte ölçü zaten 0.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

// jsdom'da Web Animations yok; maskot (göz kırpma) ve diğer bileşenler `element.animate` çağırır.
if (typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function () { return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation; };
}

// jsdom'un requestAnimationFrame zaman damgası kendi saatinde (pencere açılışından), performance.now() ise sürecin saatinde: fark saniyelerce eksi
// çıkıyor, yay motoru eksi dt ile patlıyordu (cok-monitor'da -1,3e13 px). Aynı saatte, setTimeout üstünde: sahte zamanlayıcıyla da tutarlı.
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafId = 0;
globalThis.requestAnimationFrame = (cb) => { const id = ++rafId; rafTimers.set(id, setTimeout(() => { rafTimers.delete(id); cb(performance.now()); }, 16)); return id; };
globalThis.cancelAnimationFrame = (id) => { clearTimeout(rafTimers.get(id)); rafTimers.delete(id); };
