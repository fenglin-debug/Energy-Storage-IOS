#!/usr/bin/env bash
# 一键回滚到上一版本 (不触碰用户手机数据库)
# 用法: bash rollback.sh
set -euo pipefail

WWW=/var/www/bess
RELEASES="$WWW/releases"
CURRENT=$(readlink -f "$WWW/current" 2>/dev/null || echo "")

echo "当前版本: $CURRENT"
# sort -V: 语义化版本排序, 正确处理 0.9 < 0.10
PREV=$(ls -1 "$RELEASES" 2>/dev/null | sort -V | tail -1 || true)
if [ -z "$PREV" ]; then
  echo "无版本可回滚" >&2
  exit 1
fi

echo "回滚到: $RELEASES/$PREV"
rm -rf "$WWW/current" 2>/dev/null || true
ln -sfn "$RELEASES/$PREV" "$WWW/current"
nginx -s reload

sleep 1
CODE=$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' "https://127.0.0.1/" || true)
if [ "$CODE" = "200" ] || [ "$CODE" = "401" ]; then
  echo "回滚完成: $PREV 已生效"
else
  echo "警告: 健康检查未通过 (HTTP ${CODE:-无响应}), 请检查 nginx 状态" >&2
  exit 1
fi
