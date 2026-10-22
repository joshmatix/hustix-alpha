#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

gunzip -t backup.sql.gz

if ! docker inspect -f '{{.State.Running}}' hustix-backup-test 2>/dev/null | grep -qx true; then
  docker rm -f hustix-backup-test >/dev/null 2>&1 || true
  docker run --name hustix-backup-test \
    -e POSTGRES_PASSWORD=backup-test \
    -p 5433:5432 -d postgres:17
fi

until docker exec hustix-backup-test pg_isready -U postgres >/dev/null; do
  sleep 1
done

gunzip -c backup.sql.gz | docker exec -i hustix-backup-test psql -U postgres
