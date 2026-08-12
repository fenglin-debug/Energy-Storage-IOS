# 浏览器集成验收清单(ACCEPTANCE)

在发布到腾讯云后,用桌面浏览器与 iPhone Safari 按本清单逐项验收。
标记:✅ 通过 / ❌ 失败 / ⚠️ 已知限制。

## A. 首次访问与安装

- [ ] 访问 `https://<域名>` 弹出 Basic Auth,输入共享账号密码后进入应用
- [ ] 首次启动显示下载进度(语料约 40MB + 文章约 34MB),完成后进入首页
- [ ] Safari 点「分享 → 添加到主屏幕」,图标与名称正确,独立窗口打开(无浏览器地址栏)
- [ ] 重新打开应用不再下载(已激活,离线可用)

## B. IndexedDB 与本地数据

- [ ] 学习一条词汇后,DevTools → Application → IndexedDB 中 `BessSalesTrainer` 出现 `wordMemory`/`reviewLogs` 记录
- [ ] 删除站点数据后重新安装,数据清空(预期行为,需先备份)
- [ ] 存储估计正常:`设置 → 关于` 显示存储占用
- [ ] 例句收藏写入 `itemMemory`(itemType=EXAMPLE)

## C. Service Worker 与离线

- [ ] DevTools → Application → Service Workers 显示 `sw.js` 已激活(版本与构建一致)
- [ ] 断网后刷新页面,应用正常加载(命中 precache/缓存)
- [ ] 断网时访问深层路由(如 `/sentences`)仍可用(SPA 回退)
- [ ] 完全离线时打开未访问过的页面,显示 `offline.html` 而非空白
- [ ] 发布新版本后,打开应用出现「发现新版本」横幅;点击「立即更新」后应用更新且学习进度不丢

## D. 语料与内容合约

- [ ] `https://<域名>/content/catalog.json` 返回 catalog,`corpus-<sha12>.besspack` 可下载且 SHA 与本地构建一致
- [ ] 首页显示语料版本号与构建一致
- [ ] 词汇 202 / 短语 72 / 例句 353 / 场景 15 / 文章 18 条数与 Android 一致
- [ ] 音频播放正常(词汇/例句/情景/文章),倍速 0.85/1.0/1.15 生效

## E. 导入、回滚与备份

- [ ] 设置页导入 `.besspack` 出现预览卡片(计数/大小/影响会话),确认后激活
- [ ] 取消预览不产生任何变化;「导入记录」出现对应事件
- [ ] 导入损坏文件被拒绝,旧语料与学习进度保留
- [ ] 导出 `.bessbackup`(带密码),清空数据后导入恢复,记忆进度一致
- [ ] Android 端导出的 `.bessbackup` 可在 PWA 导入(PWA → Android 反向亦然)

## F. 错误恢复

- [ ] 断网状态下首次启动(无缓存语料)显示启动失败 + 重试按钮
- [ ] 存储空间不足时下载失败可重试,不破坏已有数据
- [ ] 首页/设置页出现异常时 ErrorBoundary 显示错误与「重新加载」

## G. 安全头(curl 验证)

```bash
curl -skI -u user:pass https://<域名>/ | grep -Ei 'strict-transport|csp|x-content-type|permissions-policy'
```

- [ ] 存在 HSTS、CSP、`X-Content-Type-Options: nosniff`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [ ] HTTP 访问 301 跳转 HTTPS
- [ ] 无凭据访问返回 401
