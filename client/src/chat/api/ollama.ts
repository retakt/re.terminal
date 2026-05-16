// ── Ollama API client ────────────────────────────────────────────────────────
// Pure API service — no React dependencies. Reusable by scripts/MCP/extensions.

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:11434`.replace(/^wss?/, "http");

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  audio?: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, string> } }>;
  tool_name?: string;
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      required?: string[];
      properties: Record<string, { type: string; description: string }>;
    };
  };
}

export interface OllamaChatOptions {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  think?: boolean;
  tools?: OllamaTool[];
  options?: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
    num_ctx?: number;
  };
  signal?: AbortSignal;
}

export interface OllamaChunk {
  message?: {
    thinking?: string;
    content?: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, string> } }>;
  };
  done?: boolean;
}

export interface OllamaToolCheckResponse {
  message?: {
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, string> } }>;
  };
}

// ── Non-streaming request (for tool checks) ──────────────────────────────────

export async function ollamaChatNonStream(options: OllamaChatOptions): Promise<OllamaToolCheckResponse> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...options,
      stream: false,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}`);
  }

  return response.json();
}

// ── Streaming request (for final response) ───────────────────────────────────

export async function* ollamaChatStream(options: OllamaChatOptions): AsyncGenerator<OllamaChunk> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...options,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Ollama error ${response.status}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  if (!reader) throw new Error("No response body");

  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk: OllamaChunk = JSON.parse(trimmed);
        yield chunk;
      } catch {
        // skip malformed lines
      }
    }
  }
}

// ── List available models ────────────────────────────────────────────────────

export async function ollamaListModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? []).map((m: { name?: string }) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Server proxy endpoints (for production) ──────────────────────────────────

export async function serverOllamaChatNonStream(model: string, messages: OllamaMessage[]): Promise<OllamaToolCheckResponse> {
  const response = await fetch("/api/ollama/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Server error ${response.status}`);
  }

  return response.json();
}

export async function serverListModels(): Promise<string[]> {
  try {
    const response = await fetch("/api/ollama/tags");
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? []).map((m: { name?: string }) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}
