/**
 * HackerToolbar — iOS/Android extra key row above the soft keyboard.
 *
 * Provides the keys that gboard/iOS keyboard don't have:
 * Ctrl, Alt, Tab, Esc, arrows, pipe, tilde, slash, etc.
 *
 * Only renders on touch devices.
 */

import * as React from "react";
import { useTerminal } from "@/contexts/terminal-context";
import { ChevronUp } from "lucide-react";

interface Props {
  sessionId: string | null;
}

// ─── Key definitions ──────────────────────────────────────────────────────────

type KeyDef =
  | { label: string; send: string; wide?: boolean; icon?: never }
  | { label?: string; icon: React.ReactNode; send: string; wide?: boolean };

// Row 1 — modifier + special keys
const ROW1: KeyDef[] = [
  { label: "Ctrl",  send: "\x00ctrl",  wide: true  },  // handled specially
  { label: "Alt",   send: "\x00alt",   wide: true  },  // handled specially
  { label: "Esc",   send: "\x1b"                   },
  { label: "Tab",   send: "\t"                     },
  { label: "↑",     send: "\x1b[A"                 },
  { label: "↓",     send: "\x1b[B"                 },
  { label: "←",     send: "\x1b[D"                 },
  { label: "→",     send: "\x1b[C"                 },
];

// Row 2 — symbols missing from most mobile keyboards
const ROW2: KeyDef[] = [
  { label: "~",  send: "~"  },
  { label: "|",  send: "|"  },
  { label: "/",  send: "/"  },
  { label: "\\", send: "\\" },
  { label: "-",  send: "-"  },
  { label: "_",  send: "_"  },
  { label: ":",  send: ":"  },
  { label: ";",  send: ";"  },
  { label: "'",  send: "'"  },
  { label: '"',  send: '"'  },
  { label: "`",  send: "`"  },
  { label: "&",  send: "&"  },
  { label: "*",  send: "*"  },
  { label: "!",  send: "!"  },
  { label: "?",  send: "?"  },
  { label: "#",  send: "#"  },
  { label: "@",  send: "@"  },
  { label: "$",  send: "$"  },
  { label: "%",  send: "%"  },
  { label: "^",  send: "^"  },
  { label: "(",  send: "("  },
  { label: ")",  send: ")"  },
  { label: "[",  send: "["  },
  { label: "]",  send: "]"  },
  { label: "{",  send: "{"  },
  { label: "}",  send: "}"  },
  { label: "<",  send: "<"  },
  { label: ">",  send: ">"  },
  { label: "=",  send: "="  },
  { label: "+",  send: "+"  },
];

// Ctrl+key combos (sent when Ctrl is held)
const CTRL_KEYS: KeyDef[] = [
  { label: "C",  send: "\x03" },  // SIGINT
  { label: "D",  send: "\x04" },  // EOF
  { label: "Z",  send: "\x1a" },  // SIGTSTP
  { label: "L",  send: "\x0c" },  // clear
  { label: "A",  send: "\x01" },  // start of line
  { label: "E",  send: "\x05" },  // end of line
  { label: "U",  send: "\x15" },  // kill line
  { label: "K",  send: "\x0b" },  // kill to end
  { label: "W",  send: "\x17" },  // kill word
  { label: "R",  send: "\x12" },  // reverse search
  { label: "\\", send: "\x1c" },  // SIGQUIT
];

// ─── Component ────────────────────────────────────────────────────────────────

export function HackerToolbar({ sessionId }: Props) {
  const { sendInput } = useTerminal();
  const [ctrlHeld,  setCtrlHeld]  = React.useState(false);
  const [altHeld,   setAltHeld]   = React.useState(false);
  const [showRow2,  setShowRow2]  = React.useState(false);

  // Only show on touch devices
  const [isTouch, setIsTouch] = React.useState(false);
  React.useEffect(() => {
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  if (!isTouch || !sessionId) return null;

  const send = (data: string) => {
    if (!sessionId) return;

    // Handle modifier combos
    if (altHeld && data.length === 1) {
      sendInput(sessionId, `\x1b${data}`);
      setAltHeld(false);
      return;
    }

    sendInput(sessionId, data);
  };

  const handleKey = (key: KeyDef) => {
    const s = key.send;

    if (s === "\x00ctrl") {
      setCtrlHeld(v => !v);
      setAltHeld(false);
      return;
    }
    if (s === "\x00alt") {
      setAltHeld(v => !v);
      setCtrlHeld(false);
      return;
    }

    send(s);
    // Auto-release modifiers after use
    setCtrlHeld(false);
    setAltHeld(false);
  };

  const activeKeys = ctrlHeld ? CTRL_KEYS : (showRow2 ? ROW2 : ROW1);

  return (
    <div className="hkt-root">
      {/* Modifier state indicator */}
      {(ctrlHeld || altHeld) && (
        <div className="hkt-modifier-indicator">
          {ctrlHeld && <span className="hkt-mod-active">Ctrl</span>}
          {altHeld  && <span className="hkt-mod-active">Alt</span>}
          <span className="hkt-mod-hint">— tap a key</span>
        </div>
      )}

      {/* Key row */}
      <div className="hkt-row">
        {/* Toggle symbols row */}
        <button
          className={`hkt-key hkt-key--toggle ${showRow2 && !ctrlHeld ? "hkt-key--on" : ""}`}
          onPointerDown={e => { e.preventDefault(); if (!ctrlHeld) setShowRow2(v => !v); }}
          aria-label="Toggle symbols"
        >
          <ChevronUp size={13} strokeWidth={2.5} />
        </button>

        <div className="hkt-divider" />

        {/* Scrollable keys */}
        <div className="hkt-keys-scroll">
          {activeKeys.map((k, i) => {
            const isModifier = k.send === "\x00ctrl" || k.send === "\x00alt";
            const isActive   = (k.send === "\x00ctrl" && ctrlHeld) || (k.send === "\x00alt" && altHeld);
            const label      = "label" in k ? k.label : undefined;

            return (
              <button
                key={i}
                className={[
                  "hkt-key",
                  isModifier ? "hkt-key--mod" : "",
                  isActive   ? "hkt-key--on"  : "",
                  k.wide     ? "hkt-key--wide" : "",
                ].filter(Boolean).join(" ")}
                onPointerDown={e => { e.preventDefault(); handleKey(k); }}
                aria-label={label}
              >
                {"icon" in k && k.icon ? k.icon : label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
