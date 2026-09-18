#!/usr/bin/env bash
# 庭院保卫战 · 从 Mac 部署后端到飞牛 NAS（依赖 ~/.ssh/config 中的 fnos）
set -euo pipefail

NAS=fnos
APP_HOST_DIR=/vol1/1000/Docker/garden-server
NGINX_CONF=/vol1/1000/Docker/chinese-chess/confdata/default.conf
GAME_PORT=5888
ROOT=$(cd "$(dirname "$0")/.." && pwd)

echo "==> 1/4 上传后端代码到 $NAS:$APP_HOST_DIR"
ssh "$NAS" "mkdir -p $APP_HOST_DIR"
scp -q "$ROOT/server/store.mjs" "$ROOT/server/auth.mjs" "$ROOT/server/index.mjs" "$NAS:$APP_HOST_DIR/"

echo "==> 2/4 准备数据目录"
ssh "$NAS" "mkdir -p /vol1/1000/Docker/Data/garden"

echo "==> 3/4 检查 Nginx 的 /api/ 反代（缺失或目标不符直接失败，避免部署后接口 404）"
if ! ssh "$NAS" "grep -q 'location /api/' $NGINX_CONF"; then
  echo "    缺少 /api/ 配置：请参考 deploy/nginx-garden-api.conf 添加后重试"
  exit 1
fi
if ! ssh "$NAS" "grep -q 'garden-api:8787' $NGINX_CONF"; then
  echo "    ⚠ /api/ 反代目标不是 http://garden-api:8787。"
  echo "      本次部署会把 garden-api 放进 garden-net 且不再发布 8787 到宿主机，"
  echo "      旧写法（宿主机 IP:8787）会失效，请更新为 proxy_pass http://garden-api:8787;"
  exit 1
fi
echo "    已存在且目标正确"

echo "==> 4/4 在 NAS 上启动容器并重载 Nginx（会提示输入 sudo 密码）"
scp -q "$ROOT/deploy/remote-garden-setup.sh" "$NAS:$APP_HOST_DIR/remote-garden-setup.sh"
ssh -t "$NAS" "bash $APP_HOST_DIR/remote-garden-setup.sh"

echo "==> 完成。游戏地址 http://192.168.199.5:$GAME_PORT"
