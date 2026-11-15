# 当前状态 · Phase 1.1 已发布，验收未通过

2026-11-15（Asia/Taipei）Alan 实测扩展 v1.1.0 后认为「功能上比较失败」：弹窗被裁切、配对步骤不明、除 DeepSeek 外余额未同步（OpenRouter 官方页当时为 $9.89，GLM 财务总览当时为 81.94 元，Gemini 未正常显示）、教学无法添加剩余额度、文档难懂。他期望在官方额度页点扩展即可「一键获取」，并按账户（例如两个 Google 账号）分列。

**不要在本阶段直接改产品代码以外的随手修补；按下列 issue 实施。** 公开仓改完后必须用 `scripts/sync-personal.mjs` 同步 [`alanpersonal-quota-dashboard`](https://github.com/alanxiaofeifei/alanpersonal-quota-dashboard)，再部署 Worker `alanpersonal-quota` 到 https://quota.alanzhu.dev。Access 仍保护整站，仅 `/api/ext/*` Bypass。不要打印密钥或配对码。

## 验收 issue

- 总单：[Issue #13](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/13)
- [#5](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/5) 弹窗尺寸
- [#6](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/6) 配对引导
- [#7](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/7) OpenRouter / GLM / Gemini 同步失败
- [#8](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/8) 重做教学
- [#9](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/9) 一键获取当前页 + 一键同步全部 + 预设
- [#10](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/10) 多账户
- [#11](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/11) 中文图文教程
- [#12](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/12) Phase 2 Windows 托盘伴侣（从 [#1](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/1) 拆出）

跨项目交接索引：[project-overview#5](https://github.com/alanxiaofeifei/project-overview/issues/5)

---

# 当前状态 · Phase 1.1（已发布）

2026-11-15 · `main` = PR #3 合并提交 `d52dca2`，CI 通过（Worker and extension checks）。

## 已发布
- 官方用量 / 密钥 / 文档链接已逐家核实（`fixtures/provider-links.md`），GLM 改为财务总览页。
- OpenRouter：账户余额（Management Key，`/credits`）为主数值；普通 Key 的消费上限为次行并明确标注。迁移 `0002_sync.sql` 使旧 OpenRouter 快照失效，凭据仍可用原主密钥解密。
- MV3 扩展 AI Quota Sync v1.1.0：设备配对、后台定时读取官方页面、教学模式、可编辑来源链接、失效提醒（过期 / 离线 / 需登录 / 页面改版 / 读取失败）。
- 灵动岛弹窗：`Alt+Q` 打开；全局 `Ctrl+Shift+9` 打开 380×560 小窗口（Chrome 运行时有效、不置顶）；`chrome://extensions/shortcuts` 可改。
- 全局默认刷新间隔 60 分钟（15–10080），来源可单独覆盖。
- `GET /api/ext/summary`：仅设备 Token 鉴权，严格字段投影，不含任何凭据。
- 扩展下载：[Release v1.1.0](https://github.com/alanxiaofeifei/ai-quota-dashboard/releases/tag/v1.1.0)（`ai-quota-sync-extension.zip`，SHA-256 `40c2be7e60afba8a93b07a4371ce99fefe67fd083848f02d4b6b9092f380371b`）；CI 每次也上传同名 artifact。

## 部署要求（自建者）
应用 `0002_sync.sql`；保留原 `MASTER_ENCRYPTION_KEY`；Cloudflare Access 仅对 `<域名>/api/ext` 及子路径设置 Bypass，其余路径（HTML、静态资源、普通 `/api/*`）保持登录保护。

## 已知边界
浏览器必须运行，各官方网站需保持登录（页面无需打开）；页面改版需重新教学；不支持跨域 iframe / 封闭 Shadow DOM；小窗口不置顶。

## 下一步（已被上方验收 issue 取代）
- 先按 Issue #13 的顺序修复扩展验收问题，再做 Phase 2 托盘（Issue #12，不再只指向 Issue #1）。
