import { useEffect, useMemo, useRef, useState } from "react";
import { DatabaseIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChatContext } from "../engine/chat-provider";

interface GraphNode {
  id: string;
  label: string;
  type?: string;
}

interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function compactLabel(label: string, max = 28) {
  return label.length > max ? `${label.slice(0, max - 1)}...` : label;
}

function colorForType(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "fact":
      return "var(--accent-blue)";
    case "preference":
      return "var(--accent-green)";
    case "error":
      return "var(--accent-red)";
    case "fix":
      return "var(--accent-yellow)";
    case "project":
      return "var(--accent-magenta)";
    default:
      return "var(--fg-muted)";
  }
}

export function GraphVisualizer({ isActive = true }: { isActive?: boolean }) {
  const { sessionId } = useChatContext();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [status, setStatus] = useState<"loading" | "connected" | "error">("loading");
  const [error, setError] = useState("");

  const fetchGraph = async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/memory/graph?projectId=${encodeURIComponent(sessionId)}&scope=all`);
      if (!res.ok) throw new Error(`graph api ${res.status}`);
      const data = await res.json();
      setGraphData({
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
      });
      setStatus("connected");
      setError("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "graph failed");
    }
  };

  useEffect(() => {
    if (!isActive) return;
    void fetchGraph();
    const interval = setInterval(() => void fetchGraph(), 3000);
    return () => clearInterval(interval);
  }, [isActive, sessionId]);

  const layout = useMemo(() => {
    const width = 760;
    const height = 520;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.36;
    const count = Math.max(1, graphData.nodes.length);

    return new Map(
      graphData.nodes.map((node, index) => {
        const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
        const ring = index % 3 === 0 ? radius * 0.62 : radius;
        return [
          node.id,
          {
            ...node,
            x: centerX + Math.cos(angle) * ring,
            y: centerY + Math.sin(angle) * ring,
          },
        ];
      }),
    );
  }, [graphData.nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-base") || "#010409";
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 1;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";

    for (const edge of graphData.edges) {
      const source = layout.get(edge.source);
      const target = layout.get(edge.target);
      if (!source || !target) continue;
      ctx.strokeStyle = "rgba(139, 148, 158, 0.42)";
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      if (edge.label) {
        ctx.fillStyle = "rgba(139, 148, 158, 0.8)";
        ctx.fillText(compactLabel(edge.label, 18), (source.x + target.x) / 2, (source.y + target.y) / 2);
      }
    }

    for (const node of layout.values()) {
      const fill = colorForType(node.type);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.stroke();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--fg-base") || "#e6edf3";
      ctx.fillText(compactLabel(node.label || node.id), node.x, node.y + 25);
    }
  }, [graphData, layout]);

  return (
    <div className="chat-graph-surface flex h-full min-h-0 flex-col overflow-hidden rounded-sm">
      <div className="flex items-center gap-2 border-b border-[color:var(--chat-border)] px-2 py-2">
        <DatabaseIcon className="size-3.5 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {status === "connected" ? `${graphData.nodes.length} nodes / ${graphData.edges.length} edges` : error || "loading graph"}
        </span>
        <Button variant="ghost" size="icon" className="chat-tool-button size-6 rounded-sm" onClick={() => void fetchGraph()}>
          <RefreshCwIcon className={`size-3 ${status === "loading" ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <canvas
        ref={canvasRef}
        width={760}
        height={520}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default GraphVisualizer;
