import {
  LogIn,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RotateCcw,
} from "lucide-react";
import type { TelegramChat, TelegramMessage } from "./telegram-types";

type TelegramMessageListProps = {
  chat: TelegramChat;
  messages: TelegramMessage[];
  onClearMessages: () => void;
  onOpenLogin: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
};

export function TelegramMessageList({
  chat,
  messages,
  onClearMessages,
  onOpenLogin,
  onToggleSidebar,
  sidebarOpen,
}: TelegramMessageListProps) {
  return (
    <>
      <header className="community-header chat-toolbar-row">
        <div className="community-header-left">
          <button
            type="button"
            className={
              sidebarOpen
                ? "chat-tool-button community-sidebar-handle size-8 rounded-sm transition-all duration-150 is-active text-primary"
                : "chat-tool-button community-sidebar-handle size-8 rounded-sm transition-all duration-150 text-muted-foreground"
            }
            onClick={onToggleSidebar}
            title={sidebarOpen ? "close chats" : "open chats"}
            aria-label={sidebarOpen ? "close chats" : "open chats"}
          >
            {sidebarOpen ? (
              <PanelLeftCloseIcon className="size-4" />
            ) : (
              <PanelLeftOpenIcon className="size-4" />
            )}
          </button>

          <button
            type="button"
            className="community-session-title chat-session-title"
            title="telegram community"
          >
            <span>{chat.title}</span>
          </button>

          <span className="community-session-subtitle">{chat.subtitle}</span>
        </div>

        <div className="community-header-actions">
          <button
            type="button"
            className="chat-tool-button community-header-action size-8 rounded-sm text-muted-foreground transition-colors"
            onClick={onOpenLogin}
            title="connect telegram"
          >
            <LogIn className="size-4" />
          </button>

          <button
            type="button"
            className="chat-tool-button community-header-action size-8 rounded-sm text-muted-foreground transition-colors"
            onClick={onClearMessages}
            title="reset mock messages"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </header>

      <section className="community-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.outgoing
                ? "community-message community-message--outgoing"
                : "community-message"
            }
          >
            <span>{message.text}</span>
            <time>{message.time}</time>
          </div>
        ))}
      </section>
    </>
  );
}
