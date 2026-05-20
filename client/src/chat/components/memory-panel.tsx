import { useState } from "react";
import { Brain, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearProjectMemory, searchMemory } from "../api/memory";

interface MemoryPanelProps {
  projectId: string;
  onClose?: () => void;
}

type MemoryItem = {
  type?: string;
  text?: string;
  output?: string;
  message?: string;
  context?: string;
  error?: string;
  description?: string;
  key?: string;
  value?: string;
  createdAt?: string;
  timestamp?: number | string;
};

function memoryTitle(item: MemoryItem) {
  return item.type || item.key || "memory";
}

function memorySummary(item: MemoryItem) {
  return item.text || item.message || item.description || item.value || item.error || item.context || "";
}

function memoryTime(item: MemoryItem) {
  if (item.createdAt) return item.createdAt;
  if (!item.timestamp) return "";
  const time = typeof item.timestamp === "number" ? item.timestamp : Number(item.timestamp);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : String(item.timestamp);
}

export function MemoryPanel({ projectId, onClose }: MemoryPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");
    try {
      const data = await searchMemory(projectId, trimmed);
      setResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "memory search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear visible memory results for this project?")) return;
    await clearProjectMemory(projectId);
    setResults([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm">
      <section
        className={cn(
          "chat-activity-panel flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-sm shadow-xl",
          "animate-in fade-in zoom-in-95 duration-150",
        )}
      >
        <header className="chat-activity-header flex items-center justify-between px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Brain className="size-4 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold text-foreground">memory</h2>
              <p className="truncate font-mono text-[10px] text-muted-foreground">{projectId}</p>
            </div>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="chat-tool-button size-7 rounded-sm"
              onClick={onClose}
              title="Close memory"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </header>

        <div className="flex items-center gap-1.5 border-b border-[color:var(--chat-border)] px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className="chat-edit-field h-8 w-full rounded-sm pl-7 pr-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/60"
              placeholder="search memory"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSearch();
              }}
            />
          </div>
          <Button className="chat-solid-button h-8 rounded-sm px-3 text-xs" onClick={handleSearch} disabled={loading}>
            {loading ? "searching" : "search"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="chat-tool-button size-8 rounded-sm text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            title="Clear visible results"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {error && (
            <div className="mb-3 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {results.length === 0 ? (
            <div className="chat-empty-note flex min-h-36 items-center justify-center rounded-sm border-dashed px-3 text-center text-xs text-muted-foreground">
              {loading ? "searching memory..." : "no memories found"}
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((item, index) => (
                <article key={`${memoryTitle(item)}-${index}`} className="chat-log-card rounded-sm p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-normal text-primary">
                      {memoryTitle(item)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{memoryTime(item)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground">
                    {memorySummary(item) || JSON.stringify(item)}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
