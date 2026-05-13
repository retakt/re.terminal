/**
 * TerminalInstance
 *
 * Mobile fixes:
 * - NO auto-focus on mobile (prevents keyboard popup on load)
 * - Touch tap on terminal = focus + show keyboard (intentional)
 * - xterm selection works because we don't intercept touch on canvas
 * - Pressure-velocity scroll on .xterm-viewport only
 *
 * Performance:
 * - will-change: transform on container
 * - GPU-composited visibility toggle
 * - Reduced scrollback on mobile
 */

import * as React from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminal } from "@/contexts/terminal-context";
import "@xterm/xterm/css/xterm.css";

interface Props { sessionId: string; isActive: boolean; }

const THEME = {
  background:          "#1a1b26",
  foreground:          "#c0caf5",
  cursor:              "#c0caf5",
  cursorAccent:        "#1a1b26",
  selectionBackground: "rgba(192,202,245,0.2)",
  black:   "#15161e", red:     "#f7768e", green:   "#9ece6a",
  yellow:  "#e0af68", blue:    "#7aa2f7", magenta: "#bb9af7",
  cyan:    "#7dcfff", white:   "#a9b1d6",
  brightBlack:   "#414868", brightRed:     "#f7768e",
  brightGreen:   "#9ece6a", brightYellow:  "#e0af68",
  brightBlue:    "#7aa2f7", brightMagenta: "#bb9af7",
  brightCyan:    "#7dcfff", brightWhite:   "#c0caf5",
};

const isMobile = () => navigator.maxTouchPoints > 0;

// ─── Pressure-velocity scroll ─────────────────────────────────────────────────
// Attaches ONLY to .xterm-viewport so xterm canvas handles selection freely.

function attachPressureScroll(container: HTMLElement, xterm: XTerm): () => void {
  const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
  if (!viewport) return () => {};

  let active = false, startY = 0, lastY = 0, lastT = 0;
  let velocity = 0, pressure = 0.5, rafId: number | null = null;

  const DECAY = 0.85;
  const SENS  = 0.10;  // lines per px

  const stop = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } };

  const momentum = () => {
    if (Math.abs(velocity) < 0.04) { velocity = 0; return; }
    xterm.scrollLines(Math.round(velocity * SENS * (0.5 + pressure) * 16));
    velocity *= DECAY;
    rafId = requestAnimationFrame(momentum);
  };

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    stop();
    active = true; startY = lastY = e.clientY;
    lastT = performance.now(); velocity = 0;
    pressure = e.pressure > 0 ? e.pressure : 0.5;
    viewport.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    if (!active) return;
    const now = performance.now(), dt = now - lastT, dy = e.clientY - lastY;
    if (dt > 0) velocity = velocity * 0.55 + (dy / dt) * 0.45;
    if (e.pressure > 0 && e.pressure !== 0.5) pressure = Math.max(pressure, e.pressure);
    const lines = -(dy * SENS * (0.5 + pressure));
    if (Math.abs(lines) >= 0.4) xterm.scrollLines(Math.round(lines));
    lastY = e.clientY; lastT = now;
  };

  const onUp = (e: PointerEvent) => {
    if (!active) return;
    active = false;
    try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    if (Math.abs(e.clientY - startY) > 6 && Math.abs(velocity) > 0.08) {
      velocity = -velocity;
      rafId = requestAnimationFrame(momentum);
    }
  };

  const onCancel = () => { active = false; stop(); };

  viewport.addEventListener("pointerdown",   onDown,   { passive: true });
  viewport.addEventListener("pointermove",   onMove,   { passive: true });
  viewport.addEventListener("pointerup",     onUp,     { passive: true });
  viewport.addEventListener("pointercancel", onCancel, { passive: true });

  return () => {
    stop();
    viewport.removeEventListener("pointerdown",   onDown);
    viewport.removeEventListener("pointermove",   onMove);
    viewport.removeEventListener("pointerup",     onUp);
    viewport.removeEventListener("pointercancel", onCancel);
  };
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
    let disposed = false, cleanupScroll: (() => void) | null = null;

    // Responsive font size: 14 (desktop) -> 10 (small mobile)
    const getFontSize = () => {
      if (window.innerWidth <= 375) return 10; // iPhone 6/7/8 and smaller
      if (window.innerWidth <= 480) return 11; // Small phones
      if (window.innerWidth <= 768) return 12; // Tablets
      return 14; // Desktop
    };
    const fontSize = mobile.current ? getFontSize() : 14;

    const xterm = new XTerm({
      cursorBlink:        true,
      cursorStyle:        "block",
      fontSize:           fontSize,
      lineHeight:         mobile.current ? 1.2 : 1.25,
      fontFamily:         '"Ubuntu Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace',
      fontWeight:         "400",
      theme:              THEME,
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

      if (mobile.current) cleanupScroll = attachPressureScroll(el, xterm);
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
      cleanupScroll?.();
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

  // Desktop: re-focus on click in padding/scrollbar area
  const handlePointerDown = React.useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    requestAnimationFrame(() => xtermRef.current?.focus());
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      style={{
        position:   "absolute",
        inset:      0,
        background: THEME.background,
        // GPU layer — avoids repaints when switching tabs
        willChange:  "opacity",
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
