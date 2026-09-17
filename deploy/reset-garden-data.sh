#!/usr/bin/env bash
# 在 NAS 上执行：清空账号与存档并重启后端（回到全新状态）。需要 sudo 权限。
set -e

echo "--- 停止并删除容器"
sudo docker rm -f garden-api >/dev/null 2>&1 || true

echo "--- 清空数据目录"
sudo rm -rf /vol1/1000/Docker/Data/garden

echo "--- 以 admin 身份重建容器"
sudo docker run -d --name garden-api --restart unless-stopped \
  --user 1000:1001 \
  -p 8787:8787 \
  -e PORT=8787 -e DATA_DIR=/data/garden -e MAX_USERS=5 \
  -v /vol1/1000/Docker/garden-server:/app/server:ro \
  -v /vol1/1000/Docker/Data:/data \
  node:24-alpine node --no-warnings /app/server/index.mjs

sleep 1
echo "--- 容器状态"
sudo docker ps --filter name=garden-api --format '{{.Names}}  {{.Status}}  {{.Ports}}'
echo "--- 健康检查"
curl -s http://192.168.199.5:5888/api/health && echo
