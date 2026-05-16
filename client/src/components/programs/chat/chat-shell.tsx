import * as React from "react";
import { MessageSquareText, Send } from "lucide-react";

const starterNotes = [
  "Ask the assistant to summarize a file.",
  "Turn a terminal output into a checklist.",
  "Keep quick project notes while you work.",
];

export function ChatShell() {
  const [prompt, setPrompt] = React.useState("");
  const [messages, setMessages] = React.useState<string[]>([
    "This space is ready for your AI chat integration.",
  ]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value) return;
    setMessages(prev => [...prev, value]);
    setPrompt("");
  };

  return (
    <div className="program-shell program-shell--chat">
      <div className="program-hero">
        <div className="program-kicker">
          <MessageSquareText size={14} />
          <span>ai chat</span>
        </div>
        <h2>conversation workspace</h2>
        <p>A lightweight chat surface for prompts, notes, and future model connections.</p>
      </div>

      <div className="program-card-list">
        {messages.map((message, index) => (
          <div key={`${index}-${message}`} className="program-card program-card--chat">
            {message}
          </div>
        ))}
      </div>

      <div className="program-chip-row">
        {starterNotes.map(note => (
          <button key={note} className="program-chip" type="button" onClick={() => send(note)}>
            {note}
          </button>
        ))}
      </div>

      <form
        className="program-launcher program-launcher--stacked"
        onSubmit={e => {
          e.preventDefault();
          send(prompt);
        }}
      >
        <textarea
          className="program-input program-input--textarea"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="type a prompt or note"
          rows={3}
        />
        <button className="program-button" type="submit">
          <Send size={14} />
          <span>send</span>
        </button>
      </form>
    </div>
  );
}
