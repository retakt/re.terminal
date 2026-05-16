// client/src/components/programs/memory-graph/MemoryGraph.tsx
import { useState, useEffect, useCallback } from 'react';
import { 
  ReactFlow, 
  Controls, 
  Background, 
  useNodesState, 
  useEdgesState, 
  MarkerType,
  Panel,
  useReactFlow,
  BackgroundVariant,
  ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
// WebSocket hook removed in favor of API polling
import { Wifi, WifiOff, RefreshCw, Save, Trash2, AlertCircle, CheckCircle, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 1. Wrap the main component to satisfy ReactFlowProvider requirement
export function MemoryGraph() {
  return (
    <div className="w-full h-full relative">
      <ReactFlowProvider>
        <MemoryGraphContent />
      </ReactFlowProvider>
    </div>
  );
}

// 2. Inner component where we use hooks
function MemoryGraphContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [manualSaveStatus, setManualSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<'connected' | 'loading' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const { fitView, getNodes, getEdges } = useReactFlow();

  // 1. Polling Effect (Replaces WebSocket)
  useEffect(() => {
    const fetchGraphData = async () => {
      setIsProcessing(true);
      try {
        // Poll the API endpoint
        const res = await fetch('http://localhost:8765/api/graph/snapshot');
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        const data = await res.json();
        setStatus('connected');
        setError(null);

        // 2. Update Nodes (Add new ones, keep old positions)
        setNodes((nds) => {
          const newNodes = [...nds];
          const existingIds = new Set(nds.map(n => n.id));

          if (data.nodes) {
            data.nodes.forEach((n: any) => {
              if (!existingIds.has(n.id)) {
                newNodes.push({
                  id: n.id,
                  type: 'default',
                  position: { 
                    x: 250 + (Math.random() * 500 - 250), 
                    y: 250 + (Math.random() * 500 - 250) 
                  },
                  data: { 
                    label: n.label || 'Unknown', 
                    type: n.type || 'Entity' 
                  },
                  style: {
                    background: '#0f172a',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    minWidth: '100px',
                    textAlign: 'center',
                    fontSize: '12px',
                  },
                });
              }
            });
          }
          return newNodes;
        });

        // 3. Update Edges
        setEdges((eds) => {
          const newEdges = [...eds];
          const existingEdges = new Set(eds.map(e => `${e.source}-${e.target}`));

          if (data.edges) {
            data.edges.forEach((e: any) => {
              const edgeId = `e-${e.source}-${e.target}`;
              if (!existingEdges.has(edgeId)) {
                newEdges.push({
                  id: edgeId,
                  source: e.source,
                  target: e.target,
                  type: 'smoothstep',
                  animated: true,
                  label: e.label || '',
                  markerEnd: { type: MarkerType.ArrowClosed },
                  style: { stroke: '#475569', strokeWidth: 1 },
                });
              }
            });
          }
          return newEdges;
        });

      } catch (err: any) {
        setStatus('error');
        setError(err.message || "Failed to fetch graph");
      } finally {
        setIsProcessing(false);
      }
    };

    // Initial fetch
    fetchGraphData();

    // Poll every 2 seconds
    const interval = setInterval(fetchGraphData, 2000);

    return () => clearInterval(interval);
  }, []);

  // Manual Save Handler
  const handleManualSave = async () => {
    setManualSaveStatus('saving');
    try {
      const res = await fetch('http://localhost:8765/api/debug/force-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Manual Save ${new Date().toLocaleTimeString()}` })
      });
      if (res.ok) setManualSaveStatus('success');
      else setManualSaveStatus('error');
    } catch (e) {
      setManualSaveStatus('error');
    } finally {
      setTimeout(() => setManualSaveStatus('idle'), 3000);
    }
  };

  // Clear Memory Handler
  const handleClearMemory = async () => {
    if (!confirm("⚠️ Are you sure? This will wipe all memory from FalkorDB.")) return;
    try {
      await fetch('http://localhost:8765/api/debug/clear', { method: 'POST' });
      setNodes([]);
      setEdges([]);
    } catch (e) {
      alert("Failed to clear memory");
    }
  };

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        panOnDrag={[true, true]}
        zoomOnScroll
        minZoom={0.1}
        maxZoom={1.5}
        attributionPosition="bottom-right"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#334155" />
        <Controls />
        
        {/* Status Panel */}
        <Panel position="top-right" className="bg-slate-900/95 backdrop-blur p-3 rounded-lg border border-slate-700 shadow-lg z-50">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-2">
              {status === 'connected' ? (
                <Wifi className="w-4 h-4 text-emerald-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-rose-500" />
              )}
              <span className={`text-xs font-bold ${status === 'connected' ? 'text-emerald-500' : 'text-rose-500'}`}>
                {status.toUpperCase()}
              </span>
            </div>
            {isProcessing && <span className="text-xs text-blue-400 animate-pulse">Syncing...</span>}
            {status !== 'connected' && (
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => window.location.reload()}>Retry</Button>
            )}
          </div>
          
          {error && (
            <div className="mt-1 p-1.5 bg-rose-900/30 border border-rose-800 rounded text-xs text-rose-400 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="truncate max-w-[200px]">{error}</span>
            </div>
          )}
        </Panel>

        {/* Action Panel */}
        <Panel position="bottom-left" className="bg-slate-900/95 backdrop-blur p-2 rounded-lg border border-slate-700 shadow-lg flex gap-2 z-50">
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleManualSave}
            disabled={status !== 'connected' || manualSaveStatus === 'saving'}
            className="flex items-center gap-2 h-8 text-xs"
          >
            {manualSaveStatus === 'saving' ? <RefreshCw className="w-3 h-3 animate-spin" /> : 
             manualSaveStatus === 'success' ? <CheckCircle className="w-3 h-3 text-emerald-500" /> :
             manualSaveStatus === 'error' ? <AlertCircle className="w-3 h-3 text-rose-500" /> :
             <Save className="w-3 h-3" />}
            <span>{manualSaveStatus === 'success' ? 'Saved!' : 'Test Save'}</span>
          </Button>

          <Button 
            variant="destructive" 
            size="sm" 
            onClick={handleClearMemory}
            className="flex items-center gap-2 h-8 text-xs"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </Button>
          
          <div className="h-6 w-[1px] bg-slate-700 mx-1"></div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1"><Database className="w-3 h-3"/> {nodes.length}</span>
            <span className="flex items-center gap-1"><span className="h-1 w-1 bg-slate-400 rounded-full"></span> {edges.length}</span>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
