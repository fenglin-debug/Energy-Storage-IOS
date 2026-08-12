#!/usr/bin/env bash
# 发布: 版本目录 + current 软链接, 切换前健康检查, 失败自动回滚
# 用法: bash release.sh <版本号> <本地dist路径>
#   例: bash release.sh 0.2.0-20260804 ../dist
# 结构: releases/<版本>/dist 与 nginx root (/var/www/bess/current/dist) 对应,
#       current 为软链接 (install.sh 不再预建 current 目录, 避免冲突)。
set -euo pipefail

VERSION="${1:?用法: bash release.sh <版本号> <dist路径>}"
SRC_DIR="${2:?缺少 dist 路径}"
WWW=/var/www/bess
RELEASES="$WWW/releases"
TARGET="$RELEASES/$VERSION"
HEALTH_URL="${HEALTH_URL:-https://127.0.0.1/}"

if [ ! -d "$SRC_DIR" ] || [ ! -f "$SRC_DIR/index.html" ]; then
  echo "错误: $SRC_DIR 不是有效的 dist 目录 (缺少 index.html)" >&2
  exit 1
fi
if [ -e "$TARGET" ]; then
  echo "错误: 版本 $VERSION 已存在: $TARGET" >&2
  exit 1
fi

echo "==> 复制 dist → $TARGET/dist"
mkdir -p "$TARGET/dist"
cp -a "$SRC_DIR/." "$TARGET/dist/"

# 不含 bundled 语料的发布必须带 catalog; 有 catalog 校验之
if [ -f "$TARGET/dist/content/catalog.json" ]; then
  echo "==> 检查 content 目录内容"
  ls -1 "$TARGET/dist/content/" | head -5
else
  echo "警告: 未找到 content/catalog.json, 首次安装将无法在线下载语料!" >&2
fi

echo "==> 切换到 current"
rm -rf "$WWW/current" 2>/dev/null || true
ln -sfn "$TARGET" "$WWW/current"
nginx -s reload

echo "==> 健康检查 (10s 超时)"
sleep 1
CODE=$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)
if [ "$CODE" = "200" ] || [ "$CODE" = "401" ]; then
  echo "==> 健康检查通过 (HTTP $CODE): $VERSION 已上线"
else
  echo "==> 健康检查失败 (HTTP ${CODE:-无响应}), 回滚到上一版本" >&2
  PREV=$(ls -1 "$RELEASES" | grep -v "^$VERSION$" | sort -V | tail -1 || true)
  if [ -n "$PREV" ]; then
    rm -rf "$WWW/current" 2>/dev/null || true
    ln -sfn "$RELEASES/$PREV" "$WWW/current"
    nginx -s reload
    echo "已回滚到 $PREV"
  else
    echo "无上一版本可回滚, 请人工处理" >&2
  fi
  exit 1
fi

echo "完成。用户手机端会在下次打开时更新 (学习数据不受影响)。"
