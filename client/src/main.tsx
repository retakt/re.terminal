import ReactDOM from "react-dom/client";
import { TerminalProvider } from "@/contexts/terminal-context";
import { AppProvider } from "@/contexts/app-context";
import { TerminalPage } from "@/components/terminal/terminal-page";
import "./index.css";

// ── Mobile navigation gesture guard ───────────────────────────────────────────
// Browser/OS edge gestures cannot be fully disabled everywhere, especially iOS
// Safari, but this blocks the preventable cases before they become history nav.

(function installNavigationGestureGuard() {
  if (typeof window === "undefined") return;

  const EDGE_SIZE = 36;
  const SWIPE_THRESHOLD = 10;

  let startX = 0;
  let startY = 0;
  let edge: "left" | "right" | null = null;

  const getEdge = (x: number) => {
    if (x <= EDGE_SIZE) return "left";
    if (x >= window.innerWidth - EDGE_SIZE) return "right";
    return null;
  };

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      edge = null;
      return;
    }

    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    edge = getEdge(startX);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!edge || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const isHorizontal =
      Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.25;

    const isEdgeNavigationDirection =
      (edge === "left" && dx > 0) || (edge === "right" && dx < 0);

    if (isHorizontal && isEdgeNavigationDirection) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onTouchEnd = () => {
    edge = null;
  };

  window.addEventListener("touchstart", onTouchStart, {
    passive: true,
    capture: true,
  });
  window.addEventListener("touchmove", onTouchMove, {
    passive: false,
    capture: true,
  });
  window.addEventListener("touchend", onTouchEnd, {
    passive: true,
    capture: true,
  });
  window.addEventListener("touchcancel", onTouchEnd, {
    passive: true,
    capture: true,
  });

  // Fallback for mouse/hardware back buttons. The touch guard above handles the
  // preventable mobile swipe cases before they become browser history navigation.
  const currentState =
    history.state && typeof history.state === "object" ? history.state : {};

  history.replaceState({ ...currentState, retermEntry: true }, "", location.href);
  history.pushState({ retermBackGuard: true }, "", location.href);

  window.addEventListener("popstate", () => {
    history.pushState({ retermBackGuard: true }, "", location.href);
  });
})();


// ─────────────────────────────────────────────────────────────────────────────
// We no longer shrink the app when the keyboard opens.
// The keyboard will overlay the bottom, keeping the terminal stable.

ReactDOM.createRoot(document.getElementById("root")!).render(
  <TerminalProvider>
    <AppProvider>
      <TerminalPage />
    </AppProvider>
  </TerminalProvider>
);
