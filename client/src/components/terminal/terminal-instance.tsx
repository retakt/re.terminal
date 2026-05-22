/**
 * TerminalInstance
 *
 * Mobile fixes:
 * - NO auto-focus on mobile (prevents keyboard popup on load)
 * - Touch tap on terminal = focus + show keyboard (intentional)
 * - xterm selection works because we don't intercept touch on canvas
 *
 * Performance:
 * - GPU-accelerated visibility toggle via opacity
 * - Reduced scrollback on mobile
 */

import * as React from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminal } from "@/contexts/terminal-context";
import "@xterm/xterm/css/xterm.css";

interface Props { sessionId: string; isActive: boolean; }

// Tokyo Night Dark theme - exact colors from iTerm2 plist (P3 converted to sRGB approx)
const TOKYO_NIGHT_DARK = {
  background:          "#040404",
  foreground:          "#f5f5f3",
  cursor:              "#f5f5f3",
  cursorAccent:        "#040404",
  selectionBackground: "rgba(45, 212, 191, 0.28)",
  // ANSI 0-7
  black:   "#3b4261", red:     "#f7768e", green:   "#9ece6a",
  yellow:  "#e0af68", blue:    "#7aa2f7", magenta: "#bb9af7",
  cyan:    "#7dcfff", white:   "#a9b1d6",
  // ANSI 8-15 (bright)
  brightBlack:   "#414868", brightRed:     "#f7768e",
  brightGreen:   "#9ece6a", brightYellow:  "#e0af68",
  brightBlue:    "#7aa2f7", brightMagenta: "#bb9af7",
  brightCyan:    "#7dcfff", brightWhite:   "#c0caf5",
};

// GitHub Light terminal theme. Keep the terminal paper-light in light mode.
const GITHUB_LIGHT = {
  background:          "#ffffff",
  foreground:          "#24292f",
  cursor:              "#24292f",
  cursorAccent:        "#ffffff",
  selectionBackground: "rgba(9, 105, 218, 0.20)",
  // ANSI 0-7
  black:   "#24292f", red:     "#cf222e", green:   "#116329",
  yellow:  "#4d2d00", blue:    "#0969da", magenta: "#8250df",
  cyan:    "#1b7c83", white:   "#6e7781",
  // ANSI 8-15 (bright)
  brightBlack:   "#57606a", brightRed:     "#a40e26",
  brightGreen:   "#1a7f37", brightYellow:  "#9a6700",
  brightBlue:    "#0550ae", brightMagenta: "#6639ba",
  brightCyan:    "#0a7f8c", brightWhite:   "#8c959f",
};

const isMobile = () => navigator.maxTouchPoints > 0;

