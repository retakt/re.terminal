import * as React from "react";
import { Loader2, Send, Trash2 } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function ChatShell() {
  const [prompt, setPrompt] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [models, setModels] = React.useState<string[]>([]);
  const [model, setModel] = React.useState(() => localStorage.getItem("reterm_ollama_model") || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/ollama/tags")
      .then(res => res.ok ? res.json() : Promise.reject(new Error("ollama offline")))
      .then(data => {
        if (cancelled) return;
        const names = Array.isArray(data.models)
          ? data.models.map((item: { name?: string }) => item.name).filter(Boolean)
          : [];
        setModels(names);
        setModel(current => current || names[0] || "llama3.1");
      })
      .catch(() => {
        if (!cancelled) setModel(current => current || "llama3.1");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (model) localStorage.setItem("reterm_ollama_model", model);
  }, [model]);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: value }];
    setMessages(nextMessages);
    setPrompt("");
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/ollama/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: nextMessages }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ollama request failed");

      const content = data.message?.content || data.response || "";
      setMessages(prev => [...prev, { role: "assistant", content: content.trim() || "(empty response)" }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ollama request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="program-shell chat-shell">
      <div className="chat-toolbar">
        <select
          className="chat-model-select"
          value={model}
          onChange={event => setModel(event.target.value)}
          aria-label="ollama model"
        >
          {models.length > 0 ? (
            models.map(name => <option key={name} value={name}>{name}</option>)
          ) : (
            <option value={model}>{model || "ollama"}</option>
          )}
        </select>

        <button
          type="button"
          className="chat-icon-button"
          onClick={() => {
            setMessages([]);
            setError("");
          }}
          title="clear chat"
          aria-label="clear chat"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="chat-thread">
        {messages.length === 0 && (
          <div className="chat-empty">Ask Ollama something.</div>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`chat-message chat-message--${message.role}`}
          >
            {message.content}
          </div>
        ))}
        {busy && (
          <div className="chat-message chat-message--assistant chat-message--busy">
            <Loader2 size={13} className="reterm-spin" />
            <span>thinking</span>
          </div>
        )}
      </div>

      <form
        className="chat-composer"
        onSubmit={e => {
          e.preventDefault();
          send(prompt);
        }}
      >
        <textarea
          className="chat-input"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder={error || "message ollama"}
          rows={2}
        />
        <button className="chat-send" type="submit" disabled={busy || !prompt.trim()}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
