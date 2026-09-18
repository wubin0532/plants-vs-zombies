#!/usr/bin/env bash
# 在 NAS 上执行：清空账号与存档并重启后端（回到全新状态）。需要 sudo 权限。
set -euo pipefail

NET=garden-net
APP_HOST_DIR=/vol1/1000/Docker/garden-server
DATA_DIR=/vol1/1000/Docker/Data/garden

echo "--- 停止并删除容器"
sudo docker rm -f garden-api >/dev/null 2>&1 || true

echo "--- 清空并重建数据目录（保持 admin 属主，否则容器会 EACCES）"
sudo rm -rf "$DATA_DIR"
sudo mkdir -p "$DATA_DIR"
sudo chown -R 1000:1001 "$DATA_DIR"

echo "--- 确保网络与容器"
sudo docker network create "$NET" >/dev/null 2>&1 || true
sudo docker run -d --name garden-api --restart unless-stopped \
  --network "$NET" --network-alias garden-api \
  --user 1000:1001 \
  -e PORT=8787 -e DATA_DIR=/data/garden -e MAX_USERS=5 -e TRUST_PROXY=1 \
  -v "$APP_HOST_DIR":/app/server:ro \
  -v /vol1/1000/Docker/Data:/data \
  node:24-alpine node --no-warnings /app/server/index.mjs

sleep 1
echo "--- 容器状态"
sudo docker ps --filter name=garden-api --format '{{.Names}}  {{.Status}}  {{.Ports}}'
echo "--- 健康检查（经 Nginx）"
curl -fsS http://192.168.199.5:5888/api/health && echo
