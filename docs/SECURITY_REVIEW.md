# ios-pwa 安全与稳定性审查报告

**项目**：bess-sales-trainer-ios-pwa v0.3.0（React 19 + Vite 6 + vite-plugin-pwa，离线 PWA）
**审查日期**：2026-08-06
**审查范围**：稳定性 + 安全漏洞，覆盖源码（src/）、依赖（npm audit）、构建链（scripts/）、Service Worker、加密与备份恢复。

---

## 一、总体评价

应用层安全设计 **扎实**：WebCrypto AES-GCM-256 + PBKDF2 600k 迭代、SHA-256 全链路完整性校验、原子事务回滚、React 默认转义防 XSS。主要问题集中在 **依赖漏洞（多为 dev-only）**、**构建链在 Windows 上的脆弱性**，以及 **下载/解压缺少资源上限保护**。

| 类别 | 严重度 | 数量 |
|------|--------|------|
| 阻断性构建问题 | 高 | 1 |
| 依赖漏洞（critical/high） | 高 | 4 |
| 依赖漏洞（moderate） | 中 | 3 |
| 应用层稳定性隐患 | 中 | 3 |
| 应用层安全建议 | 低 | 3 |

测试：vitest **8/8 通过**（fsrs / corpus-import / backup）。

---

## 二、阻断性问题（必须修）

### B1. 生产构建在 Windows 上失败
- **现象**：`npm run build` → `tsc --noEmit` 通过，`vite build` 报错退出：
  `Error: EPERM: operation not permitted, rename 'dist\sw.mjs' -> 'dist\sw.js'`
- **根因**：`vite.config.ts` 设 `emptyOutDir: false`（注释称沙箱 trash 层导致），旧 `dist/sw.js` 被锁，vite-plugin-pwa 无法重命名覆盖。
- **影响**：CI/本地构建不稳定，无法产出可部署产物。
- **建议**：构建前删除 `dist/sw.js` 与 `dist/sw.mjs`，或改用 `emptyOutDir: true` 并妥善处理沙箱 trash。

### B2. catalog.json 在 Windows 文件锁下可能过期
- **现象**：`scripts/build-catalog.mjs` 捕获 `EPERM` 后仅打印 WARN，保留旧 catalog.json。
- **风险**：若 bundled 包已更新但 catalog.json 写入失败，catalog 会指向**旧 SHA**，首启下载校验仍通过（旧文件还在），但用户拿不到新内容且无报错——静默过期。
- **建议**：写入失败应判定为构建错误（exit 1），而非降级为 WARN。

---

## 三、依赖漏洞（npm audit：1 critical / 3 high / 3 moderate）

| 包 | 严重度 | CVE | 范围 | 当前 | 生产影响 |
|----|--------|-----|------|------|----------|
| **vitest** | 🔴 Critical (CVSS 9.8) | GHSA-5xrq-8626-4rwp | <3.2.6 | ^2.1.8 | 无（dev-only）。UI 服务器开启时可任意读/执行文件。 |
| **react-router-dom** | 🟠 High | GHSA-qwww-vcr4-c8h2 | 7.12.0–<8.3.0 | ^7.1.1 | **实际不可利用**：本应用纯客户端 SPA，未用 RSC/data actions/mutations。 |
| **vite** | 🟠 High | GHSA-fx2h-pf6j-xcff | <=6.4.2 | ^6.0.6 | 无（dev server only）。`server.fs.deny` Windows 绕过。 |
| vite | 🟡 Moderate | GHSA-4w7w-66w2-5vf9 / GHSA-v6wh-96g9-6wx3 | <=6.4.2 | ^6.0.6 | 无（dev only）。path traversal `.map`、launch-editor NTLMv2 泄露。 |
| esbuild | 🟡 Moderate | GHSA-67mh-4wv8-2f99 | <=0.24.2 | (间接) | 无（dev only）。dev server CORS。 |

**结论**：所有 critical/high 漏洞均属 **dev 依赖或不可利用路径**，生产运行时无直接暴露。但应升级以消除供应链风险：
- `vitest` → 4.x（breaking，仅测试）
- `react-router-dom` → 8.3+（`npm audit fix` 可自动）
- `vite` → 最新 6.x patch

---

## 四、应用层安全审查

