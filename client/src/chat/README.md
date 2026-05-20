# re.Terminal Chat Module

## 📁 Structure

```
src/chat/
├── api/              # Pure API services (Ollama client)
│   └── ollama.ts     # Streaming & non-streaming Ollama API calls
├── engine/           # Chat engine & provider
│   ├── chat-provider.tsx    # Main ChatProvider (React context + runtime)
│   ├── config.ts            # System prompt, model config, auto-think logic
│   ├── pause-dictation-adapter.ts  # Voice input adapter
│   └── slash-commands.ts    # Slash command parser
├── tools/            # Tool executors (reusable by scripts/MCP/extensions)
│   ├── definitions.ts       # Tool definitions (sent to Ollama)
│   └── executor.ts          # Tool execution functions
├── types/            # Shared TypeScript types
│   └── index.ts
├── components/       # UI components (fully custom styled)
│   ├── attachment.tsx       # File/image attachments
│   ├── chat-shell.tsx       # Main entry point with layout
│   ├── markdown-text.tsx    # Markdown rendering with syntax highlighting
│   ├── reasoning.tsx        # Reasoning/thinking display
│   ├── right-panel.tsx      # Activity log panel (thinking + tool calls)
│   ├── thread.tsx           # Chat thread UI
│   ├── tool-fallback.tsx    # Tool call display
│   └── tooltip-icon-button.tsx
├── hooks/            # Custom React hooks (future)
└── index.ts          # Public exports
```

## 🚀 Usage

### In the app (ChatShell)

```tsx
import { ChatShell } from "@/chat";

// Use in your program routing
<ChatShell />
```

### API layer (for scripts/MCP/extensions)

```ts
import { ollamaChatStream, ollamaChatNonStream, executeTool, TOOLS } from "@/chat";

// Stream a chat
for await (const chunk of ollamaChatStream({
  model: "llama3.1",
  messages: [{ role: "user", content: "Hello" }],
})) {
  console.log(chunk.message?.content);
}

// Execute a tool directly
const weather = await executeTool("get_weather", { city: "Tokyo" });
```

## 🔧 Configuration

Create `.env.local` in the client directory:

```env
VITE_OLLAMA_URL=http://localhost:11434
VITE_SEARXNG_URL=http://localhost:8080
VITE_MODEL_ID=joe-speedboat/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b
```

## 🎨 Design

- **@assistant-ui/react**: Headless primitives (100% customizable styling)
- **Tailwind CSS**: All styling via utility classes
- **Right panel**: Collapsible activity log showing thinking + tool calls
- **Resizable**: Uses `react-resizable-panels` for future resizable panels

## 🔌 API-Type Architecture

The chat module is designed to be reusable:

1. **`api/`** — Pure functions, no React. Can be used by any program.
2. **`tools/`** — Tool executors. Can be called by scripts, MCP servers, extensions.
3. **`engine/`** — Chat logic. Connects API to React runtime.
4. **`components/`** — UI only. Wraps engine in React components.

This means your future **scripts**, **MCP server**, and **extensions** can all use the same Ollama API and tools without depending on React.

## 📦 Dependencies Added

- `@assistant-ui/react` — Headless chat primitives
- `@assistant-ui/react-markdown` — Markdown rendering
- `react-shiki` — Syntax highlighting
- `remark-gfm`, `remark-math`, `rehype-katex` — Markdown plugins
- `shiki` — Code highlighting engine
- `zustand` — State management (used by assistant-ui)
- `katex` — Math rendering
