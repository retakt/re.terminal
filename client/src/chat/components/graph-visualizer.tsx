// graph-visualizer.tsx
// Real-time Graphiti Memory Visualization Component

import React, { useEffect, useRef, useState } from 'react';

interface Node {
  id: string;
  label: string;
  type: string;
}

interface Edge {
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

const GRAPH_WS_URL = 'ws://localhost:8765/ws/graph';

export function GraphVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [status, setStatus] = useState('Connecting...');

  useEffect(() => {
    const ws = new WebSocket(GRAPH_WS_URL);

    ws.onopen = () => {
      setStatus('Connected to FalkorDB');
    };

    ws.onmessage = (event) => {
      try {
        const data: GraphData = JSON.parse(event.data);
        setGraphData(data);
        setStatus(`Live: ${data.nodes.length} nodes, ${data.edges.length} edges`);
      } catch (e) {
        console.error('Error parsing graph data:', e);
      }
    };

    ws.onclose = () => {
      setStatus('Disconnected - Reconnecting...');
    };

    ws.onerror = () => {
      setStatus('Connection Error');
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    drawGraph();
  }, [graphData]);

  const drawGraph = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Simple force-directed layout (basic implementation)
    const nodes = graphData.nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0
    }));

    // Run simple simulation
    for (let i = 0; i < 50; i++) {
      // Repulsion
      for (let j = 0; j < nodes.length; j++) {
        for (let k = j + 1; k < nodes.length; k++) {
          const dx = nodes[j].x - nodes[k].x;
          const dy = nodes[j].y - nodes[k].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
          nodes[k].vx -= fx;
          nodes[k].vy -= fy;
        }
      }

      // Attraction
      graphData.edges.forEach(edge => {
        const source = nodes.find(n => n.id === edge.source);
        const target = nodes.find(n => n.id === edge.target);
        if (source && target) {
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = dist * 0.01;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          source.vx += fx;
          source.vy += fy;
          target.vx -= fx;
          target.vy -= fy;
        }
      });

      // Apply velocities
      nodes.forEach(node => {
        node.vx *= 0.9;
        node.vy *= 0.9;
        node.x += node.vx;
        node.y += node.vy;
        node.x = Math.max(20, Math.min(width - 20, node.x));
        node.y = Math.max(20, Math.min(height - 20, node.y));
      });
    }

    // Draw edges
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    graphData.edges.forEach(edge => {
      const source = nodes.find(n => n.id === edge.source);
      const target = nodes.find(n => n.id === edge.target);
      if (source && target) {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();

        // Draw edge label
        ctx.fillStyle = '#60a5fa';
        ctx.font = '10px sans-serif';
        ctx.fillText(edge.label, (source.x + target.x) / 2, (source.y + target.y) / 2);
      }
    });

    // Draw nodes
    nodes.forEach(node => {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(node.x, node.y, 15, 0, Math.PI * 2);
      ctx.fill();

      // Draw node label
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label.substring(0, 10), node.x, node.y + 25);
    });
  };

  return (
    <div className="w-full h-full bg-slate-900 rounded-lg p-4">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white">🧠 Memory Graph (Real-Time)</h3>
        <span className="text-sm text-blue-400">{status}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="w-full h-full bg-slate-950 rounded border border-slate-700"
      />
    </div>
  );
}

export default GraphVisualizer;
