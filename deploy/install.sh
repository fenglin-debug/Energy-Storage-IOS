#!/usr/bin/env bash
# 初始化服务器目录结构与 nginx 配置 (在腾讯云 CVM 上以 root 执行一次)
# 只新增 /etc/nginx/conf.d/bess-site.conf, 不影响服务器上其他站点。
# 用法: bash install.sh bess.fenglinai.com
set -euo pipefail

DOMAIN="${1:?用法: bash install.sh <域名>}"
WWW=/var/www/bess

# 脚本所在目录(与运行目录无关)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 预检"
if ! command -v nginx >/dev/null 2>&1; then
  echo "错误: 未安装 nginx, 请先安装 (yum install -y nginx 或 apt install -y nginx)" >&2
  exit 1
fi
if command -v certbot >/dev/null 2>&1; then
  echo "  [ok] nginx 已安装"
  echo "  [ok] certbot 已安装 (Let's Encrypt 可用)"
else
  echo "  [ok] nginx 已安装"
  echo "  [提示] 未安装 certbot, setup-ssl.sh 会提示安装命令"
fi

echo "==> 创建目录结构"
# 注意: 不创建 $WWW/current 目录 — current 由 release.sh 用软链接管理
mkdir -p "$WWW/releases" "$WWW/shared" /etc/nginx/conf.d /etc/nginx/ssl

echo "==> 安装 nginx 站点配置 (域名占位替换)"
SED_SAFE_DOMAIN=$(printf '%s' "$DOMAIN" | sed 's/[&/\]/\\&/g')
sed "s/bess\.example\.com/${SED_SAFE_DOMAIN}/g" "$SCRIPT_DIR/nginx/bess-site.conf" \
  > /etc/nginx/conf.d/bess-site.conf

echo "==> 安装安全响应头片段"
cp "$SCRIPT_DIR/nginx/bess-security-headers.conf" /etc/nginx/conf.d/bess-security-headers.conf

echo "==> 校验 nginx 配置"
nginx -t

echo "==> 重新加载 nginx"
nginx -s reload

cat <<EOF
==> 站点配置完成: $DOMAIN

接下来依次执行:
  1) bash $SCRIPT_DIR/setup-ssl.sh $DOMAIN             # Let's Encrypt 签发 HTTPS 证书
  2) bash $SCRIPT_DIR/release.sh 0.3.1-20260808 ./dist  # 发布
  3) bash $SCRIPT_DIR/healthcheck.sh $DOMAIN            # 验证

注意: 不要执行 gen-htpasswd.sh —— 全站 Basic Auth 已移除(PWA standalone
      不携带 Basic Auth 凭据, 会导致桌面打开 401)。

前置确认(腾讯云控制台):
  - DNS: $DOMAIN 的 A 记录已解析到本机公网 IP
  - 安全组: 入站 80 与 443 端口已放行
EOF
