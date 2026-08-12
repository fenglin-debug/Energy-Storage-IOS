#!/usr/bin/env bash
# 服务器侧健康检查: nginx、磁盘、当前版本
# 用法: bash healthcheck.sh [域名]   # 默认 bess.fenglinai.com
set -euo pipefail

DOMAIN="${1:-bess.fenglinai.com}"
BASE="https://${DOMAIN}"

echo "==> nginx 状态"
systemctl is-active nginx || service nginx status || true

echo "==> 磁盘"
df -h /var/www | tail -1

echo "==> 当前版本"
readlink -f /var/www/bess/current 2>/dev/null || echo "(未发布)"

echo "==> 站点可达性"
CODE=$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/" || true)
case "$CODE" in
  200) echo "HTTP 200 — 站点正常" ;;
  301|302) echo "HTTP $CODE — 跳转(检查是否直接访问 https://)" ;;
  *) echo "HTTP ${CODE:-无响应} — 异常, 请检查 nginx 与证书" ;;
esac

echo "==> content 目录"
ls -1 /var/www/bess/current/dist/content/ 2>/dev/null || echo "(无 content 目录)"
