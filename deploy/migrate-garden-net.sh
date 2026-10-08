#!/usr/bin/env bash
set -euo pipefail
BASE=/vol1/1000/Docker
docker compose -f "$BASE/garden/compose.yml" up -d --no-build --pull never
docker compose -f "$BASE/nginx/compose.yml" up -d --no-build --pull never
docker exec nginx nginx -t
curl -fsS http://127.0.0.1:5888/api/health
