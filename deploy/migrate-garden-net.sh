#!/usr/bin/env bash
# 一次性迁移：把 garden-api 从“宿主机端口 8787”切到 docker 内部网络 garden-net。
# 零停机、失败自动回滚、可重复执行（幂等）。需要 sudo。
#
# 用法： sudo bash /vol1/1000/Docker/garden-server/migrate-garden-net.sh
# 若自动识别不到 nginx 容器： sudo NGINX_NAME=<容器名> bash .../migrate-garden-net.sh
set -euo pipefail

NET=garden-net
APP_HOST_DIR=/vol1/1000/Docker/garden-server
CONF_DIR=/vol1/1000/Docker/chinese-chess/confdata
NEW=garden-api-next
HEALTH=http://192.168.199.5:5888/api/health

find_nginx() {
  if [ -n "${NGINX_NAME:-}" ]; then echo "$NGINX_NAME"; return; fi
  local n img
  for n in $(sudo docker ps --format '{{.Names}}'); do
    if sudo docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null | grep -q chinese-chess; then echo "$n"; return; fi
  done
  for n in $(sudo docker ps --format '{{.Names}}'); do
    img=$(sudo docker inspect -f '{{.Config.Image}}' "$n" 2>/dev/null || true)
    case "$img" in *nginx*) echo "$n"; return;; esac
  done
}

restore_conf() {
  local backup
  backup=$(ls -t "$CONF_DIR"/default.conf.bak.* 2>/dev/null | head -1 || true)
  if [ -n "$backup" ]; then
    cp "$backup" "$CONF_DIR/default.conf"
    echo "已把 nginx 配置恢复为 $backup"
  fi
}

echo "--- 1/6 创建网络 $NET"
sudo docker network create "$NET" >/dev/null 2>&1 || true

echo "--- 2/6 识别 nginx 容器"
NGINX=$(find_nginx)
if [ -z "$NGINX" ]; then
  echo "找不到 nginx 容器。请用 NGINX_NAME=<容器名> 重跑："
  echo "  sudo NGINX_NAME=xxx bash $0"
  exit 1
fi
echo "nginx = $NGINX"
sudo docker network connect "$NET" "$NGINX" >/dev/null 2>&1 || true

# 幂等分支：garden-api 已经在 garden-net 上
if sudo docker inspect garden-api >/dev/null 2>&1 && \
   sudo docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' garden-api 2>/dev/null | grep -qw "$NET"; then
  echo "garden-api 已在 $NET 上，幂等重载"
  if ! sudo docker exec "$NGINX" nginx -t; then restore_conf; exit 1; fi
  sudo docker exec "$NGINX" nginx -s reload
  if curl -fsS "$HEALTH"; then echo; echo "完成（幂等）"; exit 0; fi
  echo "健康检查失败"; restore_conf; sudo docker exec "$NGINX" nginx -s reload || true; exit 1
fi

echo "--- 3/6 启动新容器 $NEW（别名 garden-api；旧容器继续服务）"
sudo docker rm -f "$NEW" >/dev/null 2>&1 || true
sudo docker run -d --name "$NEW" --restart unless-stopped \
  --network "$NET" --network-alias garden-api \
  --user 1000:1001 \
  -e PORT=8787 -e DATA_DIR=/data/garden -e MAX_USERS=5 -e TRUST_PROXY=1 \
  -v "$APP_HOST_DIR":/app/server:ro \
  -v /vol1/1000/Docker/Data:/data \
  node:24-alpine node --no-warnings /app/server/index.mjs
sleep 2

echo "--- 4/6 校验并重载 nginx（此时切到新容器）"
if ! sudo docker exec "$NGINX" nginx -t; then
  echo "nginx -t 失败：移除新容器、恢复旧配置，线上不受影响"
  sudo docker rm -f "$NEW" >/dev/null 2>&1 || true
  restore_conf
  exit 1
fi
sudo docker exec "$NGINX" nginx -s reload
sleep 1

echo "--- 5/6 健康检查"
if ! curl -fsS "$HEALTH"; then
  echo
  echo "健康检查失败：恢复旧配置并重载，移除新容器（旧容器仍在）"
  restore_conf
  sudo docker exec "$NGINX" nginx -s reload || true
  sudo docker rm -f "$NEW" >/dev/null 2>&1 || true
  exit 1
fi
echo

echo "--- 6/6 收尾：移除旧容器，新容器改名为 garden-api"
sudo docker rm -f garden-api >/dev/null 2>&1 || true
sudo docker rename "$NEW" garden-api
sudo docker ps --filter name=garden-api --format '{{.Names}}  {{.Status}}  {{.Ports}}'
echo "确认 8787 已不再映射到宿主机（下面应为空）："
sudo docker port garden-api || true
echo "迁移完成 ✅"
