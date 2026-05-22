import "./community.css";
import "./community-phone-match.css";
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
const MOBILE_PANEL_EXIT_MS = 380;

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Partial<TelegramMessage>;

  return (
    typeof message.id === "string" &&
    typeof message.chatId === "string" &&
    typeof message.text === "string" &&
    typeof message.time === "string" &&
    (message.outgoing === undefined || typeof message.outgoing === "boolean")
  );
}

function readStoredMessages(): TelegramMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return MOCK_MESSAGES;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return MOCK_MESSAGES;

    const messages = parsed.filter(isTelegramMessage);
    return messages.length > 0 ? messages : MOCK_MESSAGES;
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
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const sidebarCloseTimerRef = useRef<number | null>(null);
  const [chatQuery, setChatQuery] = useState("");
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

  const visibleChats = useMemo(() => {
    const query = chatQuery.trim().toLowerCase();
    if (!query) return MOCK_CHATS;

    return MOCK_CHATS.filter((chat) =>
      `${chat.title} ${chat.subtitle}`.toLowerCase().includes(query)
    );
  }, [chatQuery]);

  const activeChat =
    MOCK_CHATS.find((chat) => chat.id === activeChatId) ?? MOCK_CHATS[0];

  const messages = useMemo(
    () => messagesState.filter((message) => message.chatId === activeChat.id),
    [activeChat.id, messagesState]
  );

  const clearSidebarCloseTimer = () => {
    if (sidebarCloseTimerRef.current === null) return;
    window.clearTimeout(sidebarCloseTimerRef.current);
    sidebarCloseTimerRef.current = null;
  };

  const openSidebar = () => {
    clearSidebarCloseTimer();
    setSidebarClosing(false);
    setSidebarOpen(true);
  };

  const closeSidebar = () => {
    if (!sidebarOpen) return;

    clearSidebarCloseTimer();
    setSidebarOpen(false);
    setSidebarClosing(true);

    sidebarCloseTimerRef.current = window.setTimeout(() => {
      setSidebarClosing(false);
      sidebarCloseTimerRef.current = null;
    }, MOBILE_PANEL_EXIT_MS);
  };

  const toggleSidebar = () => {
    if (sidebarOpen) closeSidebar();
    else openSidebar();
  };

  useEffect(() => {
    return () => clearSidebarCloseTimer();
  }, []);

  const sidebarMounted = isCompactLayout && (sidebarOpen || sidebarClosing);
  const sidebarMotionClass = sidebarClosing ? "is-closing" : "is-open";

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);

    if (isCompactLayout) {
      closeSidebar();
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
      <header
        className={
          isCompactLayout
            ? "chat-toolbar-row relative z-30 flex items-center justify-between px-3 py-2.5"
            : "community-topbar chat-toolbar-row"
        }
      >
        <div
          className={
            isCompactLayout
              ? "flex min-w-0 flex-1 items-center gap-2.5"
              : "community-topbar-left"
          }
        >
          {isCompactLayout ? (
            <button
              type="button"
              className={
                sidebarOpen
                  ? "chat-tool-button size-8 rounded-sm transition-all duration-150 is-active text-primary"
                  : "chat-tool-button size-8 rounded-sm transition-all duration-150 text-muted-foreground"
              }
              onClick={toggleSidebar}
              title={sidebarOpen ? "close chats" : "open chats"}
              aria-label={sidebarOpen ? "close chats" : "open chats"}
            >
              {sidebarOpen ? (
                <PanelLeftCloseIcon className="size-4" />
              ) : (
                <PanelLeftOpenIcon className="size-4" />
              )}
            </button>
          ) : null}

          <button
            type="button"
            className={
              isCompactLayout
                ? "chat-session-title"
                : "community-session-title chat-session-title"
            }
            title="telegram community"
            aria-label={`active chat: ${activeChat.title}`}
          >
            <span>{activeChat.title}</span>
          </button>

          {!isCompactLayout ? (
            <span className="community-session-subtitle">
              {activeChat.subtitle}
            </span>
          ) : null}
        </div>

        <div
          className={
            isCompactLayout
              ? "flex items-center gap-1.5"
              : "community-topbar-actions"
          }
        >
          <button
            type="button"
            className={
              isCompactLayout
                ? "chat-tool-button size-8 rounded-sm text-muted-foreground"
                : "chat-tool-button community-panel-button text-muted-foreground"
            }
            onClick={() => setShowLogin(true)}
            title="mock telegram login"
            aria-label="open mock telegram login"
          >
            <LogIn className={isCompactLayout ? "size-4" : "community-panel-icon"} />
          </button>

          <button
            type="button"
            className={
              isCompactLayout
                ? "chat-tool-button size-8 rounded-sm text-muted-foreground"
                : "chat-tool-button community-panel-button text-muted-foreground"
            }
            onClick={handleClearMessages}
            title="reset mock messages"
            aria-label="reset mock messages"
          >
            <RotateCcw className={isCompactLayout ? "size-4" : "community-panel-icon"} />
          </button>
        </div>
      </header>

      <div className="community-workspace">
        {isCompactLayout ? (
          sidebarMounted ? (
            <TelegramChatList
              chats={visibleChats}
              activeChatId={activeChat.id}
              query={chatQuery}
              className={`chat-mobile-context-drawer community-mobile-drawer ${sidebarMotionClass}`}
              onQueryChange={setChatQuery}
              onSelectChat={handleSelectChat}
            />
          ) : null
        ) : (
          <TelegramChatList
            chats={visibleChats}
            activeChatId={activeChat.id}
            query={chatQuery}
            onQueryChange={setChatQuery}
            onSelectChat={handleSelectChat}
          />
        )}

        {sidebarMounted ? (
          <button
            type="button"
            className={`chat-mobile-context-backdrop ${sidebarMotionClass}`}
            aria-label="close chats"
            disabled={sidebarClosing}
            onClick={closeSidebar}
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
