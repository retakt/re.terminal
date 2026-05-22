import "./community.css";
import "./community-phone-match.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getCommunityStatus,
  listCommunityChats,
  listCommunityMessages,
  sendCommunityMessage,
  type CommunityServiceStatus,
} from "./lib/community-api";

const COMMUNITY_SERVICE = "telegram" as const;

const FALLBACK_CHATS: TelegramChat[] = [
  {
    id: "telegram:reterm",
    nativeId: "reterm",
    service: "telegram",
    title: "re.Term",
    subtitle: "community api unavailable",
    unread: 0,
  },
];

const FALLBACK_MESSAGES: TelegramMessage[] = [
  {
    id: "telegram:fallback",
    service: "telegram",
    chatId: "telegram:reterm",
    text: "community adapter is not reachable yet.",
    time: "now",
    status: "failed",
  },
];

const COMPACT_PANE_WIDTH = 767;
const COMPACT_POINTER_QUERY = "(hover: none) and (pointer: coarse)";
const MOBILE_PANEL_EXIT_MS = 380;

export function CommunityNativeShell() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sidebarCloseTimerRef = useRef<number | null>(null);

  const [activeChatId, setActiveChatId] = useState(FALLBACK_CHATS[0].id);
  const [showLogin, setShowLogin] = useState(false);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [chatQuery, setChatQuery] = useState("");
  const [chats, setChats] = useState<TelegramChat[]>(FALLBACK_CHATS);
  const [messagesState, setMessagesState] = useState<TelegramMessage[]>(FALLBACK_MESSAGES);
  const [telegramStatus, setTelegramStatus] = useState<CommunityServiceStatus>({
    ok: true,
    service: COMMUNITY_SERVICE,
    state: "preview",
    accountLabel: "tdlib not connected",
    connected: false,
  });
  const [loadingMessages, setLoadingMessages] = useState(false);

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

  const loadStatus = useCallback(async () => {
    try {
      setTelegramStatus(await getCommunityStatus(COMMUNITY_SERVICE));
    } catch (err) {
      setTelegramStatus({
        ok: false,
        service: COMMUNITY_SERVICE,
        state: "error",
        accountLabel: err instanceof Error ? err.message : "community api unavailable",
        connected: false,
      });
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const result = await listCommunityChats(COMMUNITY_SERVICE);
      const nextChats = result.chats.length ? result.chats : FALLBACK_CHATS;

      setChats(nextChats);
      setActiveChatId((current) =>
        nextChats.some((chat) => chat.id === current) ? current : nextChats[0].id
      );
    } catch {
      setChats(FALLBACK_CHATS);
      setActiveChatId(FALLBACK_CHATS[0].id);
      setTelegramStatus((current) => ({
        ...current,
        ok: false,
        state: "error",
        accountLabel: "community api unavailable",
        connected: false,
      }));
    }
  }, []);

  const loadMessages = useCallback(async (chatId: string) => {
    setLoadingMessages(true);

    try {
      const result = await listCommunityMessages(COMMUNITY_SERVICE, chatId);
      setMessagesState(result.messages);
    } catch {
      setMessagesState(
        FALLBACK_MESSAGES.map((message) => ({
          ...message,
          chatId,
        }))
      );
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadChats();
  }, [loadChats, loadStatus]);

  useEffect(() => {
    if (!activeChatId) return;
    void loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

  const visibleChats = useMemo(() => {
    const query = chatQuery.trim().toLowerCase();
    if (!query) return chats;

    return chats.filter((chat) =>
      `${chat.title} ${chat.subtitle}`.toLowerCase().includes(query)
    );
  }, [chatQuery, chats]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId) ?? chats[0] ?? FALLBACK_CHATS[0];

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

  const handleRefresh = () => {
    void loadStatus();
    void loadChats();
    void loadMessages(activeChat.id);
  };

  const handleSendMessage = async (text: string) => {
    const optimisticId = `telegram:optimistic-${Date.now()}`;
    const optimisticMessage: TelegramMessage = {
      id: optimisticId,
      service: COMMUNITY_SERVICE,
      chatId: activeChat.id,
      text,
      outgoing: true,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "sending",
    };

    setMessagesState((current) => [...current, optimisticMessage]);

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 240));
      const result = await sendCommunityMessage(COMMUNITY_SERVICE, activeChat.id, text);
      setMessagesState((current) =>
        current.map((message) =>
          message.id === optimisticId ? result.message : message
        )
      );
    } catch {
      setMessagesState((current) =>
        current.map((message) =>
          message.id === optimisticId ? { ...message, status: "failed" } : message
        )
      );
    }
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
            title="telegram community preview"
            aria-label={`active chat: ${activeChat.title}`}
          >
            <span>{activeChat.title}</span>
          </button>

          {!isCompactLayout ? (
            <>
              <span className="community-session-subtitle">
                {loadingMessages ? "loading messages" : activeChat.subtitle}
              </span>
              <span className={`community-status-pill community-status-pill--${telegramStatus.state}`}>
                {telegramStatus.state}
              </span>
            </>
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
            title="open telegram preview login"
            aria-label="open telegram preview login"
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
            onClick={handleRefresh}
            title="refresh community preview"
            aria-label="refresh community preview"
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
              status={telegramStatus.state}
              accountLabel={telegramStatus.accountLabel}
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
            status={telegramStatus.state}
            accountLabel={telegramStatus.accountLabel}
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
