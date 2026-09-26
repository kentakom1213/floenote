import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt.js";
import "./styles.css";
import "./global-search.css";

const previewPrNumber = import.meta.env.VITE_PREVIEW_PR_NUMBER;
if (previewPrNumber) {
  document.title = `Floe Note (#${previewPrNumber})`;
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
    <PwaUpdatePrompt />
  </StrictMode>,
);
