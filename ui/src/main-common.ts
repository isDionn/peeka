import "@fontsource-variable/inter/opsz.css";
import "./notch.css";
import "./notch-extra.css";
import "./island.css";
import "./plugin.css";
import "./clipboard.css";

// 1400 px and below: inactive windows hide their names (the mockup's 1366 rule).
const narrow = () => document.documentElement.toggleAttribute("data-narrow", window.innerWidth <= 1400);
narrow();
window.addEventListener("resize", narrow);

export const param = (k: string, d: string) => new URLSearchParams(location.search).get(k) ?? d;
