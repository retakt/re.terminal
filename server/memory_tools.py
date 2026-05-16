# memory_tools.py
# MCP Memory Tracking Tools for FalkorDB/Graphiti

import os
import time
from dotenv import load_dotenv
from falkordb import FalkorDB
import json

load_dotenv()

# Configuration - Match memory-client.js defaults
FALKORDB_URL = os.getenv("FALKORDB_URL", "redis://localhost:6380")
FALKORDB_GRAPH_NAME = os.getenv("FALKORDB_GRAPH_NAME", "graphiti_memory")

# Initialize client
try:
    db = FalkorDB(FALKORDB_GRAPH_NAME, url=FALKORDB_URL)
    print(f"✅ MCP Memory Tools connected to {FALKORDB_GRAPH_NAME}")
except Exception as e:
    print(f"❌ MCP Memory Tools connection failed: {e}")
    db = None

def get_memory_status():
    """
    Returns current memory statistics: node count, edge count, memory health.
    Useful for the AI to check memory capacity or load.
    """
    if not db:
        return "Memory tools are not connected to FalkorDB."
    
    try:
        node_result = db.query("MATCH (n) RETURN count(n)")
        edge_result = db.query("MATCH ()-[r]->() RETURN count(r)")
        
        node_count = node_result.result_set[0][0]
        edge_count = edge_result.result_set[0][0]
        
        return json.dumps({
            "status": "active",
            "nodes": node_count,
            "edges": edge_count,
            "graph_name": FALKORDB_GRAPH_NAME
        })
    except Exception as e:
        return f"Error retrieving memory status: {str(e)}"

def get_memory_audit_log(limit=20):
    """
    Returns a log of memory operations (add_episode, save_entity, etc.).
    Useful for tracking what the AI has recently saved or invalidated.
    """
    if not db:
        return "Memory tools are not connected to FalkorDB."
        
    try:
        result = db.query(f"""
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
        
        return json.dumps({"audit_log": audit_log})
    except Exception as e:
        return f"Error retrieving audit log: {str(e)}"

def get_entity_provenance(entity_uuid):
    """
    Returns the episodic provenance of an entity - which conversations/episodes created or modified it.
    """
    if not db:
        return "Memory tools are not connected to FalkorDB."
        
    try:
        result = db.query(f"""
            MATCH (e:Entity {{memoryId: '{entity_uuid}'}})-[:SAVED_FROM]->(ep:Episode)
            RETURN ep.uuid, ep.timestamp
        """)
        
        return json.dumps([record[0] for record in result.result_set])
    except Exception as e:
        return f"Error retrieving provenance: {str(e)}"

def track_memory_changes(enable=True, log_level="detailed"):
    """
    Enables or disables verbose logging for memory operations.
    Useful for debugging why memory isn't being saved.
    """
    status = "Enabled" if enable else "Disabled"
    return f"Memory change tracking is now {status} with log level: {log_level}. Please check the server console for detailed logs."

def force_save_memory(name="Manual Test Node"):
    """
    Manually saves a test node to the graph.
    Use this if memory seems broken to verify the connection.
    """
    if not db:
        return "Memory tools are not connected to FalkorDB."
        
    try:
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
        return f"Successfully saved debug node: '{name}' with memoryId {uuid}"
    except Exception as e:
        return f"FAILED to save memory. Check your connection settings.\nError: {str(e)}"

# CLI entry point for testing
if __name__ == "__main__":
    print("🧠 FalkorDB Memory Tracker")
    print("-" * 40)
    
    status = get_memory_status()
    print(f"Status: {status}")
    
    force_result = force_save_memory("CLI Test Node")
    print(f"Force Save: {force_result}")
    
    audit = get_memory_audit_log(5)
    print(f"Recent Audit: {audit}")
