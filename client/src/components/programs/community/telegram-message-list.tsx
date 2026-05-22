import type { TelegramMessage } from "./telegram-types";

type TelegramMessageListProps = {
  messages: TelegramMessage[];
};

export function TelegramMessageList({ messages }: TelegramMessageListProps) {
  return (
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
  );
}