### ✅ 做得好的部分
1. **加密（`src/data/Crypto.ts`）**：WebCrypto `crypto.subtle`、AES-GCM-256、PBKDF2 **600,000 迭代**（符合 OWASP 2023 推荐）、16B salt、12B nonce、AAD 绑定备份头防篡改。`crypto.getRandomValues` 用于 salt/nonce。无自研密码学。
2. **包校验（`src/data/PackageValidator.ts`）**：`checksums.sha256` 逐文件校验 + manifest hash/size 双重比对 + counts 一致性 + ID 唯一性 + 引用完整性（orphan turn/pair、audio 路径缺失、turn→scenario、pair→scenario）。防御严密。
3. **原子事务**：语料/文章激活、备份恢复均用 Dexie `transaction('rw', ...)`，失败整体回滚，旧数据不受损。
4. **XSS 防护**：React 默认转义；ErrorBoundary 错误信息经 `{this.state.error}` 渲染，无 `dangerouslySetInnerHTML`。
5. **外链安全**：`<a target="_blank" rel="noreferrer">`（防反向 tabnabbing）；`noindex,nofollow`。
6. **设置白名单**：`SettingsRepositoryImpl.save` 对 `playbackSpeed` 做白名单校验、`dailyNewWordTarget` 做 1–50 clamp。
7. **下载二次校验**：`activateDownloaded` 先 SHA-256 验下载体，再 `validateCorpusPackage` 重解压重校验（纵深防御）。

### ⚠️ 隐患与建议

#### S1. 下载无超时 / 无大小上限（中）
- **位置**：`src/data/CorpusDownloader.ts` `download()` 的 `while(true) { reader.read() }`。
- **问题**：无 `AbortController` + 超时；网络挂起时首启永久卡住，无中止路径。`received` 累计无上限，恶意 catalog 声明小 `sizeBytes` 但服务器吐大量数据可致 OOM。
- **建议**：加 `AbortSignal.timeout(60_000)`；当 `received > entry.sizeBytes * 1.2` 时中止并抛错。

#### S2. Zip bomb 风险（低-中）
- **位置**：`src/data/Zip.ts` `unzipToMap`（fflate `unzipSync` 全量解压进内存）。
- **问题**：用户**主动导入**的 `.besspack`/`.bessarticle`（`inspectPackage(file)`）无解压总大小/条目数上限；恶意高压缩比 zip 可 OOM 浏览器。catalog 下载路径因有 SHA 预校验相对安全。
- **建议**：解压前按 `entry.compressedSize` 估算，或解压后校验 `totalBytes < 200MB`、`entries < 5000`。

#### S3. 备份恢复无 schema 校验（低）
- **位置**：`src/data/LearningBackupRepositoryImpl.ts` `restoreBackup` → `bulkPut(p.wordMemoryStates as never[])`。
- **问题**：未受信备份 JSON 直接 `as never[]` 写库，可注入任意字段/值；`dueAtEpochMs` 的字符串替换 hack（`JVM_LONG_MAX_TEXT`）脆弱。
- **影响**：仅限本地学习库数据完整性（无提权、无外传），但用户导入他人 `.bessbackup` 可污染数据。
- **建议**：恢复前按行做字段白名单 + 类型校验。

#### S4. 无 Content-Security-Policy（低，建议加）
- **位置**：`index.html`。
- **问题**：无 CSP meta/头。应用不加载外部资源、无内联脚本，加严格 CSP 成本极低、收益高（防未来 XSS 兜底）。
- **建议**：`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src blob:; img-src 'self' data:; connect-src 'self'">`。

#### S5. SW 自动 skipWaiting（可接受，记录）
- `sw.ts` install 时 `skipWaiting()` + `update.ts` `onNeedRefresh` 立即 `updateSW(true)` → 静默自动更新。学习数据在 IndexedDB 跨重载保留。设计自洽，但用户无回退入口；若新版本有 bug，用户无法停留在旧版。属于产品取舍，非漏洞。

---

## 五、稳定性杂项

- **prepare-assets WARN**：`.prepared.json` 写入被锁仅 WARN，非阻断（资产已就位）。
- **内存峰值**：`download()` 先攒 chunks 再合并到单一 `Uint8Array`，峰值约 2× 包大小（40MB→80MB）。iOS 低内存设备偏紧但可接受；可改用流式写入 OPFS/Blob。
- **Dexie v1→v2 升级**：`itemMemory.isFavorite` 默认 0 的 `modify` 迁移正确。
- **AudioPlayback**：object URL 在切换/stop 时 `revokeObjectURL`，无泄漏。

---

## 六、优先级建议

| 优先级 | 项 | 工作量 |
|--------|----|--------|
| P0 | B1 修构建（清 dist/sw.*） | 小 |
| P0 | B2 catalog.json 写入失败应报错 | 小 |
| P1 | S1 下载加超时 + 大小上限 | 小 |
| P1 | 升级 vitest/react-router-dom/vite | 中（测试回归） |
| P2 | S2 unzip 加大小/条目上限 | 小 |
| P2 | S4 加 CSP meta | 小 |
| P3 | S3 备份恢复 schema 校验 | 中 |
