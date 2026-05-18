import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertCircle, Database, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type GraphResponse = {
  nodes?: Array<{
    id: string;
    label?: string;
    type?: string;
    labels?: string[];
  }>;
  edges?: Array<{
    id?: string;
    source: string;
    target: string;
    label?: string;
  }>;
};

function getProjectId() {
  if (typeof window === "undefined") return "default-user";
  return window.localStorage.getItem("reterm.chat.sessionId") || "default-user";
}

function nodeClass(type?: string) {
  switch ((type || "").toLowerCase()) {
    case "fact":
      return "memory-node--fact";
    case "preference":
      return "memory-node--preference";
    case "error":
      return "memory-node--error";
    case "fix":
      return "memory-node--fix";
    case "project":
      return "memory-node--project";
    default:
      return "memory-node--entity";
  }
}

function formatLabel(label?: string) {
  if (!label) return "memory";
  return label.length > 72 ? `${label.slice(0, 69)}...` : label;
}

export function MemoryGraph({ isActive = true }: { isActive?: boolean }) {
  return (
    <div className="memory-graph-shell h-full w-full">
      <ReactFlowProvider>
        <MemoryGraphContent isActive={isActive} />
      </ReactFlowProvider>
    </div>
  );
}

function MemoryGraphContent({ isActive }: { isActive: boolean }) {
  const projectId = useMemo(() => getProjectId(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [status, setStatus] = useState<"loading" | "connected" | "error">("loading");
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState("");
  const { fitView } = useReactFlow();

  const fetchGraphData = async () => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/memory/graph?projectId=${encodeURIComponent(projectId)}&scope=all`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as GraphResponse;
      const graphNodes = Array.isArray(data.nodes) ? data.nodes : [];
      const graphEdges = Array.isArray(data.edges) ? data.edges : [];
      const count = Math.max(graphNodes.length, 1);
      const radius = 280;

      setNodes(graphNodes.map((node, index) => {
        const angle = (Math.PI * 2 * index) / count;
        const ring = index % 3 === 0 ? radius * 0.58 : radius;
        return {
          id: node.id,
          type: "default",
          position: {
            x: Math.cos(angle) * ring,
            y: Math.sin(angle) * ring,
          },
          data: {
            label: (
              <div className="memory-node-label">
                <span>{formatLabel(node.label || node.id)}</span>
                <small>{node.type || node.labels?.[0] || "node"}</small>
              </div>
            ),
          },
          className: `memory-node ${nodeClass(node.type)}`,
        };
      }));

      setEdges(graphEdges.map((edge, index) => ({
        id: edge.id || `e-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        label: edge.label || "",
        type: "smoothstep",
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: "memory-edge",
      })));

      setStatus("connected");
      setError("");
      setLastSync(new Date().toLocaleTimeString());
      window.setTimeout(() => fitView({ padding: 0.22, duration: 240 }), 30);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "failed to fetch graph");
    }
  };

  useEffect(() => {
    if (!isActive) return;
    void fetchGraphData();
    const interval = setInterval(() => void fetchGraphData(), 4000);
    return () => clearInterval(interval);
  }, [isActive, projectId]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        minZoom={0.12}
        maxZoom={1.6}
        panOnDrag
        zoomOnScroll
        attributionPosition="bottom-right"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="memory-graph-bg" />
        <Controls className="memory-graph-controls" />

        <Panel position="top-right" className="memory-graph-status">
          <div className="flex items-center gap-2">
            {status === "connected" ? (
              <Wifi className="size-3.5 text-primary" />
            ) : (
              <WifiOff className="size-3.5 text-red-500" />
            )}
            <span className="font-mono text-[10px] uppercase text-muted-foreground">{status}</span>
            <Button size="icon" variant="ghost" className="chat-tool-button size-7 rounded-sm" onClick={() => void fetchGraphData()}>
              <RefreshCw className={`size-3.5 ${status === "loading" ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><Database className="size-3" /> {nodes.length}</span>
            <span>{edges.length} edges</span>
            {lastSync && <span>{lastSync}</span>}
          </div>
          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-sm border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-500">
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}
