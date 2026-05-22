import "./community.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LogIn,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RotateCcw,
} from "lucide-react";
import { TelegramChatList } from "./telegram-chat-list";
import { TelegramMessageList } from "./telegram-message-list";
import { TelegramComposer } from "./telegram-composer";
import { TelegramLogin } from "./telegram-login";
import type { TelegramChat, TelegramMessage } from "./telegram-types";

const MOCK_CHATS: TelegramChat[] = [
  {
    id: "reterm",
    title: "re.Term",
    subtitle: "native telegram shell",
    unread: 1,
  },
  {
    id: "updates",
    title: "Telegram Updates",
    subtitle: "theme-safe preview",
  },
  {
    id: "notes",
    title: "Saved Messages",
    subtitle: "local mock data",
  },
];

const MOCK_MESSAGES: TelegramMessage[] = [
  {
    id: "m1",
    chatId: "reterm",
    text: "native telegram mode starts here.",
    time: "12:04",
  },
  {
    id: "m2",
    chatId: "reterm",
    text: "this shell uses your re.Term tokens directly.",
    time: "12:05",
    outgoing: true,
  },
];

const STORAGE_KEY = "reterm.community.messages";
const COMPACT_PANE_WIDTH = 767;
const COMPACT_POINTER_QUERY = "(hover: none) and (pointer: coarse)";

function readStoredMessages(): TelegramMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return MOCK_MESSAGES;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return MOCK_MESSAGES;

    return parsed;
  } catch {
    return MOCK_MESSAGES;
  }
}

function writeStoredMessages(messages: TelegramMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {}
}

export function CommunityNativeShell() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [activeChatId, setActiveChatId] = useState(MOCK_CHATS[0].id);
  const [showLogin, setShowLogin] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messagesState, setMessagesState] = useState<TelegramMessage[]>(() =>
    readStoredMessages()
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const pointerQuery = window.matchMedia(COMPACT_POINTER_QUERY);

    const syncLayout = () => {
      const compact =
        root.getBoundingClientRect().width <= COMPACT_PANE_WIDTH ||
        pointerQuery.matches;

      setIsCompactLayout(compact);

      // Keep the user's drawer state across pane-size changes.
    };

    syncLayout();

    const observer = new ResizeObserver(syncLayout);
    observer.observe(root);
    pointerQuery.addEventListener("change", syncLayout);

    return () => {
      observer.disconnect();
      pointerQuery.removeEventListener("change", syncLayout);
    };
  }, []);

  const activeChat =
    MOCK_CHATS.find((chat) => chat.id === activeChatId) ?? MOCK_CHATS[0];

  const messages = useMemo(
    () => messagesState.filter((message) => message.chatId === activeChat.id),
    [activeChat.id, messagesState]
  );

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);

    if (isCompactLayout) {
      setSidebarOpen(false);
    }
  };

  const handleClearMessages = () => {
    setMessagesState(MOCK_MESSAGES);
    writeStoredMessages(MOCK_MESSAGES);
  };

  const handleSendMessage = (text: string) => {
    const now = new Date();

    setMessagesState((current) => {
      const next = [
        ...current,
        {
          id: `local-${Date.now()}`,
          chatId: activeChat.id,
          text,
          outgoing: true,
          time: now.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ];

      writeStoredMessages(next);
      return next;
    });
  };

  if (showLogin) {
    return (
      <div className="community-native community-native--login program-shell program-shell--community">
        <TelegramLogin onDone={() => setShowLogin(false)} />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={[
        "community-native",
        isCompactLayout ? "community-native--compact" : "community-native--desktop",
        sidebarOpen ? "community-native--sidebar-open" : "community-native--sidebar-closed",
        "program-shell",
        "program-shell--community",
      ].filter(Boolean).join(" ")}
    >
      <header className="community-topbar chat-toolbar-row">
        <div className="community-topbar-left">
          {isCompactLayout ? (
            <button
              type="button"
              className={
                sidebarOpen
                  ? "chat-tool-button community-panel-button is-active text-primary"
                  : "chat-tool-button community-panel-button text-muted-foreground"
              }
              onClick={() => setSidebarOpen((current) => !current)}
              title={sidebarOpen ? "close chats" : "open chats"}
              aria-label={sidebarOpen ? "close chats" : "open chats"}
            >
              {isCompactLayout && sidebarOpen ? (
                <PanelLeftCloseIcon className="community-panel-icon" />
              ) : (
                <PanelLeftOpenIcon className="community-panel-icon" />
              )}
            </button>
          ) : null}

          <button
            type="button"
            className="community-session-title chat-session-title"
            title="telegram community"
          >
            <span>{activeChat.title}</span>
          </button>

          <span className="community-session-subtitle">
            {activeChat.subtitle}
          </span>
        </div>

        <div className="community-topbar-actions">
          <button
            type="button"
            className="chat-tool-button community-panel-button text-muted-foreground"
            onClick={() => setShowLogin(true)}
            title="connect telegram"
          >
            <LogIn className="community-panel-icon" />
          </button>

          <button
            type="button"
            className="chat-tool-button community-panel-button text-muted-foreground"
            onClick={handleClearMessages}
            title="reset mock messages"
          >
            <RotateCcw className="community-panel-icon" />
          </button>
        </div>
      </header>

      <div className="community-workspace">
        <TelegramChatList
          chats={MOCK_CHATS}
          activeChatId={activeChat.id}
          onSelectChat={handleSelectChat}
        />

        {isCompactLayout && sidebarOpen ? (
          <button
            type="button"
            className="community-sidebar-scrim"
            aria-label="close chats"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <main className="community-main">
          <TelegramMessageList messages={messages} />
          <TelegramComposer onSendMessage={handleSendMessage} />
        </main>
      </div>
    </div>
  );
}
