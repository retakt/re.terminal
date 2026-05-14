/**
TerminalInstance
Modified for Ambient Mode:
- Semi-transparent background allows the video to bleed through.
- High contrast text colors.
- Fixed sizing logic for the new containerized layout.
*/
import * as React from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminal } from "@/contexts/terminal-context";
import "@xterm/xterm/css/xterm.css";

interface Props { sessionId: string; isActive: boolean; }

// Enhanced Aurelia Theme for Ambient Background
const THEME = {
  background:           "rgba(22, 22, 30, 0.7)", // Transparent-ish
  foreground:           "#e2e8f0",
  cursor:               "#3bd98b",                // Neon Green Cursor
  cursorAccent:         "rgba(22, 22, 30, 0.7)",
  selectionBackground:  "rgba(59, 217, 139, 0.3)",
  black:    "#18181b", red:      "#f87171", green:    "#4ade80",
  yellow:   "#fbbf24", blue:     "#60a5fa", magenta:  "#c084fc",
  cyan:     "#22d3ee", white:    "#f8fafc",
  brightBlack:    "#64748b", brightRed:      "#fca5a5",
  brightGreen:    "#86efac", brightYellow:   "#fde68a",
  brightBlue:     "#93c5fd", brightMagenta:  "#d8b4fe",
  brightCyan:     "#67e8f9", brightWhite:    "#ffffff",
};

export function TerminalInstance({ sessionId, isActive }: Props) {
  const { registerXterm, unregisterXterm, sendInput } = useTerminal();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const xtermRef     = React.useRef<XTerm | null>(null);
  const fitRef       = React.useRef<FitAddon | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    let disposed = false;

    const xterm = new XTerm({
      cursorBlink:        true,
      cursorStyle:        "block",
      fontSize:           15,
      fontFamily:         '"JetBrains Mono", "Ubuntu Mono", monospace',
      fontWeight:          "500",
      theme:              THEME,
      allowProposedApi:   true,
      scrollback:         5000,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.loadAddon(new WebLinksAddon());

    if (disposed) { xterm.dispose(); return; }

    xterm.open(el);

    requestAnimationFrame(() => {
      if (disposed) return;
      fitAddon.fit();
      xterm.focus();
    });

    xtermRef.current = xterm;
    fitRef.current   = fitAddon;

    xterm.onData(data => { if (!disposed) sendInput(sessionId, data); });
    registerXterm(sessionId, xterm);

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      try { fitAddon.fit(); } catch (_) {}
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      unregisterXterm(sessionId);
      xterm.dispose();
    };
  }, [sessionId]);

  // Refocus when switching tabs
  React.useEffect(() => {
    if (isActive) xtermRef.current?.focus();
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        // Use opacity transition for smooth tab switching
        opacity: isActive ? 1 : 0,
        pointerEvents: isActive ? "auto" : "none",
        zIndex: isActive ? 1 : 0,
        transition: "opacity 0.1s ease",
        // Allow content to scroll naturally
        overflow: "hidden", 
      }}
    />
  );
}
