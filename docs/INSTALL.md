# iOS PWA 安装与使用

## 产品

**储能英语实战** 的 iOS 可安装网页应用（PWA），行为对齐 Android / HarmonyOS / Windows：

- 完全离线学习（首次需通过 HTTPS 或局域网下载应用与内置语料）
- 词汇 FSRS、情景对练、文章磨耳朵
- 导入 `.besspack` / `.bessarticle`，导出/恢复 `.bessbackup`
- 无账号、无录音、无联网 AI

## 开发

```powershell
cd ios-pwa
npm install
npm run dev
```

浏览器打开控制台打印的本地地址（如 `http://localhost:5173`）。同一 Wi‑Fi 下 iPhone 可用电脑局域网 IP 访问。

构建：

```powershell
npm run build
npm run preview
```

合约扫描与测试：

```powershell
npm run verify-contracts
npm test
```

`npm run prepare-assets` 会从 `android/app/src/main/assets` 复制锁定的内置包；SHA 变更会导致失败，需同步更新 `public/assets-lock.json`。

## 真机安装（iPhone Safari）

1. 将 `dist/` 部署到 **HTTPS** 站点（腾讯云 COS+CDN 控制台步骤见 [DEPLOY_TENCENT_COS.md](./DEPLOY_TENCENT_COS.md)）。
2. 用 **Safari** 打开站点（Chrome for iOS 也可浏览，但「添加到主屏幕」以 Safari 为准）。
3. 点底部分享 → **添加到主屏幕** → 添加。
4. 从主屏幕图标打开（standalone），首次启动会解压内置语料（约 70MB+），请保持页面打开。
5. 完成后可开启飞行模式验证离线学习。

上传包可在 `deploy/bess-ios-pwa-dist.zip`（需先 `npm run build` 并打包）。

## 存储与备份

- 进度与语料缓存在本机 IndexedDB / 站点存储。
- 清除 Safari「网站数据」会删除进度，**请先在设置中导出 `.bessbackup`**。
- 备份可与 Android / Windows 互通（字段对齐 v1；加密为 PBKDF2 600k + AES-256-GCM）。

## 已知平台限制

| 项 | 说明 |
|---|---|
| 首次需联网/局域网 | PWA 无法像 APK 零流量预装 74MB 包 |
| 音频自动播放 | iOS 需用户手势后首次播放 |
| 系统通知 | 产品不申请通知；不做推送提醒 |
| 存储回收 | 系统可能清理网站数据；务必定期备份 |
