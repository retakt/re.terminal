import * as React from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Blocks, Play, Puzzle, RotateCcw, SquareTerminal, Terminal } from "lucide-react";

const initialNodes: Node[] = [
  {
    id: "trigger",
    type: "input",
    position: { x: 30, y: 150 },
    data: { label: "manual trigger" },
    className: "playground-node--trigger",
  },
  {
    id: "terminal",
    position: { x: 260, y: 70 },
    data: { label: "terminal session" },
    className: "playground-node--terminal",
  },
  {
    id: "mcp",
    position: { x: 260, y: 230 },
    data: { label: "mcp tool call" },
    className: "playground-node--mcp",
  },
  {
    id: "script",
    position: { x: 505, y: 150 },
    data: { label: "script runner" },
    className: "playground-node--script",
  },
  {
    id: "output",
    type: "output",
    position: { x: 745, y: 150 },
    data: { label: "artifact / response" },
    className: "playground-node--output",
  },
];

const initialEdges: Edge[] = [
  { id: "trigger-terminal", source: "trigger", target: "terminal", animated: true },
  { id: "trigger-mcp", source: "trigger", target: "mcp", animated: true },
  { id: "terminal-script", source: "terminal", target: "script" },
  { id: "mcp-script", source: "mcp", target: "script" },
  { id: "script-output", source: "script", target: "output", animated: true },
];

const nodeCatalog = [
  { label: "terminal", icon: Terminal, className: "playground-node--terminal" },
  { label: "mcp tool", icon: Blocks, className: "playground-node--mcp" },
  { label: "script", icon: SquareTerminal, className: "playground-node--script" },
  { label: "extension", icon: Puzzle, className: "playground-node--extension" },
];

export function PlaygroundShell() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = React.useCallback(
    (connection: Connection) => setEdges(current => addEdge({ ...connection, animated: true }, current)),
    [setEdges],
  );

  const resetCanvas = () => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  };

  const addCanvasNode = (label: string, className: string) => {
    setNodes(current => [
      ...current,
      {
        id: `${label.replace(/\s+/g, "-")}-${Date.now()}`,
        position: {
          x: 120 + (current.length % 4) * 170,
          y: 90 + Math.floor(current.length / 4) * 120,
        },
        data: { label },
        className,
      },
    ]);
  };

  return (
    <div className="program-shell playground-shell">
      <div className="playground-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          fitViewOptions={{ padding: 0.24 }}
        >
          <Background color="var(--border-subtle)" gap={20} />
          <Controls position="bottom-right" />
          <MiniMap pannable zoomable />
          <Panel position="top-left" className="playground-actions-panel">
            <button className="playground-icon-button" type="button" title="run later" aria-label="run later">
              <Play size={13} />
            </button>
            <button className="playground-icon-button" type="button" title="reset" aria-label="reset" onClick={resetCanvas}>
              <RotateCcw size={13} />
            </button>
          </Panel>
          <Panel position="top-right" className="playground-palette">
            {nodeCatalog.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className="playground-palette-item"
                  onClick={() => addCanvasNode(item.label, item.className)}
                >
                  <Icon size={13} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
