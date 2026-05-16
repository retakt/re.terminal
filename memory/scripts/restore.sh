#!/bin/bash

# Restore script for FalkorDB
if [ -z "$1" ]; then
  echo "Usage: ./restore.sh <backup_file.tar.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "Restoring from: ${BACKUP_FILE}"

# Get the volume name
VOLUME=$(docker volume ls --format '{{.Name}}' | grep falkordb_data)

if [ -z "$VOLUME" ]; then
  echo "Error: FalkorDB volume not found."
  exit 1
fi

# Create a temporary container to run the restore command
CONTAINER=$(docker run -d -v "${VOLUME}":/data busybox tail -f /dev/null)

sleep 2

# Copy the backup in
docker cp "${BACKUP_FILE}" "${CONTAINER}:/tmp/backup.tar.gz"

# Execute extraction inside the container
docker exec "${CONTAINER}" tar -xzf /tmp/backup.tar.gz -C /data

# Cleanup
docker stop "${CONTAINER}" > /dev/null 2>&1
docker rm "${CONTAINER}" > /dev/null 2>&1

echo "Restore completed. You may need to restart the FalkorDB container."
