/**
 * KeyBar — practical SSH/nano/vim key strip.
 * Groups: clipboard | nav | signals | nano | vim | ssh utils
 */

import { useTerminal } from "@/contexts/terminal-context";

type Color = "red" | "orange" | "yellow" | "blue" | "green" | "purple" | "cyan" | "dim";

interface KeyDef {
  id:      number;
  label:   string;
  send?:   string;
  action?: "copy" | "paste";
  color?:  Color;
  sep?:    true;
}

const KEYS: KeyDef[] = [
  // ── clipboard ──────────────────────────────────────────────────────────────
  { id: 1,  label: "copy",     action: "copy",  color: "cyan"   },
  { id: 2,  label: "paste",    action: "paste", color: "purple" },
  { id: 3,  sep: true, label: "" },

  // ── arrows + page ──────────────────────────────────────────────────────────
  { id: 4,  label: "↑",        send: "\x1b[A",  color: "dim"    },
  { id: 5,  label: "↓",        send: "\x1b[B",  color: "dim"    },
  { id: 6,  label: "←",        send: "\x1b[D",  color: "dim"    },
  { id: 7,  label: "→",        send: "\x1b[C",  color: "dim"    },
  { id: 8,  label: "pgup",     send: "\x1b[5~", color: "dim"    },
  { id: 9,  label: "pgdn",     send: "\x1b[6~", color: "dim"    },
  { id: 10, label: "home",     send: "\x1b[H",  color: "dim"    },
  { id: 11, label: "end",      send: "\x1b[F",  color: "dim"    },
  { id: 12, sep: true, label: "" },

  // ── essential keys ─────────────────────────────────────────────────────────
  { id: 13, label: "tab",      send: "\t",      color: "blue"   },
  { id: 14, label: "esc",      send: "\x1b",    color: "orange" },
  { id: 15, label: "enter",    send: "\r",      color: "blue"   },
  { id: 16, label: "del",      send: "\x1b[3~", color: "dim"    },
  { id: 17, label: "bksp",     send: "\x7f",    color: "dim"    },
  { id: 18, sep: true, label: "" },

  // ── signals / session ──────────────────────────────────────────────────────
  { id: 19, label: "ctrl+c",   send: "\x03",    color: "red"    },  // interrupt
  { id: 20, label: "ctrl+d",   send: "\x04",    color: "red"    },  // EOF / logout
  { id: 21, label: "ctrl+z",   send: "\x1a",    color: "orange" },  // suspend
  { id: 22, label: "ctrl+l",   send: "\x0c",    color: "yellow" },  // clear screen
  { id: 23, sep: true, label: "" },

  // ── nano keys ──────────────────────────────────────────────────────────────
  { id: 24, label: "^o",       send: "\x0f",    color: "green"  },  // nano save
  { id: 25, label: "^x",       send: "\x18",    color: "green"  },  // nano exit
  { id: 26, label: "^w",       send: "\x17",    color: "green"  },  // nano search
  { id: 27, label: "^k",       send: "\x0b",    color: "yellow" },  // nano cut line
  { id: 28, label: "^u",       send: "\x15",    color: "yellow" },  // nano paste/uncut
  { id: 29, label: "^g",       send: "\x07",    color: "blue"   },  // nano help
  { id: 30, sep: true, label: "" },

  // ── vim keys ───────────────────────────────────────────────────────────────
  { id: 31, label: ":w",       send: ":w\r",    color: "green"  },  // vim save
  { id: 32, label: ":q",       send: ":q\r",    color: "orange" },  // vim quit
  { id: 33, label: ":wq",      send: ":wq\r",   color: "green"  },  // vim save+quit
  { id: 34, label: ":q!",      send: ":q!\r",   color: "red"    },  // vim force quit
  { id: 35, label: "i",        send: "i",       color: "blue"   },  // vim insert
  { id: 36, label: "dd",       send: "dd",      color: "yellow" },  // vim delete line
  { id: 37, label: "u",        send: "u",       color: "yellow" },  // vim undo
  { id: 38, sep: true, label: "" },

  // ── ssh / shell utils ──────────────────────────────────────────────────────
  { id: 39, label: "ctrl+r",   send: "\x12",    color: "cyan"   },  // history search
  { id: 40, label: "ctrl+a",   send: "\x01",    color: "blue"   },  // line start
  { id: 41, label: "ctrl+e",   send: "\x05",    color: "blue"   },  // line end
  { id: 42, label: "!!",       send: "!!\r",    color: "purple" },  // repeat last cmd
  { id: 43, label: "sudo !!",  send: "sudo !!\r",color: "red"   },  // sudo last cmd
];

const BG: Record<Color, string> = {
  red:    "rgba(247,118,142,0.14)",
  orange: "rgba(255,158,100,0.14)",
  yellow: "rgba(224,175,104,0.14)",
  blue:   "rgba(122,162,247,0.14)",
  green:  "rgba(158,206,106,0.14)",
  purple: "rgba(187,154,247,0.14)",
  cyan:   "rgba(125,207,255,0.14)",
  dim:    "rgba(65,72,104,0.28)",
};
const FG: Record<Color, string> = {
  red:    "#f7768e",
  orange: "#ff9e64",
  yellow: "#e0af68",
  blue:   "#7aa2f7",
  green:  "#9ece6a",
  purple: "#bb9af7",
  cyan:   "#7dcfff",
  dim:    "#a9b1d6",
};

interface Props { sessionId: string | null; }

export function KeyBar({ sessionId }: Props) {
  const { sendInput, getXterm } = useTerminal();

  if (!sessionId) return null;

  const handleKey = async (key: KeyDef) => {
    if (key.action === "copy") {
      const xterm = getXterm(sessionId);
      if (xterm) {
        const sel = xterm.getSelection();
        if (sel) { try { await navigator.clipboard.writeText(sel); } catch (_) {} }
      }
      return;
    }
    if (key.action === "paste") {
      try {
        const text = await navigator.clipboard.readText();
        if (text) sendInput(sessionId, text);
      } catch (_) {}
      return;
    }
    if (key.send) sendInput(sessionId, key.send);
  };

  return (
    <div className="keybar" role="toolbar" aria-label="terminal keys">
      {KEYS.map(k =>
        k.sep ? (
          <div key={k.id} className="keybar-sep" aria-hidden />
        ) : (
          <button
            key={k.id}
            className="keybar-key"
            style={k.color ? {
              background:  BG[k.color],
              color:       FG[k.color],
              borderColor: `${FG[k.color]}22`,
            } : undefined}
            onPointerDown={e => e.preventDefault()}
            onPointerUp={e => { e.preventDefault(); handleKey(k); }}
            aria-label={k.label}
          >
            {k.label}
          </button>
        )
      )}
    </div>
  );
}
