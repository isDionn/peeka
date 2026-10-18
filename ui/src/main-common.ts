import "@fontsource-variable/inter/opsz.css";
import "./notch.css";
import "./notch-extra.css";
import "./island.css";
import "./plugin.css";
import "./pano.css";

// 1400 px ve altı: etkin olmayan pencerelerin adı gizlenir (maketteki 1366 kuralı).
const dar = () => document.documentElement.toggleAttribute("data-dar", window.innerWidth <= 1400);
dar();
window.addEventListener("resize", dar);

export const param = (k: string, d: string) => new URLSearchParams(location.search).get(k) ?? d;
