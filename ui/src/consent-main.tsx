import { createRoot } from "react-dom/client";
import { ConsentWindow } from "./components/Consent";
import "./main-common";

createRoot(document.getElementById("root")!).render(<ConsentWindow />);
