/** Peeka motion modules (FPV §0i item 8). No dependencies; transform, opacity and clip-path only. */

/** `SPRINGS.card|protrusion|pill|press…` presets; `Spring` a single spring (retarget keeps velocity); `SpringGroup` runs rAF only while moving. */
export { Spring, SpringGroup, SPRINGS, advance, type SpringParams } from "./spring";
/** `createShape(host, body, {maxW,maxH,onRect,layers})`: peek ↔ card via clip-path in a fixed window; `.to(w,h)`, `.rect()`. */
export { createShape, notchRadius, sideRadius, type Shape, type ShapeLayer, type ShapeOptions, type ShapeState, type Rect } from "./shape";
/** `mountShoulders(layersEl)`: liquid shoulder + shadow + halo layer; pass the result's `.layer` to `createShape({layers})`, `.setAmbient(color)` sets the halo color. CSS included. */
export { mountShoulders, type ShoulderLayers } from "./shoulder";
/** `createFlight().capture()` → the DOM changes → `.play()`: `data-share` elements (song title, cover) fly from the strip to the card. */
export { createFlight } from "./flight";
/** `createPill` flowing highlight capsule · `hoverIntent` 120/200 ms intent delay · `hoverLift` hover · `press` press 0.96/0.92. */
export { createPill, hoverIntent, hoverLift, press, type Pill } from "./flow";
