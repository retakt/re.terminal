import { X } from "lucide-react";
import type { TelegramChat } from "./telegram-types";

type TelegramChatListProps = {
  chats: TelegramChat[];
  activeChatId: string;
  onSelectChat: (chatId: string) => void;
  onCloseSidebar: () => void;
};

export function TelegramChatList({
  chats,
  activeChatId,
  onSelectChat,
  onCloseSidebar,
}: TelegramChatListProps) {
  return (
    <aside className="community-sidebar">
      <div className="community-titlebar">
        <span className="community-title">telegram</span>

        <button
          type="button"
          className="community-sidebar-close"
          onClick={onCloseSidebar}
          title="close chats"
          aria-label="close chats"
        >
          <X size={13} />
        </button>
      </div>

      <div className="community-search">
        <span>&gt;</span>
        <input placeholder="search chats" />
      </div>

      <div className="community-chat-list">
        {chats.map((chat) => (
          <button
            key={chat.id}
            type="button"
            className={
              chat.id === activeChatId
                ? "community-chat community-chat--active"
                : "community-chat"
            }
            onClick={() => onSelectChat(chat.id)}
          >
            <span className="community-avatar">
              {chat.title.slice(0, 1).toLowerCase()}
            </span>

            <span className="community-chat-copy">
              <strong>{chat.title}</strong>
              <small>{chat.subtitle}</small>
            </span>

            {chat.unread ? (
              <span className="community-unread">{chat.unread}</span>
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  );
}
