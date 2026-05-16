/**
 * KeyBar — practical SSH/nano/vim key strip.
 * Groups: clipboard | nav | signals | nano | vim | ssh utils
 */

import { useTerminal } from "@/contexts/terminal-context";

type Color = "red" | "orange" | "yellow" | "blue" | "green" | "purple" | "cyan" | "dim";
type KeyGroup = "clipboard" | "nav" | "core" | "signal" | "nano" | "vim" | "shell";

interface KeyDef {
  id:      number;
  label:   string;
  send?:   string;
  action?: "copy" | "paste";
  color?:  Color;
  group?:  KeyGroup;
}

type KeyGroupDef = {
  id: KeyGroup;
  label: string;
  keys: KeyDef[];
};

const KEY_GROUPS: KeyGroupDef[] = [
  {
    id: "clipboard",
    label: "clipboard",
    keys: [
      { id: 1, label: "copy", action: "copy", color: "cyan", group: "clipboard" },
      { id: 2, label: "paste", action: "paste", color: "purple", group: "clipboard" },
    ],
  },
  {
    id: "nav",
    label: "navigation",
    keys: [
      { id: 4, label: "↑", send: "\x1b[A", color: "dim", group: "nav" },
      { id: 5, label: "↓", send: "\x1b[B", color: "dim", group: "nav" },
      { id: 6, label: "←", send: "\x1b[D", color: "dim", group: "nav" },
      { id: 7, label: "→", send: "\x1b[C", color: "dim", group: "nav" },
      { id: 8, label: "pgup", send: "\x1b[5~", color: "dim", group: "nav" },
      { id: 9, label: "pgdn", send: "\x1b[6~", color: "dim", group: "nav" },
      { id: 10, label: "home", send: "\x1b[H", color: "dim", group: "nav" },
      { id: 11, label: "end", send: "\x1b[F", color: "dim", group: "nav" },
    ],
  },
  {
    id: "core",
    label: "core",
    keys: [
      { id: 13, label: "tab", send: "\t", color: "blue", group: "core" },
      { id: 14, label: "esc", send: "\x1b", color: "orange", group: "core" },
      { id: 15, label: "enter", send: "\r", color: "blue", group: "core" },
      { id: 16, label: "del", send: "\x1b[3~", color: "dim", group: "core" },
      { id: 17, label: "bksp", send: "\x7f", color: "dim", group: "core" },
    ],
  },
  {
    id: "signal",
    label: "signals",
    keys: [
      { id: 19, label: "ctrl+c", send: "\x03", color: "red", group: "signal" },
      { id: 20, label: "ctrl+d", send: "\x04", color: "red", group: "signal" },
      { id: 21, label: "ctrl+z", send: "\x1a", color: "orange", group: "signal" },
      { id: 22, label: "ctrl+l", send: "\x0c", color: "yellow", group: "signal" },
    ],
  },
  {
    id: "nano",
    label: "nano",
    keys: [
      { id: 24, label: "^o", send: "\x0f", color: "green", group: "nano" },
      { id: 25, label: "^x", send: "\x18", color: "green", group: "nano" },
      { id: 26, label: "^w", send: "\x17", color: "green", group: "nano" },
      { id: 27, label: "^k", send: "\x0b", color: "yellow", group: "nano" },
      { id: 28, label: "^u", send: "\x15", color: "yellow", group: "nano" },
      { id: 29, label: "^g", send: "\x07", color: "blue", group: "nano" },
    ],
  },
  {
    id: "vim",
    label: "vim",
    keys: [
      { id: 31, label: ":w", send: ":w\r", color: "green", group: "vim" },
      { id: 32, label: ":q", send: ":q\r", color: "orange", group: "vim" },
      { id: 33, label: ":wq", send: ":wq\r", color: "green", group: "vim" },
      { id: 34, label: ":q!", send: ":q!\r", color: "red", group: "vim" },
      { id: 35, label: "i", send: "i", color: "blue", group: "vim" },
      { id: 36, label: "dd", send: "dd", color: "yellow", group: "vim" },
      { id: 37, label: "u", send: "u", color: "yellow", group: "vim" },
    ],
  },
  {
    id: "shell",
    label: "shell",
    keys: [
      { id: 39, label: "ctrl+r", send: "\x12", color: "cyan", group: "shell" },
      { id: 40, label: "ctrl+a", send: "\x01", color: "blue", group: "shell" },
      { id: 41, label: "ctrl+e", send: "\x05", color: "blue", group: "shell" },
      { id: 42, label: "!!", send: "!!\r", color: "purple", group: "shell" },
      { id: 43, label: "sudo !!", send: "sudo !!\r", color: "red", group: "shell" },
    ],
  },
];

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
      {KEY_GROUPS.map(group => (
        <div
          key={group.id}
          className={`keybar-group keybar-group--${group.id}`}
          aria-label={group.label}
        >
          {group.keys.map(k => (
            <button
              key={k.id}
              className={`keybar-key keybar-key--${k.color || "base"} ${k.group ? `keybar-key--group-${k.group}` : ""}`}
              onPointerDown={e => e.preventDefault()}
              onPointerUp={e => { e.preventDefault(); handleKey(k); }}
              aria-label={k.label}
            >
              {k.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
