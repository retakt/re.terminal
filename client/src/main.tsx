import ReactDOM from "react-dom/client";
import { TerminalProvider } from "@/contexts/terminal-context";
import { AppProvider } from "@/contexts/app-context";
import { TerminalPage } from "@/components/terminal/terminal-page";
import "./index.css";

// ── Mobile navigation gesture guard ───────────────────────────────────────────
// Strongest web-only attempt: invisible edge shields + touch/pointer cancellation.
// The shields intentionally skip the tab bar, keybar, and footer/status bar.

(function installNavigationGestureGuard() {
  if (typeof window === "undefined") return;

  const EDGE_SIZE = 44;
  const SWIPE_THRESHOLD = 8;

  let startX = 0;
  let startY = 0;
  let edge: "left" | "right" | null = null;
  let installed = false;
  let leftShield: HTMLDivElement | null = null;
  let rightShield: HTMLDivElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const isCoarsePointer = () =>
    window.matchMedia?.("(pointer: coarse)").matches ?? false;

  const getEdge = (x: number) => {
    if (x <= EDGE_SIZE) return "left";
    if (x >= window.innerWidth - EDGE_SIZE) return "right";
    return null;
  };

  const shouldCancel = (clientX: number, clientY: number) => {
    if (!edge) return false;

    const dx = clientX - startX;
    const dy = clientY - startY;

    const isHorizontal =
      Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.15;

    const isEdgeNavigationDirection =
      (edge === "left" && dx > 0) || (edge === "right" && dx < 0);

    return isHorizontal && isEdgeNavigationDirection;
  };

  const cancel = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  const getRect = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return rect;
  };

  const getShieldBounds = () => {
    const tabbar = getRect(".reterm-tabbar");
    const keybar = getRect(".keybar");
    const statusbar = getRect(".reterm-statusbar");

    // Leave top controls clickable: tabbar + keybar.
    const top = Math.max(
      0,
      tabbar ? tabbar.bottom : 0,
      keybar ? keybar.bottom : 0
    );

    // Leave footer/status bar clickable.
    const bottom = statusbar
      ? Math.max(0, window.innerHeight - statusbar.top)
      : 0;

    return {
      top: Math.max(0, Math.round(top)),
      bottom: Math.max(0, Math.round(bottom)),
    };
  };

  const updateShieldBounds = () => {
    const { top, bottom } = getShieldBounds();

    for (const shield of [leftShield, rightShield]) {
      if (!shield) continue;
      shield.style.top = `${top}px`;
      shield.style.bottom = `${bottom}px`;
    }
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

    if (edge) cancel(event);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (!edge || event.touches.length !== 1) return;

    const touch = event.touches[0];
    if (shouldCancel(touch.clientX, touch.clientY)) {
      cancel(event);
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;

    startX = event.clientX;
    startY = event.clientY;
    edge = getEdge(startX);

    if (edge) cancel(event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;

    if (shouldCancel(event.clientX, event.clientY)) {
      cancel(event);
    }
  };

  const reset = () => {
    edge = null;
  };

  const createEdgeShield = (side: "left" | "right") => {
    const shield = document.createElement("div");

    shield.dataset.retermEdgeGuard = side;
    shield.setAttribute("aria-hidden", "true");

    Object.assign(shield.style, {
      position: "fixed",
      top: "0",
      bottom: "0",
      width: `${EDGE_SIZE}px`,
      [side]: "0",
      zIndex: "2147483647",
      pointerEvents: "auto",
      touchAction: "none",
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none",
      background: "transparent",
    } as CSSStyleDeclaration);

    const claim = (event: Event) => {
      cancel(event);
    };

    shield.addEventListener("touchstart", claim, {
      passive: false,
      capture: true,
    });

    shield.addEventListener("touchmove", claim, {
      passive: false,
      capture: true,
    });

    shield.addEventListener("pointerdown", claim, {
      passive: false,
      capture: true,
    });

    shield.addEventListener("pointermove", claim, {
      passive: false,
      capture: true,
    });

    document.body.appendChild(shield);
    return shield;
  };

  const installEdgeShields = () => {
    if (!isCoarsePointer()) return;

    document.querySelectorAll("[data-reterm-edge-guard]").forEach((node) => {
      node.remove();
    });

    leftShield = createEdgeShield("left");
    rightShield = createEdgeShield("right");
    updateShieldBounds();

    window.addEventListener("resize", updateShieldBounds);
    window.addEventListener("orientationchange", updateShieldBounds);

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(updateShieldBounds);
      document
        .querySelectorAll(".reterm-tabbar, .keybar, .reterm-statusbar")
        .forEach((element) => resizeObserver?.observe(element));
    }

    mutationObserver = new MutationObserver(() => {
      updateShieldBounds();

      if (resizeObserver) {
        resizeObserver.disconnect();
        document
          .querySelectorAll(".reterm-tabbar, .keybar, .reterm-statusbar")
          .forEach((element) => resizeObserver?.observe(element));
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  };

  const install = () => {
    if (installed) return;
    installed = true;

    window.addEventListener("touchstart", onTouchStart, {
      passive: false,
      capture: true,
    });

    window.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true,
    });

    window.addEventListener("touchend", reset, {
      passive: true,
      capture: true,
    });

    window.addEventListener("touchcancel", reset, {
      passive: true,
      capture: true,
    });

    window.addEventListener("pointerdown", onPointerDown, {
      passive: false,
      capture: true,
    });

    window.addEventListener("pointermove", onPointerMove, {
      passive: false,
      capture: true,
    });

    window.addEventListener("pointerup", reset, {
      passive: true,
      capture: true,
    });

    window.addEventListener("pointercancel", reset, {
      passive: true,
      capture: true,
    });

    installEdgeShields();

    const currentState =
      history.state && typeof history.state === "object" ? history.state : {};

    history.replaceState(
      { ...currentState, retermEntry: true },
      "",
      location.href
    );

    history.pushState({ retermBackGuard: true }, "", location.href);

    window.addEventListener("popstate", () => {
      history.pushState({ retermBackGuard: true }, "", location.href);
    });
  };

  if (document.body) {
    install();
  } else {
    window.addEventListener("DOMContentLoaded", install, { once: true });
  }
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
