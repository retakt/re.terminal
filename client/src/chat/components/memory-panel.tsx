import { useState } from "react";
import { Brain, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scrollAreaClasses } from "@/components/ui/scroll-area"; // Assuming ScrollArea is used
import {
  searchMemory,
  clearProjectMemory
} from "../api/memory";

interface MemoryPanelProps {
  projectId: string;
  onClose?: () => void;
}

export function MemoryPanel({ projectId, onClose }: MemoryPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchMemory(projectId, query);
      // Adjust based on actual Graphiti response structure
      setResults(data?.result?.nodes || []);
    } catch (err) {
      console.error("Memory search failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (confirm("Are you sure you want to clear all memory for this project?")) {
      await clearProjectMemory(projectId);
      setResults([]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">"
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            Project Memory
          </CardTitle>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden flex flex-col space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search memory..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? "Searching..." : <Search className="h-4 w-4" />}
            </Button>
            <Button variant="destructive" onClick={handleClear}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2">
            {results.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {loading ? "Searching..." : "No memories found. Start searching or running commands."}
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((item, idx) => (
                  <div key={idx} className="rounded-lg border p-3 bg-muted/30">
                    <div className="flex justify-between items-start">
                      <span className="font-medium text-sm text-purple-600">{item.label || item.name || "Memory"}</span>
                      <span className="text-xs text-muted-foreground">{item.properties?.timestamp}</span>
                    </div>
                    <pre className="mt-2 text-xs bg-background p-2 rounded overflow-auto">
                      {JSON.stringify(item.properties, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
