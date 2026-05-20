"""
Real-time Graph API Server
Polls FalkorDB (Graphiti) and streams updates to the frontend via WebSocket.
"""
import uvicorn
import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from falkordb import FalkorDB

app = FastAPI()

# Allow frontend (likely running on different port) to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION ---
# Graphiti usually stores data in a graph named "GraphitiGraph"
FALKOR_DB_URL = "redis://localhost:6379"
GRAPH_NAME = "GraphitiGraph"

# Initialize Connection
db = FalkorDB(graph_name=GRAPH_NAME, redis_conn=FALKOR_DB_URL)

# Store active websocket connections
active_ws_connections = []

async def get_graph_snapshot():
    """
    Query FalkorDB for the latest graph state.
    Returns a simplified dict for frontend rendering (nodes & edges).
    """
    try:
        # Query logic: 
        # 1. Match nodes connected by relationships.
        # 2. Return UUIDs and Names.
        # 3. Limit to keep performance high for rendering.
        result = db.query("""
            MATCH (n)-[r]->(m) 
            RETURN n.uuid as src_uuid, n.name as src_name, type(r) as rel_type, m.uuid as tgt_uuid, m.name as tgt_name
            LIMIT 150
        """)
        
        nodes = {}
        edges = []

        if result:
            for record in result.result_set:
                src_id = record[0]
                tgt_id = record[4]
                
                # Add nodes to map (avoid duplicates)
                if src_id not in nodes:
                    nodes[src_id] = {"id": src_id, "label": record[1] or "Node", "type": "Entity"}
                if tgt_id not in nodes:
                    nodes[tgt_id] = {"id": tgt_id, "label": record[5] or "Node", "type": "Entity"}
                
                # Add edge
                edges.append({
                    "source": src_id,
                    "target": tgt_id,
                    "label": record[2]
                })

        return {"nodes": list(nodes.values()), "edges": edges}
    except Exception as e:
        print(f"⚠️ Error querying FalkorDB: {e}")
        return {"nodes": [], "edges": []}

@app.websocket("/ws/graph")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_ws_connections.append(websocket)
    
    try:
        print(f"✅ Client connected. Total clients: {len(active_ws_connections)}")
        while True:
            data = await get_graph_snapshot()
            
            # Broadcast to all connected clients
            for conn in active_ws_connections:
                try:
                    await conn.send_json(data)
                except:
                    continue
            
            # Polling interval: 2 seconds (adjust as needed)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        active_ws_connections.remove(websocket)
        print(f"❌ Client disconnected. Total clients: {len(active_ws_connections)}")

if __name__ == "__main__":
    print("🚀 Starting Real-Time Graph Server...")
    print("🔗 WebSocket URL: ws://localhost:8001/ws/graph")
    uvicorn.run(app, host="0.0.0.0", port=8001)
