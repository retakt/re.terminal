# server/memory_tools.py
# MCP Memory Tracking Tools

# These tools are designed to be imported into your main MCP server file
# e.g. in graPHITI/mcp_server.py: from memory_tools import get_memory_status

# Note: You must import your falkor_client from your main MCP server file
# or pass it as an argument. These functions assume 'falkor_client' is available
# in the scope where they are called.

async def get_memory_status(falkor_client):
    """
    Returns the current health and statistics of the Memory Graph (FalkorDB).
    Useful to check if memory is empty or if data is being saved correctly.
    """
    try:
        if not falkor_client:
            return "Memory Status: Disconnected from FalkorDB"

        result = falkor_client.query("MATCH (n) RETURN count(n) as total_nodes")
        node_count = result.result_set[0][0] if result.result_set else 0

        edge_result = falkor_client.query("MATCH ()-[r]->() RETURN count(r) as total_edges")
        edge_count = edge_result.result_set[0][0] if edge_result.result_set else 0

        status = "Active" if node_count > 0 else "Empty"
        return f"Memory Status: {status}\nNodes: {node_count}\nEdges: {edge_count}"
    except Exception as e:
        return f"Error connecting to FalkorDB: {str(e)}"

async def get_memory_audit_log(falkor_client, limit=5):
    """
    Returns a history of recent memory operations (saves/invalidations).
    Note: This queries nodes that have a created_at timestamp to simulate history
    if explicit audit nodes aren't used.
    """
    try:
        if not falkor_client:
            return "Disconnected from FalkorDB"

        query = f"""
            MATCH (n) 
            WHERE n.updatedAt IS NOT NULL
            RETURN n.text, n.updatedAt, labels(n) 
            ORDER BY n.updatedAt DESC 
            LIMIT {limit}
        """
        result = falkor_client.query(query)

        if not result.result_set:
            return "No recent memory history found."

        logs = []
        for record in result.result_set:
            name = record[0] or "Unknown"
            ts = record[1] or "Unknown time"
            labels = record[2] or ["Entity"]
            logs.append(f"- [{', '.join(labels)}] '{name}' updated at {ts}")

        return "Recent Memory History:\n" + "\n".join(logs)
    except Exception as e:
        return f"Could not retrieve audit log: {str(e)}"

async def track_memory_changes(enable: bool) -> str:
    """
    Enables or disables verbose logging for memory operations.
    """
    status = "Enabled" if enable else "Disabled"
    return f"Memory change tracking is now {status}. Please check the server console for detailed logs."

async def force_save_memory(falkor_client, name: str) -> str:
    """
    Manually saves a test node to the graph to verify connectivity.
    """
    try:
        if not falkor_client:
            return "Disconnected from FalkorDB"
        
        import time
        ts = int(time.time())
        uuid = f"debug-{ts}"

        # Escape quotes
        safe_name = name.replace("'", "\\'")

        query = f"""
            CREATE (n:Entity:Debug {{
                uuid: '{uuid}',
                text: '{safe_name}',
                createdAt: {ts},
                updatedAt: {ts}
            }})
            RETURN n
        """
        falkor_client.query(query)
        return f"Successfully saved debug node: '{name}' with UUID {uuid}"
    except Exception as e:
        return f"FAILED to save memory. Check your connection settings.\nError: {str(e)}"
