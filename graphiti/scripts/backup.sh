#!/bin/bash

# Backup script for re.Term FalkorDB memory volume.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/../backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/falkordb_backup_${DATE}.tar.gz"
VOLUME="${FALKORDB_VOLUME:-memory_falkordb_data}"

mkdir -p "${BACKUP_DIR}"

echo "Creating backup: ${BACKUP_FILE}"

if ! docker volume inspect "${VOLUME}" >/dev/null 2>&1; then
  echo "Error: FalkorDB volume not found."
  echo "Start it first with: docker compose up -d falkordb"
  exit 1
fi

# Create a temporary container to run the backup command inside
CONTAINER=$(docker run -d -v "${VOLUME}":/data busybox tail -f /dev/null)

# Wait for it to be ready
sleep 2

# Execute tar inside the container
docker exec "${CONTAINER}" tar -czf /tmp/backup.tar.gz -C /data .

# Copy the backup out
docker cp "${CONTAINER}:/tmp/backup.tar.gz" "${BACKUP_FILE}"

# Cleanup
docker stop "${CONTAINER}" > /dev/null 2>&1
docker rm "${CONTAINER}" > /dev/null 2>&1

echo "Backup completed: ${BACKUP_FILE}"
