import { useEffect, useRef } from "react";
import type { TelegramMessage } from "./telegram-types";

type TelegramMessageListProps = {
  messages: TelegramMessage[];
};

export function TelegramMessageList({ messages }: TelegramMessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <section className="community-messages" aria-label="messages">
      {messages.length === 0 ? (
        <div className="community-message-empty">
          <strong>telegram preview</strong>
          <span>connect tdlib next to load live chats and messages.</span>
        </div>
      ) : null}

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
          <time>
            {message.time}
            {message.status && message.status !== "sent"
              ? ` · ${message.status}`
              : ""}
          </time>
        </div>
      ))}
      <div ref={bottomRef} aria-hidden="true" />
    </section>
  );
}
