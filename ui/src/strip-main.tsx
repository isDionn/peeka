import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { param } from "./main-common";

createRoot(document.getElementById("root")!).render(<Shell monitor={param("monitor", "m1")} />);
