# re.Term Memory Stack

This directory runs the optional long-term memory services for re.Term.

The main app should stay as a normal Node service on the host. Docker is only used for the memory sidecars:

- FalkorDB stores the graph memory.
- Graphiti MCP is optional and can be enabled later for MCP clients.

## Quick Start

```bash
cd graphiti
cp .env.example .env
docker compose up -d falkordb
```

Then enable memory for the Node server:

```bash
MEMORY_ENABLED=true
FALKORDB_HOST=127.0.0.1
FALKORDB_PORT=6380
FALKORDB_DATABASE=graphiti_memory
```

Restart the Node service after changing those environment variables.

The chat model is proxied by the Node server through `OLLAMA_BASE_URL`. The default is:

```bash
OLLAMA_BASE_URL=https://chat-api.retakt.cc
```

That endpoint currently exposes:

```text
joe-speedboat/Gemma-4-Uncensored-HauhauCS-Aggressive:e4b
```

If you enable the optional Graphiti MCP profile, `.env.example` also points Graphiti at the same endpoint through its OpenAI-compatible `/v1` API.

## Optional Graphiti MCP

Graphiti MCP is behind a Compose profile so the database can run without it.

```bash
cd graphiti
docker compose --profile mcp up -d
```

MCP HTTP endpoint:

```text
http://127.0.0.1:8001/mcp/
```

Health endpoint:

```text
http://127.0.0.1:8001/health
```

## Ports

All ports bind to `127.0.0.1` by default. That is intentional for VPS safety.

- FalkorDB protocol: `127.0.0.1:6380`
- FalkorDB browser: `127.0.0.1:3001`
- Graphiti MCP: `127.0.0.1:8001`

If you need remote access, put these behind a tunnel or reverse proxy with authentication rather than exposing them directly.

## Management

```bash
docker compose ps
docker compose logs -f falkordb
docker compose down
docker compose down -v
```

`docker compose down -v` deletes the memory volume.

## Backup And Restore

```bash
./scripts/backup.sh
./scripts/restore.sh ./backups/falkordb_backup_YYYYMMDD_HHMMSS.tar.gz
```

The default volume name is `memory_falkordb_data` to preserve the first local setup. Override it with `FALKORDB_VOLUME` if you want a different name.
