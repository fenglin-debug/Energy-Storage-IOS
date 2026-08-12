# 部署说明 — www.fenglinai.com(自助发布)

> 本工具包包含:构建好的 `dist/` + 一键部署脚本 + nginx 配置。
> 目标:腾讯云 CVM,已备案域名 `www.fenglinai.com`,Let's Encrypt 免费证书。
> 只新增 `bess` 站点配置,不会影响服务器上其他站点。
>
> ⚠️ 不要配置 Basic Auth!PWA 从主屏幕打开(standalone)不携带 Basic Auth
> 凭据,会导致 401。本工具包已移除 Basic Auth。

## 前置确认(3 项,很重要)

1. **DNS**:`www.fenglinai.com` 的 A 记录已解析到服务器公网 IP
   - 域名商控制台 → DNS 解析 → 添加:主机记录 `www`、类型 `A`、记录值 `服务器公网IP`
2. **安全组**:腾讯云控制台 → CVM → 安全组 → 放行入站 `80` 与 `443` 端口
3. **nginx**:服务器已安装 nginx(未装:TenOS/CentOS `yum install -y nginx`,Debian/Ubuntu `apt install -y nginx`)

> 若 `www.fenglinai.com` 已用于其他网站,建议改用子域名(如 `bess.fenglinai.com`),
> 避免根路径冲突。子域名同样走已备案的 fenglinai.com,无需重新备案。

## 执行步骤(SSH 登录服务器,root 或 sudo 执行)

```bash
# 1) 上传本工具包到服务器(任意目录, 下面以 /root/bess-deploy 为例)
#    在本地电脑执行(需先解压 zip):
#      scp -r deploy-package root@<服务器IP>:/root/bess-deploy

# 2) 进入工具包目录
cd /root/bess-deploy

# 3) 安装站点配置(自动把 conf 里的 bess.example.com 替换为 www.fenglinai.com,
#    nginx -t 校验 + reload)
bash install.sh www.fenglinai.com

# 4) 签发 Let's Encrypt HTTPS 证书(自动续期, 需 80 端口可访问 + DNS 已生效)
bash setup-ssl.sh www.fenglinai.com

# 5) 发布当前版本(0.3.1)
bash release.sh 0.3.1-20260808 ./dist

# 6) 验证
bash healthcheck.sh www.fenglinai.com
```

## 预期结果

| 检查 | 预期 |
|---|---|
| `http://www.fenglinai.com` | 301 跳转 HTTPS |
| `https://www.fenglinai.com` | 200,进入应用首页 |
| 页面底部 | 显示「沪ICP备2026026194号」「沪公网安备31011702891887号」两个链接 |
| 首次启动 | 联网下载语料(corpus-*.besspack 约 40MB + 文章 34MB)显示进度 |
| `https://www.fenglinai.com/content/catalog.json` | 返回 JSON 目录 |
| iPhone Safari 添加到主屏幕后打开 | 正常进入应用(无 401) |

## 学习进度安全

- 学习进度全部存在用户**手机本机** IndexedDB,服务器不接收任何学习数据。
- 本次版本升级 **不改动数据库结构**(`DATABASE_VERSION` 保持 2),已学过的词汇/
  情景/文章进度、复习记录全部保留,Service Worker 静默更新后自动重载即生效。
- `release.sh` 发布新版本时,旧版本目录保留,`rollback.sh` 可一键回退,
  全程不触碰用户手机端数据。

## 常见问题

- **certbot 报"未安装"**:按提示安装后重跑 `setup-ssl.sh`。
- **证书签发失败(80 端口)**:确认安全组放行 80、DNS 已生效(`ping www.fenglinai.com`
  指向本机 IP)。如确实无法用 HTTP 验证,改用已有腾讯云证书:上传 `fullchain.pem`+
  `privkey.pem` 到 `/etc/nginx/ssl/www.fenglinai.com/` 后
  `bash setup-ssl.sh --tencent www.fenglinai.com`。
- **回滚**:`bash rollback.sh` 一键切回上一版本,不影响用户手机学习数据。
- **更新版本**:本地重新 `npm run build` 后,把新 `dist/` 传上来执行
  `bash release.sh <新版本> ./dist`。用户打开应用会自动检测到新版本并重载,进度不丢。
- **桌面打开 401**:确认服务器上 `/etc/nginx/conf.d/bess-site.conf` 里
  `auth_basic` 两行已注释(本工具包默认已移除)。如仍 401,重新执行 `install.sh`。

## 版本记录

- 0.3.1-20260808:移除 Basic Auth(修复桌面 PWA 401)、版本号升级、SW fallback 健壮化、
  下载超时/zip bomb 防护、备份恢复 schema 校验、CSP。`DATABASE_VERSION` 不变,进度不丢。
- 0.3.0-20260804:首次发布(ICP 页脚、语料 SHA 版本化、SW 手动更新)
