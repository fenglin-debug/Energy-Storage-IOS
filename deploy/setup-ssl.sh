#!/usr/bin/env bash
# HTTPS 证书安装(非交互, 自助部署用)
# 默认使用 Let's Encrypt (certbot) 自动签发 + 自动续期;
# 已有腾讯云/其他证书时用 --tencent 分支手动上传。
# 用法:
#   bash setup-ssl.sh bess.fenglinai.com          # Let's Encrypt(推荐)
#   bash setup-ssl.sh --tencent bess.fenglinai.com # 手动上传已有证书
set -euo pipefail

MODE="certbot"
if [ "${1:-}" = "--tencent" ]; then
  MODE="tencent"
  shift
fi

DOMAIN="${1:?用法: bash setup-ssl.sh [--tencent] <域名>}"
SSL_DIR="/etc/nginx/ssl/${DOMAIN}"
mkdir -p "$SSL_DIR"

if [ "$MODE" = "tencent" ]; then
  echo "==> 手动证书模式"
  echo "请将 Nginx 格式证书(fullchain.pem 与 privkey.pem)上传到:"
  echo "    $SSL_DIR/"
  echo "上传完成后执行: nginx -t && nginx -s reload"
  echo "然后继续执行: bash release.sh <版本> ./dist"
  exit 0
fi

# ---- Let's Encrypt 非交互分支 ----
if ! command -v certbot >/dev/null; then
  echo "错误: 未安装 certbot, 请先安装后重试:" >&2
  echo "  TenOS/CentOS:  yum install -y certbot python3-certbot-nginx" >&2
  echo "  Debian/Ubuntu: apt install -y certbot python3-certbot-nginx" >&2
  exit 1
fi

echo "==> 使用 certbot 签发证书 (http-01, 需 80 端口可访问)"
# --non-interactive --keep-until-expiring: 已存在未到期证书时保留(避免交互卡住)
certbot certonly --nginx -d "$DOMAIN" --agree-tos --register-unsafely-without-email \
  --non-interactive --keep-until-expiring

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
ln -sfn "$CERT_DIR/fullchain.pem" "$SSL_DIR/fullchain.pem"
ln -sfn "$CERT_DIR/privkey.pem"   "$SSL_DIR/privkey.pem"

echo "==> 添加自动续期 (每天 3:00 检查)"
cat > /etc/cron.d/certbot-bess <<EOF
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3 * * * root certbot renew --quiet --deploy-hook 'nginx -s reload' >> /var/log/certbot-renew.log 2>&1
EOF

nginx -t && nginx -s reload
echo "完成: HTTPS 已启用并配置自动续期。"
