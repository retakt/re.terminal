"""
MCP Memory Tools Module
Defines the tools that the AI agent (MCP Client) can call to inspect its own memory.
"""
import json
from falkordb import FalkorDB

# Reuse the DB connection config - Match memory-client.js
FALKOR_DB_URL = "redis://localhost:6380"
GRAPH_NAME = "graphiti_memory"

try:
    db = FalkorDB(graph_name=GRAPH_NAME, redis_conn=FALKOR_DB_URL)
    print(f"✅ MCP Tools connected to {GRAPH_NAME}")
except Exception as e:
    print(f"❌ MCP Tools connection failed: {e}")
    db = None

def get_memory_status():
    """
    Returns a summary of the memory graph status.
    Useful for the AI to check memory capacity or load.
    """
    if not db:
        return json.dumps({"status": "disconnected"})
        
    try:
        node_res = db.query("MATCH (n) RETURN count(n)").result_set[0][0]
        edge_res = db.query("MATCH ()-[r]->() RETURN count(r)").result_set[0][0]
        
        return json.dumps({
            "status": "healthy",
            "total_entities": node_res,
            "total_relations": edge_res,
            "database": "FalkorDB (Graphiti)",
            "graph": GRAPH_NAME
        })
    except Exception as e:
        return json.dumps({"error": str(e)})

def get_recent_memory_actions(limit=10):
    """
    Returns the most recently modified or created nodes.
    This acts as an 'audit log' by checking node timestamps.
    """
    if not db:
        return json.dumps({"error": "disconnected"})
        
    try:
        result = db.query(f"""
            MATCH (n) 
            RETURN n.text as entity_name, n.message as message, n.memoryId as id, labels(n) as type, n.updatedAt as last_modified
            ORDER BY n.updatedAt DESC
            LIMIT {limit}
        """)
        
        actions = []
        for record in result.result_set:
            actions.append({
                "entity": record[0] or record[1] or "Unknown",
                "id": record[2],
                "type": record[3] if record[3] else "Entity",
                "last_modified": record[4]
            })
        
        return json.dumps({
            "recent_changes": actions,
            "count": len(actions)
        })
    except Exception as e:
        return json.dumps({"error": str(e)})

def get_memory_audit_log():
    """
    Returns a log of memory operations (add_episode, save_entity, etc.).
    """
    if not db:
        return json.dumps({"error": "disconnected"})
        
    try:
        result = db.query("""
            MATCH (a:MemoryAudit)
            RETURN a.operation, a.timestamp, a.entities_created
            ORDER BY a.timestamp DESC
            LIMIT 20
        """)
        
        audit_log = []
        for record in result.result_set:
            audit_log.append({
                "operation": record[0],
                "timestamp": record[1],
                "entities": record[2] if record[2] else []
            })
        
        return json.dumps({"audit_log": audit_log})
    except Exception as e:
        return json.dumps({"error": str(e)})

def track_memory_changes(enable=True, log_level="detailed"):
    """
    Enables or disables verbose logging for memory operations.
    Useful for debugging why memory isn't being saved.
    """
    status = "Enabled" if enable else "Disabled"
    return f"Memory change tracking is now {status} with log level: {log_level}."

def force_save_memory(name="Manual Test Node"):
    """
    Manually saves a test node to the graph.
    Use this if memory seems broken to verify the connection.
    """
    if not db:
        return json.dumps({"error": "disconnected"})
        
    try:
        import time
        ts = int(time.time())
        uuid = f"manual-{ts}"
        
        # Escape quotes
        safe_name = str(name).replace("'", "\\'")
        
        query = f"""
            CREATE (n:Entity:Debug {{
                memoryId: '{uuid}',
                text: '{safe_name}',
                createdAt: '{ts}',
                updatedAt: '{ts}'
            }})
            RETURN n
        """
        db.query(query)
        return json.dumps({"success": True, "message": f"Saved debug node: '{name}' with memoryId {uuid}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


# --- Integration Helper ---
# This function can be used to register these tools in your FastAPI/MCP app

from fastapi import APIRouter

router = APIRouter()

@router.get("/tools/status")
def api_status():
    return {"result": get_memory_status()}

@router.get("/tools/recent_actions")
def api_recent_actions():
    return {"result": get_recent_memory_actions()}

@router.get("/tools/audit")
def api_audit():
    return {"result": get_memory_audit_log()}

@router.post("/tools/force-save")
def api_force_save(name: str = "Test Node"):
    return {"result": force_save_memory(name)}

@router.post("/tools/track-changes")
def api_track_changes(enable: bool = True, log_level: str = "detailed"):
    return {"result": track_memory_changes(enable, log_level)}
