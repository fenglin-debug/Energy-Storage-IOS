# 储能英语实战 — iOS PWA

Android 版的 **iOS 可安装网页应用** 复刻：React + Vite + TypeScript，完全离线学习，共用 `.besspack` / `.bessarticle` / `.bessbackup`。

## 快速开始

```powershell
cd ios-pwa
npm install
npm run dev
```

详细安装与真机步骤见 [docs/INSTALL.md](docs/INSTALL.md)。

## 目录

| 路径 | 说明 |
|---|---|
| `src/domain` | 模型、FSRS、Repository 契约 |
| `src/data` | IndexedDB、包校验、导入、音频、备份 |
| `src/features` | 词汇 / 情景 / 文章 / 设置 UI |
| `src/app` | 壳、路由、启动 |
| `public/content` | 构建期从 Android 复制的内置包 |
| `scripts` | 资源锁定复制、合约扫描 |

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run prepare-assets` | 校验 SHA 并复制 Android 内置包 |
| `npm run dev` | 本地开发 |
| `npm run build` | 生产构建 |
| `npm test` | 单测（含 FSRS） |
| `npm run verify-contracts` | 禁止业务联网/录音 API |

## 铁律

- 运行时不发起远程 API；首启仅加载本站静态 `/content/*`
- 不录音、不做 ASR/AI
- 未揭示的客户原文/关键词/答案不进入 DOM
- 导入失败不得清空学习记忆
