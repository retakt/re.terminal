import "./community.css";
import { useMemo, useState } from "react";
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
  const [activeChatId, setActiveChatId] = useState(MOCK_CHATS[0].id);
  const [showLogin, setShowLogin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [messagesState, setMessagesState] = useState<TelegramMessage[]>(() =>
    readStoredMessages()
  );

  const activeChat =
    MOCK_CHATS.find((chat) => chat.id === activeChatId) ?? MOCK_CHATS[0];

  const messages = useMemo(
    () => messagesState.filter((message) => message.chatId === activeChat.id),
    [activeChat.id, messagesState]
  );

  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    setSidebarOpen(false);
  };

  const handleOpenSidebar = () => {
    setSidebarClosed(false);
    setSidebarOpen(true);
  };

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
    setSidebarClosed(true);
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
      className={[
        "community-native",
        sidebarOpen ? "community-native--sidebar-open" : "",
        sidebarClosed ? "community-native--sidebar-closed" : "",
        "program-shell",
        "program-shell--community",
      ].filter(Boolean).join(" ")}
    >
      <TelegramChatList
        chats={MOCK_CHATS}
        activeChatId={activeChat.id}
        onSelectChat={handleSelectChat}
        onCloseSidebar={handleCloseSidebar}
      />

      {sidebarOpen ? (
        <button
          type="button"
          className="community-sidebar-scrim"
          aria-label="close chats"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <main className="community-main">
        <TelegramMessageList
          chat={activeChat}
          messages={messages}
          onClearMessages={handleClearMessages}
          onOpenLogin={() => setShowLogin(true)}
          onOpenSidebar={handleOpenSidebar}
        />

        <TelegramComposer onSendMessage={handleSendMessage} />
      </main>
    </div>
  );
}
