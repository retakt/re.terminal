import { LogIn, Menu, RotateCcw } from "lucide-react";
import type { TelegramChat, TelegramMessage } from "./telegram-types";

type TelegramMessageListProps = {
  chat: TelegramChat;
  messages: TelegramMessage[];
  onClearMessages: () => void;
  onOpenLogin: () => void;
  onOpenSidebar: () => void;
};

export function TelegramMessageList({
  chat,
  messages,
  onClearMessages,
  onOpenLogin,
  onOpenSidebar,
}: TelegramMessageListProps) {
  return (
    <>
      <header className="community-header">
        <button
          type="button"
          className="community-mobile-sidebar-btn"
          onClick={onOpenSidebar}
          title="open chats"
          aria-label="open chats"
        >
          <Menu size={14} />
        </button>

        <div className="community-header-copy">
          <strong>{chat.title}</strong>
          <small>{chat.subtitle}</small>
        </div>

        <div className="community-header-actions">
          <button
            type="button"
            className="community-header-action"
            onClick={onOpenLogin}
            title="open telegram auth"
          >
            <LogIn size={13} />
            connect
          </button>

          <button
            type="button"
            className="community-header-action"
            onClick={onClearMessages}
            title="reset mock messages"
          >
            <RotateCcw size={13} />
            reset
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
