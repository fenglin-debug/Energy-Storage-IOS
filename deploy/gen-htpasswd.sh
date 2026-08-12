#!/usr/bin/env bash
# 生成全站共享 Basic Auth 账号 (强随机密码, 只写入服务器, 不提交仓库)
# 用法: bash gen-htpasswd.sh [用户名]   # 默认用户 bess
set -euo pipefail

USER="${1:-bess}"
HTPASSWD=/etc/nginx/bess.htpasswd

if ! command -v openssl >/dev/null; then
  echo "需要 openssl" >&2
  exit 1
fi

# 生成 20 位强密码 (字母数字符号混合)
PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9!@#$%^&*_-' | head -c 20 || true)
if [ -z "$PASSWORD" ]; then
  PASSWORD=$(date +%s%N | sha256sum | base64 | head -c 20)
fi

HASH=$(openssl passwd -apr1 "$PASSWORD")
printf '%s:%s\n' "$USER" "$HASH" > "$HTPASSWD"

# nginx worker 用户必须可读该文件 (Ubuntu: www-data, CentOS/TenOS: nginx)
# 否则 auth_basic 打开失败会返回 500
if id www-data >/dev/null 2>&1; then
  chown root:www-data "$HTPASSWD"
  chmod 640 "$HTPASSWD"
elif id nginx >/dev/null 2>&1; then
  chown root:nginx "$HTPASSWD"
  chmod 640 "$HTPASSWD"
else
  chmod 600 "$HTPASSWD"
fi

echo "=============================================="
echo " Basic Auth 已写入 $HTPASSWD"
echo " 用户名: $USER"
echo " 密码:   $PASSWORD"
echo " 请立即复制保存; 此密码不会再次显示, 也未写入任何仓库。"
echo "=============================================="
echo "如需改密: bash gen-htpasswd.sh <用户名> 重新执行即可。"
