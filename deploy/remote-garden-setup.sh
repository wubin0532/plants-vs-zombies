#!/usr/bin/env bash
# 在 NAS 上执行：启动 garden-api 容器并重载 Nginx。需要 sudo 权限。
set -e

echo "--- 修正数据目录属主为 admin(1000:1001)，避免容器以 root 写入"
sudo mkdir -p /vol1/1000/Docker/Data/garden
sudo chown -R 1000:1001 /vol1/1000/Docker/Data/garden

echo "--- 重建 garden-api 容器（以 admin 身份运行）"
sudo docker rm -f garden-api >/dev/null 2>&1 || true
sudo docker run -d --name garden-api --restart unless-stopped \
  --user 1000:1001 \
  -p 8787:8787 \
  -e PORT=8787 -e DATA_DIR=/data/garden -e MAX_USERS=5 \
  -v /vol1/1000/Docker/garden-server:/app/server:ro \
  -v /vol1/1000/Docker/Data:/data \
  node:24-alpine node --no-warnings /app/server/index.mjs

sleep 1
echo "--- garden-api 容器"
sudo docker ps --filter name=garden-api --format '{{.Names}}  {{.Status}}  {{.Ports}}'

echo "--- 查找 Nginx 容器并重载"
NGINX=$(sudo docker ps --format '{{.Names}}' | while read n; do
  sudo docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null | grep -q chinese-chess && echo "$n" && break || true
done)
echo "nginx 容器: $NGINX"
if [ -n "$NGINX" ]; then
  sudo docker exec "$NGINX" nginx -t
  sudo docker exec "$NGINX" nginx -s reload
else
  echo "未找到 nginx 容器，请手动重载 Nginx 后重试"
fi

echo "--- 健康检查"
curl -s http://192.168.199.5:5888/api/health && echo
