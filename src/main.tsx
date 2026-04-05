import { createRoot } from "react-dom/client";
// @ts-expect-error CSS import handled by Vite
import "./index.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(<App />);
