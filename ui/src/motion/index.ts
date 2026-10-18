/** Peeka hareket modülleri (FPV §0i madde 8). Bağımlılıksız; yalnız transform, opacity ve clip-path. */

/** `SPRINGS.card|protrusion|pill|press…` ön ayarları; `Spring` tek yay (retarget hızı korur); `SpringGroup` yalnız hareket ederken rAF sürer. */
export { Spring, SpringGroup, SPRINGS, YAY, advance, type SpringParams } from "./spring";
/** `createShape(host, body, {maxW,maxH,onRect,layers})`: sabit pencerede clip-path ile çıkıntı ↔ kart; `.to(w,h)`, `.rect()`. */
export { createShape, notchRadius, sideRadius, type Shape, type ShapeLayer, type ShapeOptions, type ShapeState, type Rect } from "./shape";
/** `mountShoulders(layersEl)`: sıvı omuz + gölge + hale katmanı; sonucun `.layer`'ını `createShape({layers})`'a ver, `.setAmbient(renk)` hale rengi. CSS dahil. */
export { mountShoulders, type ShoulderLayers } from "./shoulder";
/** `createFlight().capture()` → DOM değişir → `.play()`: `data-paylas` öğeleri (şarkı adı, kapak) şeritten karta uçar. */
export { createFlight } from "./flight";
/** `createPill` akan vurgu kapsülü · `hoverIntent` 120/200 ms niyet gecikmesi · `hoverLift` üstüne gelme · `press` basma 0,96/0,92. */
export { createPill, hoverIntent, hoverLift, press, type Pill } from "./flow";
