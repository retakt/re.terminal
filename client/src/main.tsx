import React from "react";
import ReactDOM from "react-dom/client";
import { TerminalProvider } from "@/contexts/terminal-context";
import { AppProvider } from "@/contexts/app-context";
import { TerminalPage } from "@/components/terminal/terminal-page";
import "./index.css";

// ── Block Back Navigation (Mouse Back Button & Phone Gestures) ────────────────
// Prevents browser back navigation from mouse back button and phone swipe gestures

(function blockBackNavigation() {
  // Push a state to history to intercept back actions
  if (typeof window !== "undefined") {
    // Push initial state
    history.pushState(null, "", location.href);
    
    // Listen for popstate (triggered by back button/gesture)
    window.addEventListener("popstate", function(event) {
      // Prevent default back behavior
      event.preventDefault();
      event.stopPropagation();
      
      // Push state again to keep blocking
      history.pushState(null, "", location.href);
      
      return false;
    });
    
    // Also block beforeunload to prevent accidental navigation
    window.addEventListener("beforeunload", function(event) {
      // Modern browsers ignore custom messages but still show a prompt
      event.preventDefault();
      event.returnValue = "";
    });
  }
})();

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
