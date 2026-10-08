#!/usr/bin/env bash
# 庭院保卫战 · 从 Mac 部署前端静态站点到飞牛 NAS（依赖 ~/.ssh/config 中的 fnos）
# 后端用 deploy-garden.sh；这里只同步 dist/ 到 Nginx 站点目录。
set -euo pipefail

NAS=fnos
SITE_HOST_DIR=/vol1/1000/Docker/garden/frontend-dist
GAME_HOST=192.168.199.5
GAME_PORT=5888
ROOT=$(cd "$(dirname "$0")/.." && pwd)

echo "==> 1/4 本地构建（vue-tsc --noEmit && vite build）"
(cd "$ROOT" && npm run build)

echo "==> 2/4 检查站点目录并备份 index.html"
if ! ssh "$NAS" "test -d $SITE_HOST_DIR"; then
  echo "    NAS 上不存在 $SITE_HOST_DIR；请先在 compose/nginx 里挂好站点目录"
  exit 1
fi
# 只备份入口文件：旧 hashed 资源按内容同步保留，回滚 = 把 index.html.bak-* 拷回 index.html。
ssh "$NAS" "cp -p $SITE_HOST_DIR/index.html $SITE_HOST_DIR/index.html.bak-\$(date +%Y%m%d-%H%M%S)"

echo "==> 3/4 上传 dist/（解包进现有目录，保留 bind mount 的 inode；不删旧 hashed 资源）"
# COPYFILE_DISABLE/--no-mac-metadata/--no-xattrs：避免 macOS 往 tar 里塞 AppleDouble
# 与 xattr 头（NAS 的 GNU tar 会为此刷一屏 "unknown extended header keyword" 警告）。
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf - -C "$ROOT/dist" . |
  ssh "$NAS" "tar xzf - -C $SITE_HOST_DIR"

echo "==> 4/4 校验：入口文件与本地一致，且能通过 Nginx 取到，接口健康"
ENTRY=$(grep -o 'assets/index-[A-Za-z0-9_-]*\.js' "$ROOT/dist/index.html" | head -1)
if [ -z "$ENTRY" ]; then
  echo "    本地 dist/index.html 里找不到入口 JS"
  exit 1
fi
REMOTE_ENTRY=$(ssh "$NAS" "grep -o 'assets/index-[A-Za-z0-9_-]*\.js' $SITE_HOST_DIR/index.html | head -1")
if [ "$ENTRY" != "$REMOTE_ENTRY" ]; then
  echo "    入口文件不一致：本地 $ENTRY / NAS $REMOTE_ENTRY"
  exit 1
fi
curl -fsS -o /dev/null -w "    $ENTRY → HTTP %{http_code}\n" \
  "http://$GAME_HOST:$GAME_PORT/$ENTRY"
curl -fsS "http://$GAME_HOST:$GAME_PORT/api/health"
echo
echo "==> 完成。游戏地址 http://$GAME_HOST:$GAME_PORT"
