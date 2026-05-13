import React from "react";
import ReactDOM from "react-dom/client";
import { TerminalProvider } from "@/contexts/terminal-context";
import { AppProvider } from "@/contexts/app-context";
import { TerminalPage } from "@/components/terminal/terminal-page";
import "./index.css";

// ── Visual Viewport handler ───────────────────────────────────────────────────
// Syncs --vvh so the layout shrinks when the iOS keyboard appears.

function syncViewportHeight() {
  const vh = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${vh}px`);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewportHeight, { passive: true });
  window.visualViewport.addEventListener("scroll", syncViewportHeight, { passive: true });
}
window.addEventListener("resize", syncViewportHeight, { passive: true });
syncViewportHeight();

// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TerminalProvider>
      <AppProvider>
        <TerminalPage />
      </AppProvider>
    </TerminalProvider>
  </React.StrictMode>
);
