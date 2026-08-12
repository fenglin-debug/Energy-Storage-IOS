# 腾讯云 COS + CDN 部署（控制台手动）

本指南把 `ios-pwa/dist` 发布到**你自己的子域名**，供 iPhone Safari 安装 PWA。

上传包（本机构建产物）：

- 目录：`ios-pwa/dist/`
- 压缩包：`ios-pwa/deploy/bess-ios-pwa-dist.zip`（若已执行打包脚本）

> 密钥不要发给任何人、不要提交到 Git。全程用腾讯云网页控制台即可。

---

## 一、整体架构

```text
iPhone Safari
    → https://pwa.你的域名.com   （CDN 自定义域名 + HTTPS）
        → 腾讯云 CDN 源站
            → COS 存储桶（静态网站 / 对象存储）
```

推荐子域名示例（任选其一，需你在域名 DNS 里能加记录）：

- `bess.example.com`
- `pwa.example.com`
- `english.example.com`

**不要**把密钥写进仓库。子域名专用，避免影响主站。

---

## 二、创建 COS 存储桶

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/) → **对象存储 COS**
2. **存储桶列表** → **创建存储桶**
   - **名称**：如 `bess-pwa-xxxxxx`（全局唯一，后面可改显示名）
   - **所属地域**：选离你用户近的，如 `ap-guangzhou` / `ap-shanghai`
   - **访问权限**：**私有读写**（后面走 CDN 回源，更安全）  
     若暂时不用 CDN、只想快速试：可选 **公有读私有写**（安全性较差，仅测试）
3. 创建完成后进入该桶

### 2.1 开启「静态网站」（SPA 必需）

1. 桶详情 → **基础配置** → **静态网站** → 开启  
2. 索引文档：`index.html`  
3. 错误文档：`index.html`（React Router 刷新子路径时回退到前端路由）  
4. 保存后会得到类似静态网站域名：  
   `https://bess-pwa-xxxxxx.cos-website.ap-guangzhou.myqcloud.com`  
   （仅作源站/测试，最终用你自己的域名）

### 2.2 上传文件

**方式 1：网页上传（文件不多时可）**

1. **文件列表** → **上传文件**  
2. 上传 `dist` **里面的全部内容**（不是上传外层 `dist` 文件夹本身）  
   正确根目录应能看到：

   ```text
   index.html
   manifest.webmanifest
   sw.js
   assets/
   content/
     bundled.besspack
     bundled.bessarticle
   icons/
   ```

3. `content` 约 70MB+，上传时保持网络稳定；可先上传 `content`，再传其余  

**方式 2：用压缩包（推荐）**

1. 本机使用：`ios-pwa/deploy/bess-ios-pwa-dist.zip`  
2. COS 控制台 → **上传文件** → 选 zip → 勾选 **自动解压**（若控制台提供）  
   若无自动解压：先在本机解压，再选文件夹上传  

上传完成后，用浏览器直接访问（若桶为公有读或已配 CDN）：

- `https://你的源站/index.html` 应出页面  
- `https://你的源站/content/bundled.besspack` 应能下载大文件  

### 2.3 建议的 MIME / 元数据（上传后检查）

| 文件 | Content-Type 建议 |
|------|-------------------|
| `index.html` | `text/html; charset=utf-8` |
| `*.js` | `application/javascript` |
| `*.css` | `text/css` |
| `manifest.webmanifest` | `application/manifest+json` |
| `sw.js` | `application/javascript` |
| `content/*.besspack` | `application/octet-stream` |
| `content/*.bessarticle` | `application/octet-stream` |

多数浏览器对默认类型也能用；若 manifest 安装异常，再在对象「元数据」里改 `Content-Type`。

---

## 三、配置 CDN（推荐，HTTPS + 自定义域名）

