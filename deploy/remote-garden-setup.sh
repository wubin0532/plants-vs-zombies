#!/usr/bin/env bash
# 在 NAS 上执行：启动 garden-api 容器并重载 Nginx。需要 sudo 权限。
set -euo pipefail

NET=garden-net
APP_HOST_DIR=/vol1/1000/Docker/garden-server
DATA_DIR=/vol1/1000/Docker/Data/garden

echo "--- 修正数据目录属主为 admin(1000:1001)，避免容器以 root 写入"
sudo mkdir -p "$DATA_DIR"
sudo chown -R 1000:1001 "$DATA_DIR"

echo "--- 确保 docker 网络 $NET 存在"
sudo docker network create "$NET" >/dev/null 2>&1 || true

echo "--- 重建 garden-api 容器（不发布宿主机端口，仅加入 $NET；TRUST_PROXY=1）"
sudo docker rm -f garden-api >/dev/null 2>&1 || true
sudo docker run -d --name garden-api --restart unless-stopped \
  --network "$NET" --network-alias garden-api \
  --user 1000:1001 \
  -e PORT=8787 -e DATA_DIR=/data/garden -e MAX_USERS=5 -e TRUST_PROXY=1 \
  -v "$APP_HOST_DIR":/app/server:ro \
  -v /vol1/1000/Docker/Data:/data \
  node:24-alpine node --no-warnings /app/server/index.mjs

sleep 1
echo "--- garden-api 容器"
sudo docker ps --filter name=garden-api --format '{{.Names}}  {{.Status}}  {{.Ports}}'

echo "--- 查找 Nginx 容器，接入 $NET 并重载"
NGINX=""
while read -r n; do
  [ -n "$n" ] || continue
  if sudo docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null | grep -q chinese-chess; then
    NGINX="$n"
    break
  fi
done < <(sudo docker ps --format '{{.Names}}')
echo "nginx 容器: ${NGINX:-未找到}"
if [ -n "$NGINX" ]; then
  sudo docker network connect "$NET" "$NGINX" >/dev/null 2>&1 || true
  sudo docker exec "$NGINX" nginx -t
  sudo docker exec "$NGINX" nginx -s reload
else
  echo "未找到 nginx 容器，请手动把它接入 $NET 并重载（/api/ 需反代到 http://garden-api:8787）"
  exit 1
fi

echo "--- 健康检查（经 Nginx）"
if ! curl -fsS http://192.168.199.5:5888/api/health; then
  echo
  echo "健康检查失败：确认 Nginx 的 /api/ 已反代到 http://garden-api:8787（见 deploy/nginx-garden-api.conf）"
  exit 1
fi
echo
