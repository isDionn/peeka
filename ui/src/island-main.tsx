import { createRoot } from "react-dom/client";
import { Island } from "./components/Island";
import { param } from "./main-common";

createRoot(document.getElementById("root")!).render(<Island monitor={param("monitor", "m1")} />);
