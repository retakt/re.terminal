import { useState, useEffect, useCallback } from 'react';
import { Node, Edge } from '@xyflow/react';

interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
  }>;
}

interface WebSocketMessage {
  data: {
    nodes: Array<{
      id: string;
      label: string;
      type: string;
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string;
    }>;
  };
}

export function useGraphWebSocket(url: string = 'ws://localhost:8765/ws/graph') {
  const [elements, setElements] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [status, setStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);

  const processMessage = useCallback((message: WebSocketMessage) => {
    try {
      const data: GraphData = message.data;

      // Convert raw nodes to ReactFlow nodes
      const flowNodes: Node[] = data.nodes.map((n) => ({
        id: n.id,
        position: { x: 0, y: 0 }, // Let layout engine handle positions
        data: { label: n.label, type: n.type },
        style: { 
          background: n.type === 'Entity' ? '#4f46e5' : '#10b981',
          color: 'white',
          border: '1px solid #000',
          padding: '10px',
          borderRadius: '8px'
        },
      }));

      // Convert raw edges to ReactFlow edges
      const flowEdges: Edge[] = data.edges.map((e, i) => ({
        id: `e-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: true,
        style: { stroke: '#94a3b8' }
      }));

      setElements(flowNodes);
      setEdges(flowEdges);
      setStatus('connected');
      setError(null);
    } catch (err) {
      console.error('Error processing graph message:', err);
      setError('Failed to process graph data');
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('🔌 Graph WebSocket connected');
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          processMessage(message);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        console.log('🔌 Graph WebSocket disconnected');
        setStatus('disconnected');
        // Attempt to reconnect after 3 seconds
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error('🔌 Graph WebSocket error:', error);
        setStatus('disconnected');
        setError('WebSocket connection failed');
      };
    };

    connect();

    return () => {
      if (ws) {
        ws.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [url, processMessage]);

  return { elements, edges, status, error };
}