function getTheme() {
  const theme = document.documentElement.getAttribute("data-theme");
  if (theme === "light") return GITHUB_LIGHT;
  return TOKYO_NIGHT_DARK;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TerminalInstance({ sessionId, isActive }: Props) {
  const { registerXterm, unregisterXterm, sendInput, sendResize } = useTerminal();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const xtermRef     = React.useRef<XTerm | null>(null);
  const fitRef       = React.useRef<FitAddon | null>(null);
  const mobile       = React.useRef(isMobile());

  React.useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    let disposed = false;

    // Responsive font size: 15 (mobile) -> 14 (desktop)
    const getFontSize = () => {
      if (window.innerWidth <= 375) return 11; // iPhone 6/7/8 and smaller
      if (window.innerWidth <= 480) return 12; // Small phones
      if (window.innerWidth <= 768) return 15; // Tablets/mobile
      return 14; // Desktop
    };
    const fontSize = mobile.current ? getFontSize() : 17;

    const xterm = new XTerm({
      cursorBlink:        true,
      cursorStyle:        "block",
      fontSize:           fontSize,
      lineHeight:         mobile.current ? 1.2 : 1.25,
      fontFamily:         '"Ubuntu Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace',
      fontWeight:         "400",
      theme:              getTheme(),
      scrollback:         mobile.current ? 3000 : 10000,
      overviewRulerWidth: 0,
      disableStdin:       false,
      // Auto-copy selected text to clipboard — fixes Ctrl+Shift+C conflict
      // (browser intercepts Ctrl+Shift+C for devtools; copyOnSelect bypasses this)
      // copyOnSelect:       true, // Removed due to xterm compatibility issue
      allowProposedApi:   true,
    });

    const fitAddon   = new FitAddon();
    const linksAddon = new WebLinksAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(linksAddon);

    if (disposed) { xterm.dispose(); return; }

    try {
      xterm.open(el);
    } catch (error) {
      xterm.dispose();
      console.error("xterm open failed", error);
      return;
    }
    

    const fitAndResize = () => {
      if (disposed) return;
      if (!el.isConnected || el.clientWidth <= 0 || el.clientHeight <= 0) return;

      try {
        fitAddon.fit();
        sendResize(sessionId, xterm.cols, xterm.rows);
      } catch {
        window.setTimeout(() => {
          if (disposed) return;
          if (!el.isConnected || el.clientWidth <= 0 || el.clientHeight <= 0) return;
          try {
            fitAddon.fit();
            sendResize(sessionId, xterm.cols, xterm.rows);
          } catch {
            // xterm can briefly lack renderer dimensions while layout settles.
          }
        }, 30);
      }
    };

    const applyTheme = () => {
      const theme = getTheme();
      xterm.options.theme = { ...theme };
      el.style.backgroundColor = theme.background;
      const viewport = el.querySelector<HTMLElement>(".xterm-viewport");
      const screen = el.querySelector<HTMLElement>(".xterm-screen");
      if (viewport) viewport.style.backgroundColor = theme.background;
      if (screen) screen.style.backgroundColor = theme.background;
      try { xterm.refresh(0, Math.max(0, xterm.rows - 1)); } catch (_) {}
    };

    applyTheme();

    const handleThemeChange = () => {
      if (disposed) return;
      requestAnimationFrame(() => {
        if (disposed) return;
        applyTheme();
        fitAndResize();
      });
    };
    window.addEventListener("reterm-theme-change", handleThemeChange);

    let touchStartY = 0;
    let touchStartScrollTop = 0;
    let touchMoved = false;

    const getViewport = () => el.querySelector<HTMLElement>(".xterm-viewport");

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const viewport = getViewport();
      if (!viewport) return;
      touchStartY = event.touches[0].clientY;
      touchStartScrollTop = viewport.scrollTop;
      touchMoved = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const viewport = getViewport();
      if (!viewport) return;

      const deltaY = touchStartY - event.touches[0].clientY;
      if (!touchMoved && Math.abs(deltaY) < 6) return;

      touchMoved = true;
      viewport.scrollTop = touchStartScrollTop + deltaY;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleTouchEnd = () => {
      if (!touchMoved) xterm.focus();
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    el.addEventListener("touchcancel", handleTouchEnd);

    requestAnimationFrame(() => {
      if (disposed) return;
      fitAndResize();
      applyTheme();

      // Only auto-focus on desktop — on mobile this triggers keyboard popup
      if (!mobile.current && isActive) xterm.focus();
    });
    void document.fonts?.ready.then(() => {
  if (disposed) return;
  requestAnimationFrame(() => {
    if (disposed) return;
    fitAndResize();
    applyTheme();
  });
});

window.setTimeout(() => {
  if (disposed) return;
  fitAndResize();
  applyTheme();
}, 120);

    xtermRef.current = xterm;
    fitRef.current   = fitAddon;

    xterm.onData(data => { if (!disposed) sendInput(sessionId, data); });
    registerXterm(sessionId, xterm);

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      fitAndResize();
    });
    ro.observe(el);

    // Handle window resize for responsive font size
    const handleResize = () => {
      if (disposed || !xtermRef.current) return;
      const newFontSize = getFontSize();
      if (newFontSize !== xtermRef.current.options.fontSize) {
        xtermRef.current.options.fontSize = newFontSize;
        try { xtermRef.current.refresh(0, Math.max(0, xtermRef.current.rows - 1)); } catch (_) {}
        fitAndResize();
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("reterm-theme-change", handleThemeChange);
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      unregisterXterm(sessionId);
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current   = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Re-focus on tab switch (desktop only)
  React.useEffect(() => {
    if (!isActive || mobile.current) return;
    const id = requestAnimationFrame(() => {
      xtermRef.current?.focus();
      try { fitRef.current?.fit(); } catch (_) {}
    });
    return () => cancelAnimationFrame(id);
  }, [isActive]);

  // Mobile: scroll to end when terminal becomes active (e.g., after keyboard opens)
  React.useEffect(() => {
    if (!isActive || !mobile.current) return;
    const t = setTimeout(() => {
      if (xtermRef.current) {
        // Scroll to bottom of terminal buffer
        xtermRef.current.scrollToBottom();
      }
    }, 150);
    return () => clearTimeout(t);
  }, [isActive]);

  // Desktop: re-focus on click in padding/scrollbar area
  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    requestAnimationFrame(() => xtermRef.current?.focus());
  }, []);

  return (
    <div
      ref={containerRef}
      className="terminal-instance"
      onPointerDown={handlePointerDown}
      style={{
        position:   "absolute",
        inset:      0,
        opacity:     isActive ? 1 : 0,
        // Keep pointer events only when active — prevents ghost touches on hidden tabs
        pointerEvents: isActive ? "auto" : "none",
        // Allow text selection for copy functionality
        userSelect: "auto",
        WebkitUserSelect: "auto",
      }}
    />
  );
}
