import type { TelegramChat } from "./telegram-types";

type TelegramChatListProps = {
  chats: TelegramChat[];
  activeChatId: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelectChat: (chatId: string) => void;
};

export function TelegramChatList({
  chats,
  activeChatId,
  query,
  onQueryChange,
  onSelectChat,
}: TelegramChatListProps) {
  return (
    <aside className="community-sidebar">
      <div className="community-titlebar">
        <span className="community-title">telegram</span>
      </div>

      <label className="community-search">
        <span aria-hidden="true">&gt;</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="search chats"
          aria-label="search chats"
        />
      </label>

      <div className="community-chat-list">
        {chats.length === 0 ? (
          <p className="community-empty">no chats found</p>
        ) : (
          chats.map((chat) => (
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
              <span className="community-avatar" aria-hidden="true">
                {chat.title.slice(0, 1).toLowerCase()}
              </span>

              <span className="community-chat-copy">
                <strong>{chat.title}</strong>
                <small>{chat.subtitle}</small>
              </span>

              {chat.unread ? (
                <span className="community-unread" aria-label={`${chat.unread} unread`}>
                  {chat.unread}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