1. 控制台 → **内容分发网络 CDN** → **域名管理** → **添加域名**
2. **加速域名**：填子域名，如 `bess.你的域名.com`
3. **加速区域**：中国境内 / 全球（按你备案与用户位置）
4. **源站类型**：对象存储 COS / 或「源站域名」选该桶  
   - 若用了静态网站功能，源站填 **COS 静态网站域名**（带 `cos-website` 的那个）更利于 SPA 回退  
   - 否则填默认 COS 访问域名
5. **回源鉴权 / 私有桶访问**：若桶是私有，开启 **CDN 回源鉴权**（按控制台向导授权）
6. 提交后状态为「部署中」，记下 CDN 给的 **CNAME 地址**（如 `xxxx.cdn.dnsv1.com`）

### 3.1 DNS 解析

到你的**域名注册商 / DNS 控制台**（可能在腾讯云 DNSPod、阿里云、Cloudflare 等）：

| 主机记录 | 类型 | 记录值 |
|----------|------|--------|
| `bess`（子域前缀） | **CNAME** | CDN 提供的 CNAME 域名 |

保存后等待解析生效（几分钟到几小时）。

### 3.2 HTTPS 证书

1. CDN 域名管理 → 你的加速域名 → **HTTPS 配置**
2. 开启 HTTPS  
3. 证书：  
   - 腾讯云 **免费证书** 申请并部署到该域名，或  
   - 上传已有证书  
4. 建议开启 **强制 HTTPS** / HTTP 自动跳转 HTTPS  
5. 保存并等待配置生效  

PWA「添加到主屏幕」在真机上**需要 HTTPS**（localhost 除外）。

### 3.3 缓存建议（减少装包异常）

在 CDN 域名 → **缓存配置**：

| 路径/类型 | 建议 |
|-----------|------|
| `index.html`、`sw.js`、`manifest.webmanifest` | 缓存时间短（如 0–60 秒）或遵循源站 |
| `/assets/*` | 长缓存（文件名带 hash，可 30 天） |
| `/content/*` | 长缓存（语料不变时，如 7–30 天） |
| `/icons/*` | 长缓存 |

更新发版后：对 `index.html`、`sw.js` 做一次 **URL 刷新/目录刷新**。

### 3.4 跨域（一般同域不需要）

App 与语料同域名时无需 CORS。若语料放到另一域名，再在 COS 配 CORS，本方案不推荐拆域。

---

## 四、验收清单

在电脑浏览器打开：`https://bess.你的域名.com`

- [ ] 页面能打开，不是 COS XML 报错  
- [ ] `https://…/manifest.webmanifest` 返回 JSON  
- [ ] `https://…/content/bundled.besspack` 能开始下载（体积约 40MB）  
- [ ] `https://…/content/bundled.bessarticle` 约 34MB  
- [ ] 控制台无大量 404  

再在 iPhone：

1. **Safari** 打开该 HTTPS 地址  
2. 分享 → **添加到主屏幕**  
3. 从桌面图标打开，等首次语料加载完成  
4. 开飞行模式再试词汇/情景/文章  

---

## 五、更新版本时

本机：

```powershell
cd ios-pwa
npm run build
# 重新打 zip（可选）
Compress-Archive -Path dist\* -DestinationPath deploy\bess-ios-pwa-dist.zip -Force
```

控制台：覆盖上传 `dist` 内文件 → CDN 刷新 `index.html` 与 `sw.js`。

---

## 六、我（助手）能代做 vs 需要你做

| 步骤 | 谁做 |
|------|------|
| 本地 `npm run build`、打 zip | 助手可做 |
| 登录腾讯云、创建桶、上传、开 CDN、DNS、证书 | **必须你本机/账号操作**（无你的登录态） |
| 验收 URL、改配置 | 你提供最终 `https://子域名` 后，助手可帮你远程访问检查页面是否通 |

把最终地址发过来（例如 `https://bess.xxx.com`），我可以帮你检查首页、manifest、语料 URL 是否正常。
