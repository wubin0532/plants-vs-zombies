#!/usr/bin/env bash
# 仅供明确要求重置时使用：先备份再清空账号与存档。
set -euo pipefail
BASE=/vol1/1000/Docker
"$BASE/garden/backup.sh"
docker compose -f "$BASE/garden/compose.yml" stop api
trap 'docker compose -f "$BASE/garden/compose.yml" start api' EXIT
find "$BASE/garden/data" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
docker compose -f "$BASE/garden/compose.yml" start api
trap - EXIT
