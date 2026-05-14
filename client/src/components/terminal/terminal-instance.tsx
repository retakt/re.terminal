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
  selectionBackground: "rgba(125, 207, 255, 0.3)",
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

// Tokyo Night Light theme - exact colors from iTerm2 plist (P3 converted to sRGB approx)
const TOKYO_NIGHT_LIGHT = {
  background:          "#ffffff",
  foreground:          "#0f0f0f",
  cursor:              "#0f0f0f",
  cursorAccent:        "#ffffff",
  selectionBackground: "rgba(44, 125, 150, 0.25)",
  // ANSI 0-7
  black:   "#0f0f0f", red:     "#8c4351", green:   "#33635c",
  yellow:  "#8f5e15", blue:    "#34548a", magenta: "#5a4a78",
  cyan:    "#0f4b6e", white:   "#787c99",
  // ANSI 8-15 (bright)
  brightBlack:   "#5b5876", brightRed:     "#db4b5c",
  brightGreen:   "#3d7465", brightYellow:  "#a38f3e",
  brightBlue:    "#4d7ac7", brightMagenta: "#755b99",
  brightCyan:    "#2c7d96", brightWhite:   "#848cb3",
};

const isMobile = () => navigator.maxTouchPoints > 0;

// ─── Component ────────────────────────────────────────────────────────────────

export function TerminalInstance({ sessionId, isActive }: Props) {
  const { registerXterm, unregisterXterm, sendInput, sendResize } = useTerminal();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const xtermRef     = React.useRef<XTerm | null>(null);
  const fitRef       = React.useRef<FitAddon | null>(null);
  const mobile       = React.useRef(isMobile());

  // Get current theme from document data attribute
  const getTheme = () => {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'light') return TOKYO_NIGHT_LIGHT;
    return TOKYO_NIGHT_DARK;
  };

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

    xterm.open(el);

    requestAnimationFrame(() => {
      if (disposed) return;
      try { fitAddon.fit(); sendResize(sessionId, xterm.cols, xterm.rows); } catch (_) {}

      // Only auto-focus on desktop — on mobile this triggers keyboard popup
      if (!mobile.current) xterm.focus();
    });

    xtermRef.current = xterm;
    fitRef.current   = fitAddon;

    xterm.onData(data => { if (!disposed) sendInput(sessionId, data); });
    registerXterm(sessionId, xterm);

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      try { fitAddon.fit(); sendResize(sessionId, xterm.cols, xterm.rows); } catch (_) {}
    });
    ro.observe(el);

    // Handle window resize for responsive font size
    const handleResize = () => {
      if (disposed || !xtermRef.current) return;
      const newFontSize = getFontSize();
      if (newFontSize !== xtermRef.current.options.fontSize) {
        xtermRef.current.options.fontSize = newFontSize;
        xtermRef.current.refresh(0, xtermRef.current.rows - 1);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
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
    const t = setTimeout(() => {
      xtermRef.current?.focus();
      try { fitRef.current?.fit(); } catch (_) {}
    }, 30);
    return () => clearTimeout(t);
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

  // Get current theme for background
  const currentTheme = getTheme();

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      style={{
        position:   "absolute",
        inset:      0,
        background: currentTheme.background,
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