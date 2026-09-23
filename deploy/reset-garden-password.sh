#!/usr/bin/env bash
# 庭院保卫战 · 忘记密码时重置某个账号的登录密码（保留 user.id 与云存档）
#
# 用法：
#   ./deploy/reset-garden-password.sh --list                 # 列出账号
#   ./deploy/reset-garden-password.sh <用户名>                # 交互式输入新密码（不回显）
#   ./deploy/reset-garden-password.sh <用户名> --password '新密码'
#
# 在 Mac 上执行会自动 SSH 到 NAS（沿用 deploy-garden.sh 的 fnos 别名）；
# 在 NAS 本机执行则直接用容器。可用环境变量覆盖：
#   NAS=fnos  CONTAINER=garden-api  APP_HOST_DIR=/vol1/1000/Docker/garden-server
#   SUDO=sudo（以 root 运行时留空）  DOCKER=docker
#
# 重要：重置后**必须重启后端**（服务把 users.json 缓存在内存里，不重启仍是旧密码）。
set -euo pipefail

NAS=${NAS:-fnos}
CONTAINER=${CONTAINER:-garden-api}
APP_HOST_DIR=${APP_HOST_DIR:-/vol1/1000/Docker/garden-server}
REMOTE_SCRIPT="$APP_HOST_DIR/reset-password.mjs"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
# 以 root 运行时把 SUDO 设为空即可（SUDO= ./deploy/reset-garden-password.sh <用户名>）。
SUDO=${SUDO-sudo}
DOCKER=${DOCKER:-docker}
run_sudo() { if [ -n "$SUDO" ]; then "$SUDO" "$@"; else "$@"; fi; }

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# 参数透传：本脚本只负责"找到容器并执行"，密码交给容器里的 node 脚本处理。
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
if [ ${#ARGS[@]} -eq 0 ]; then
  echo "用法：$0 <用户名> | --list" >&2
  echo "（加 --help 看完整说明）" >&2
  exit 2
fi

# ---------- 选择执行位置：NAS 本机 or 从 Mac 远程 ----------
if [ -f "$REMOTE_SCRIPT" ]; then
  echo "==> 在 NAS 本机执行"
  # 数据目录由容器环境变量决定，这里不需要猜路径。
  run_sudo "$DOCKER" exec -i "$CONTAINER" node /app/server/reset-password.mjs "${ARGS[@]}"
else
  echo "==> 通过 SSH（${NAS}）在 NAS 上执行"
  if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS" true 2>/dev/null; then
    echo "!! 无法免密登录 ${NAS}。" >&2
    echo "   请确认 ~/.ssh/config 里有该别名，或先把脚本传上去再在 NAS 上执行：" >&2
    echo "   scp deploy/reset-garden-password.sh ${NAS}:${APP_HOST_DIR}/" >&2
    exit 1
  fi
  # 只用普通用户检查存在性：sudo 在无终端时无法读密码，会把"存在"误判成"缺失"。
  if ! ssh -o BatchMode=yes "$NAS" "test -f $REMOTE_SCRIPT"; then
    echo "!! NAS 上找不到 ${REMOTE_SCRIPT}。" >&2
    echo "   先补传后端文件（deploy-garden.sh 会带上它）：" >&2
    echo "   scp server/reset-password.mjs ${NAS}:${APP_HOST_DIR}/" >&2
    exit 1
  fi
  # 密码这类参数不拼进命令行历史：交互模式由远端提示，--password 时才透传。
  ssh -t "$NAS" "$SUDO $DOCKER exec -i $CONTAINER node /app/server/reset-password.mjs $(printf '%q ' "${ARGS[@]}")"
fi

echo
echo "==> 别忘了重启后端（否则运行中的服务仍用内存里的旧哈希）"
if [ -f "$REMOTE_SCRIPT" ]; then
  echo "    sudo docker restart ${CONTAINER}"
else
  echo "    ssh ${NAS} 'sudo docker restart ${CONTAINER}'"
fi
