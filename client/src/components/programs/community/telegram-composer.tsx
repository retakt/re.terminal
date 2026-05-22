import { useState } from "react";
import { Send } from "lucide-react";

type TelegramComposerProps = {
  onSendMessage: (text: string) => void;
};

export function TelegramComposer({ onSendMessage }: TelegramComposerProps) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (!text) return;

    onSendMessage(text);
    setDraft("");
  };

  return (
    <form
      className="community-composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <span className="community-composer-prompt">&gt;</span>

      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="message"
      />

      <button type="submit">
        <Send size={13} />
        send
      </button>
    </form>
  );
}
