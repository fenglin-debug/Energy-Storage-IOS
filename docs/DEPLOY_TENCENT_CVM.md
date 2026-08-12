# 腾讯云 CVM 部署指南(纯静态 PWA,无推送)

本文档说明如何把 iOS PWA 发布到腾讯云大陆服务器(CVM)+ 已备案子域名 `bess.fenglinai.com`。
**不包含任何推送/通知服务**——应用完全离线,服务器只托管静态文件。
推荐使用 `deploy/README-DEPLOY.md` 的自助发布工具包流程(打包后上传执行)。

## 前提

- 一台腾讯云大陆 CVM(Linux,建议 TencentOS/CentOS/Debian/Ubuntu),已开放 80/443 端口
- 已备案子域名 `bess.fenglinai.com`,A 记录解析到该服务器公网 IP(中国大陆服务器绑定域名必须完成备案/接入备案)
- 服务器已安装 nginx(未装:`yum install -y nginx` 或 `apt install -y nginx`)
- 同一台服务器可能还有其他站点——部署**只新增** `/etc/nginx/conf.d/bess-site.conf`,不影响其他站点

## 0. 一键发布工具包(推荐)

本地执行:

```bash
cd ios-pwa
npm run build                    # 构建(含 ICP 页脚)
npm run pack:deploy-package      # 生成 deploy/bess-ios-pwa-deploy-package.zip
```

把 zip 上传服务器解压,按包内 `README-DEPLOY.md` 执行 7 条命令即可。
工具包内含:dist/ + nginx 配置 + install/gen-htpasswd/setup-ssl/release/rollback/healthcheck 脚本。

## 1. 服务器初始化(手动方式)

```bash
cd /root
# 上传 deploy/ 目录后:
bash deploy/install.sh bess.fenglinai.com     # 创建目录 + 安装 nginx 配置(带预检)
bash deploy/gen-htpasswd.sh bess              # 生成共享账号密码(强随机,只存服务器)
bash deploy/setup-ssl.sh bess.fenglinai.com   # Let's Encrypt 自动签发(默认)
```

- Basic Auth 密码**不提交仓库**,由 `gen-htpasswd.sh` 生成后写入 `/etc/nginx/bess.htpasswd`。
- 全站统一 Basic Auth:所有页面(含 `/content/*` 语料)均需凭据。
- 已有证书时用 `bash setup-ssl.sh --tencent bess.fenglinai.com` 手动上传。

## 2. 本地构建与发布

```bash
cd ios-pwa
npm install
npm run build        # prebuild 生成 SHA 版本化语料 + catalog.json; postbuild 清理 bundled 副本
bash deploy/release.sh 0.3.0-20260804 ./dist   # 服务器端执行(或 scp dist 后执行)
```

`release.sh` 流程:

1. `dist` 复制到 `/var/www/bess/releases/<版本>/`
2. 切换 `current` 软链接 → 新版本目录
3. `nginx -s reload` 后健康检查(默认 `https://127.0.0.1/`,无凭据预期 401/200)
4. 失败自动回滚到上一版本,**不触碰用户手机端学习数据库**

## 3. ICP 备案号展示(中国大陆合规要求)

应用在**所有页面底部**(含离线页 `offline.html`)固定展示两条备案链接:

| 文本 | 链接 |
|---|---|
| 沪ICP备2026026194号 | https://beian.miit.gov.cn |
| 沪公网安备31011702891887号 | https://beian.mps.gov.cn |

- 实现位置:`src/app/App.tsx` 的 `.icp-footer`、`public/offline.html`
- 页面已加 `robots noindex,nofollow`,降低搜索引擎收录风险;站点保留 Basic Auth,备案号在登录后可见
- **更换域名/主体时必须同步更新这两处备案号**

## 4. 缓存与版本化策略

| 文件 | 缓存 | 原因 |
|---|---|---|
| `index.html` / `sw.js` | 不缓存 | 保证版本更新即时生效 |
| `manifest.webmanifest` / `content/catalog.json` | 不缓存 | 索引文件必须新鲜 |
| `/assets/*`(带 hash) | 1 年 immutable | 内容不可变 |
| `/content/corpus-<sha12>.*` | 1 年 immutable | SHA 版本化文件名,新版本自动换新 URL |
| `/icons/*` | 1 天 | 改图标无需等长缓存 |

语料文件在构建期由 `scripts/build-catalog.mjs` 按内容 SHA-256 前 12 位命名,
任何内容变更都会产生新文件名,天然避免 CDN/浏览器读取旧包。

## 5. 安全配置

- 强制 HTTPS(HTTP 301 → HTTPS),HSTS 一年
- CSP、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` —— 明确禁用录音/定位
- `robots.txt`/meta `noindex,nofollow` —— 降低被搜索引擎收录的风险
- 全站 Basic Auth(共享账号),IP 白名单可再叠加

## 6. 健康检查

```bash
bash deploy/healthcheck.sh bess.fenglinai.com
```

预期:nginx active、HTTP 401(无凭据)/ 200(带凭据)、content 目录含 `catalog.json` 与版本化文件。

## 7. 首次使用流程(用户侧)

1. Safari 打开 `https://bess.fenglinai.com` → 输入共享账号密码登录
2. 首次启动联网下载语料(约 70MB+,显示进度)→ 解压激活 → 可离线学习
3. 点底部分享 →「添加到主屏幕」→ 独立窗口运行
4. 学习记录全部保存在本机 IndexedDB,服务器不接收任何学习数据

## 8. 更新版本

1. 本地 `npm run build`
2. 服务器 `bash deploy/release.sh <新版本> <dist>`(或重新打包工具包上传)
3. 用户打开应用 → 顶部出现"发现新版本"横幅 → 点击立即更新(学习进度不丢)

## 9. 回滚

```bash
bash deploy/rollback.sh
```

一键切回上一版本目录,不触碰用户手机端学习数据库。

## 10. 常见问题

- **首次启动一直下载失败**:确认 `/content/catalog.json` 存在且带 Basic Auth 可访问;检查磁盘空间。
- **更新后语料未变**:语料按 SHA 版本化,内容不变则文件名不变,属正常。
- **Basic Auth 弹窗在 PWA 中反复出现**:Safari 会把凭据存入钥匙串;确认浏览器非"无痕模式"。
- **证书签发失败**:确认 80 端口放行、DNS 已生效;或改用 `setup-ssl.sh --tencent` 上传已有证书。
- **手机收不到更新横幅**:SW 更新需要联网触发;确认服务器新版本已发布。
