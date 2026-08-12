# iOS PWA 0.3.0

完整复刻 Android 功能与内容,纯离线架构,面向 iOS 17+ 的安装式 PWA。

## 新增功能

- **首页仪表盘**:今日任务进度、连续天数 + 近 7 天活动点、累计学习时长、断点续学卡片、推荐情景
- **例句模块**:353 条例句浏览/搜索/收藏/逐句跟读(客户/销售工程师双视角)
- **语料导入三阶段**:校验预览 → 确认激活 → 取消;单事务原子写入,失败自动回滚
  - 导入记录(ACTIVATED / RESTORED / FAILED 事件)
  - 预览显示版本、计数、大小、将受影响的进行中会话
- **诊断与更新**:导出诊断报告 JSON、检查更新、顶部「发现新版本」横幅、错误边界 + 最近错误记录
- **文章管理**:非内置文章可删除
- **首次启动下载**:检查存储 → 申请持久存储 → 按 `catalog.json` 下载 SHA 版本化语料/文章(带进度)→ 校验 → 原子激活;失败不破坏旧数据

## 视觉与平台适配

- 底部导航 5 项(首页/词汇/例句/情景/文章),SVG 图标替代字符图标
- 移除 `maximum-scale=1`,支持双指缩放与系统大字体
- 安全区(刘海/灵动岛/Home 指示条)、横竖屏适配、≥44pt 触控目标
- `manifest.webmanifest` 移除锁死竖屏,支持横屏

## PWA / 离线架构

- Service Worker 改为 `injectManifest` 自定义实现:应用壳 precache、网络优先导航 + 离线兜底页、版本化语料 CacheFirst、手动更新提示(不打断学习)
- 语料按内容 SHA-256 版本化文件名发布,根治 CDN/浏览器缓存陈旧
- **完全离线,无推送通知、无任何数据上报**;服务器只托管静态文件

## 内容(与 Android 锁定)

202 词 / 72 短语 / 353 例句 / 15 情景 / 45 练习对 / 919 音频 / 18 文章,`.besspack`(schema 3)、`.bessarticle`(schema 2)、`.bessbackup`(加密互通)格式兼容三端。

## 技术

- React 19 + Vite 6 + TypeScript + Dexie (IndexedDB) v2 schema
- `build-catalog.mjs` 生成 SHA 版本化语料 + `catalog.json`;`verify-contracts` 含内容合约(SHA 锁定)
- 测试:`vitest` — FSRS v6 金标(Android golden 全量)、例句、首页聚合、语料三阶段、备份加解密往返
- 部署:腾讯云 CVM + Nginx(全站 Basic Auth + HTTPS + 安全头),版本目录 + `current` 软链接发布/回滚
