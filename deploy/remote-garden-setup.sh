#!/usr/bin/env bash
# NAS 上使用既有 Compose 重建庭院后端；不改变账号、密钥或网络。
set -euo pipefail
BASE=/vol1/1000/Docker
docker compose -f "$BASE/garden/compose.yml" up -d --no-build --pull never --force-recreate api
docker exec nginx nginx -t
docker exec nginx nginx -s reload
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:5888/api/health; then echo; exit 0; fi
  sleep 1
done
exit 1
