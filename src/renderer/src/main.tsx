import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No browser autofill anywhere; fields that hold prose turn spell checking on themselves.
const quiet = (node: Element): void => {
  for (const field of node.matches("input, textarea")
    ? [node]
    : node.querySelectorAll("input, textarea")) {
    field.setAttribute("autocomplete", "off");
  }
};
new MutationObserver((records) => {
  for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && quiet(n));
}).observe(document.body, { childList: true, subtree: true });

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
