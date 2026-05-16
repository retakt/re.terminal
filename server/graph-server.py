# graph-server.py
# Real-time Graphiti Memory Visualization Server

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
from falkordb import FalkorDB
import os
import time
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI()

# Allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration - Match memory-client.js defaults
FALKORDB_URL = os.getenv("FALKORDB_URL", "redis://localhost:6380")
FALKORDB_GRAPH_NAME = os.getenv("FALKORDB_GRAPH_NAME", "graphiti_memory")

# FalkorDB client
try:
    falkor_client = FalkorDB(FALKORDB_GRAPH_NAME, url=FALKORDB_URL)
    print(f"✅ Connected to FalkorDB: {FALKORDB_GRAPH_NAME} at {FALKORDB_URL}")
except Exception as e:
    print(f"❌ Error connecting to FalkorDB: {e}")
    falkor_client = None

# Active WebSocket connections
active_connections = []

async def fetch_graph_data():
    """Queries FalkorDB for nodes and edges."""
    if not falkor_client:
        return {"nodes": [], "edges": []}
    
    try:
        # Query nodes - adapted to match memory-client.js schema
        nodes_query = """
            MATCH (n) 
            WITH n ORDER BY n.updatedAt DESC LIMIT 150
            RETURN n, ID(n) as nodeId
        """
        
        # Query edges
        edges_query = """
            MATCH (n)-[r]->(m)
            RETURN id(n) as source, id(m) as target, type(r) as label
        """

        nodes_result = falkor_client.query(nodes_query)
        edges_result = falkor_client.query(edges_query)

        nodes = []
        for record in nodes_result.result_set:
            node_obj = record[0]
            node_id = record[1]
            
            # Extract properties like memory-client.js does
            props = node_obj.properties if hasattr(node_obj, 'properties') else {}
            labels = node_obj.labels if hasattr(node_obj, 'labels') else []
            
            # Determine a readable label
            label = props.get('text') or props.get('message') or props.get('key') or props.get('error') or "Memory Node"
            # Truncate long labels
            if isinstance(label, str) and len(label) > 40:
                label = label[:37] + "..."
            
            nodes.append({
                "id": str(node_id),
                "memoryId": props.get('memoryId', ''),
                "label": str(label),
                "type": labels[0] if labels else "Entity"
            })

        edges = []
        for record in edges_result.result_set:
            edges.append({
                "source": str(record[0]),
                "target": str(record[1]),
                "label": record[2] if record[2] else "RELATED"
            })

        return {"nodes": nodes, "edges": edges}
    
    except Exception as e:
        print(f"⚠️ Error fetching graph: {e}")
        return {"nodes": [], "edges": []}

@app.websocket("/ws/graph")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"🔌 Client connected. Active: {len(active_connections)}")
    
    try:
        while True:
            data = await fetch_graph_data()
            
            for connection in active_connections:
                try:
                    await connection.send_json(data)
                except:
                    pass
            
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        print(f"🔌 Client disconnected. Active: {len(active_connections)}")

@app.get("/api/graph/snapshot")
async def get_snapshot():
    """HTTP endpoint for polling fallback"""
    return await fetch_graph_data()

@app.get("/api/memory/status")
async def get_memory_status():
    """Returns current memory statistics."""
    if not falkor_client:
        return {"status": "disconnected"}
    try:
        node_result = falkor_client.query("MATCH (n) RETURN count(n)")
        edge_result = falkor_client.query("MATCH ()-[r]->() RETURN count(r)")
        
        node_count = node_result.result_set[0][0]
        edge_count = edge_result.result_set[0][0]
        
        return {
            "status": "active",
            "nodes": node_count,
            "edges": edge_count,
            "graph_name": FALKORDB_GRAPH_NAME
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/memory/audit")
async def get_memory_audit_log(limit=20):
    """Returns a log of memory operations."""
    if not falkor_client:
        return []
    try:
        result = falkor_client.query(f"""
            MATCH (a:MemoryAudit)
            RETURN a.operation, a.timestamp, a.entities_created
            ORDER BY a.timestamp DESC
            LIMIT {limit}
        """)
        
        audit_log = []
        for record in result.result_set:
            audit_log.append({
                "operation": record[0],
                "timestamp": record[1],
                "entities": record[2] if record[2] else []
            })
        
        return audit_log
    except Exception as e:
        return {"error": str(e)}

# --- Debug Endpoints for Manual Testing ---

@app.post("/api/debug/force-save")
async def force_save_memory(payload: dict):
    """Allow UI to force save a node to test connectivity"""
    if not falkor_client:
        return {"success": False, "message": "FalkorDB disconnected"}
    
    try:
        name = payload.get("name", "Manual Test Node")
        ts = int(time.time())
        
        # Escape single quotes to prevent cypher injection
        safe_name = name.replace("'", "\\'")
        
        query = f"""
            CREATE (n:Entity:ManualTest {{
                memoryId: 'manual-{ts}',
                text: '{safe_name}',
                createdAt: '{ts}',
                updatedAt: '{ts}'
            }})
            """
        
        falkor_client.query(query)
        return {"success": True, "message": f"Saved: {name}"}
    
    except Exception as e:
        print(f"❌ Force save failed: {e}")
        return {"success": False, "message": str(e)}

@app.post("/api/debug/clear")
async def clear_memory():
    """Clears all nodes from the graph"""
    if not falkor_client:
        return {"success": False, "message": "FalkorDB disconnected"}
    try:
        falkor_client.query("MATCH (n) DETACH DELETE n")
        return {"success": True, "message": "Memory cleared"}
    except Exception as e:
        return {"success": False, "message": str(e)}

if __name__ == "__main__":
    print("🚀 Starting Graph Visualization Server...")
    print("📡 WebSocket: ws://localhost:8765/ws/graph")
    print("🌐 HTTP:      http://localhost:8765/api/graph/snapshot")
    uvicorn.run(app, host="0.0.0.0", port=8765)
