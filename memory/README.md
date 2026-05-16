# Graphiti + FalkorDB Memory Setup

This directory contains the infrastructure for the AI agent's long-term memory using Graphiti and FalkorDB.

## Quick Start

1. Copy `.env.example` to `.env` and fill in your `OPENAI_API_KEY`.
2. Start the services:

```bash
docker-compose up -d
```

## Management Commands

- **Start**: `docker-compose up -d`
- **Stop**: `docker-compose down`
- **Logs**: `docker-compose logs -f graphiti-mcp`
- **Reset Memory**: `docker-compose down -v` (destroys volumes)
- **Health Check**: `curl http://localhost:8000/health`

## Backup & Restore

Scripts are located in `memory/scripts/`.

- **Backup**: `./memory/scripts/backup.sh`
  - Creates a `.tar.gz` of the FalkorDB volume in `memory/backups/`.
- **Restore**: `./memory/scripts/restore.sh <backup_file>`
  - Restores the database from a backup file.

## Browser

Access the FalkorDB browser at http://localhost:3000
