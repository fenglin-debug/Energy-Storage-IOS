#!/usr/bin/env bash
# 服务器端一键部署 (由本机部署器以 sudo 调用)
# 目标: bess.fenglinai.com 腾讯云 CVM
# 流程: 预检/装组件 → 放 dist(webroot) → 临时HTTP → certbot → 正式配置 → 账号 → 发布 → 健康检查
set -euo pipefail

DOMAIN="bess.fenglinai.com"
WWW=/var/www/bess
PKG=/home/ubuntu/bess-deploy/deploy-package
STAGE=/home/ubuntu/bess-deploy/stage

echo "========== [1/8] 预检与组件安装 =========="
echo "系统: $(uname -a | cut -c1-120)"

if ! command -v nginx >/dev/null 2>&1; then
  echo "==> 安装 nginx ..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/dev/null
    apt-get install -y nginx >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nginx >/dev/null
  fi
fi
if ! command -v certbot >/dev/null 2>&1; then
  echo "==> 安装 certbot ..."
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/dev/null
    apt-get install -y certbot python3-certbot-nginx >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    yum install -y certbot python3-certbot-nginx >/dev/null
  fi
fi
systemctl enable --now nginx >/dev/null 2>&1 || true
echo "nginx: $(nginx -v 2>&1) | certbot: $(certbot --version 2>&1)"

echo "========== [2/8] 放置 dist (webroot + 备用) =========="
mkdir -p "$WWW/current" "$WWW/releases" "$WWW/shared"
rm -rf "$WWW/current/dist" 2>/dev/null || true
cp -a "$PKG/dist" "$WWW/current/dist"
chown -R root:root "$WWW/current/dist"
echo "dist 已就位: $(du -sh "$WWW/current/dist" | cut -f1)"

echo "========== [3/8] 临时 HTTP 站点 (用于 ACME 验证) =========="
cat > /etc/nginx/conf.d/bess-http.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    root ${WWW}/current/dist;
    index index.html;
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
nginx -t && nginx -s reload
echo "80 端口验证: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/ || echo 无响应)"

echo "========== [4/8] Let's Encrypt 签发证书 (webroot) =========="
mkdir -p "${WWW}/current/dist/.well-known/acme-challenge"
certbot certonly --webroot -w "${WWW}/current/dist" -d "$DOMAIN" \
  --agree-tos --register-unsafely-without-email -n
mkdir -p "/etc/nginx/ssl/${DOMAIN}"
ln -sfn "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "/etc/nginx/ssl/${DOMAIN}/fullchain.pem"
ln -sfn "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" "/etc/nginx/ssl/${DOMAIN}/privkey.pem"
cat > /etc/cron.d/certbot-bess <<'EOF'
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3 * * * root certbot renew --quiet --deploy-hook 'nginx -s reload' >> /var/log/certbot-renew.log 2>&1
EOF
echo "证书已签发"

echo "========== [5/8] 安装正式站点配置 =========="
rm -f /etc/nginx/conf.d/bess-http.conf
cd "$PKG"
bash install.sh "$DOMAIN"

echo "========== [6/8] 生成共享账号 =========="
bash gen-htpasswd.sh bess 2>&1 | tee /var/www/bess/shared/htpasswd-output.txt
chmod 600 /var/www/bess/shared/htpasswd-output.txt

echo "========== [7/8] 发布 =========="
cd "$PKG"
bash release.sh 0.3.0-20260804 "$PKG/dist"

echo "========== [8/8] 健康检查 =========="
cd "$PKG"
bash healthcheck.sh "$DOMAIN"

echo "========== 部署流程结束 =========="
