# AI Quota Sync v1.2 · 协议与边界

安装、配对、添加来源、一键获取、全部同步、多账户及故障排除请看 **[中文图文教程](extension-guide.zh.md)**。主路径使用内置预设，教学只作为后备。界面使用真实 MV3 扩展截图，网络、权限和页面结果适配器均为合成；真实已登录页面仍待 Alan 验收。

## 读取与调度

工具栏弹窗约 400 × 600，内部滚动；独立窗口默认 440 × 640，复用同布局、可调整大小。Alt+Q 打开摘要，Ctrl+Shift+9 打开 / 复用窗口，可在 `chrome://extensions/shortcuts` 改键。Chrome 必须运行，窗口不置顶。Windows 托盘仅有 [设计计划](tray-plan.md)。

来源包括官方 URL、parser、账户标签、启用状态、读取间隔、可选教学定位器。预设在 `browser-extension/presets.mjs` 统一定义 URL 模式、指标 ID 和单位；Worker ingest 使用同一表校验。支持 ChatGPT、Codex、Claude、AI Studio、GLM 余额 / Coding Plan、OpenRouter、DeepSeek、Moonshot 国内 / 国际、xAI、火山引擎、阿里云 / 百炼、SiliconFlow 国内 / 国际。Gemini / Grok 聊天应用不是可读余额页；缺少数字时返回 no_data，不生成 0 或 100%。

首次使用在扩展设置点「授权并启用此网站」，或在当前页获取时授权。默认来源启用，但没有 host permission 时无法读页，明确返回 permission_required。定时读取默认 60 分钟，可设 15–10080 分钟，每个来源可以继承全局或独立覆盖。Chrome alarms 只在浏览器运行时生效；每站登录一次且会话有效即可。后台读取复用匹配地址的现有标签页，否则创建临时后台页并在 finally 清理；不导航、不关闭用户的现有页。加载与等待 DOM 各最多 20 秒。失败投影进入重试队列，不保存上游原文。

当前页路径：识别预设 / 已保存来源 → 没有来源时填写标签并添加 → 申请该 origin 的权限 → 核对来源与账户 → 立即读取当前标签页 → ingest → 更新摘要和行内结果。非官方页面不自动创建来源。存在多个同 URL 来源时要求明确选来源，后台服务也拒绝没有选择的歧义读取；全部同步发现不同卡片共享同一页面地址时，不读页、不上传数值，报告 account_mismatch。「全部同步」以最多三页并发读取所有已启用来源，本机进度映射串行保存以免账户结果互相覆盖，进度保存在本机并实时显示，每行显示账户及成功 / 失败原因。

仅读取小型可见标签与其附近的数值。预设使用已知标签的精确匹配及局部文本模式，不读取 body.innerText、整页正文、Cookie、Session、页面存储、请求拦截或未公开 API。目标不存在、隐藏、重复、有歧义或单位不符时失败。教学定位优先可见标签、aria、稳定属性；不创建 React `_r_` ID 或 nth-of-type 链。旧教学配置保留并可重新配对恢复；旧动态路径无可用标签时须重新教学。不支持跨域 iframe、封闭 Shadow DOM 和不可见懒加载内容。

## 多账户与快照

每个账户独立 provider 卡片；`providers.config_json.accountLabel` 保存用户输入标签（旧行默认「默认账户」），`usageUrl` 保存账户对应的官方页地址。每个来源也保存 accountLabel，成功快照在 facts 中保留观测时的标签。同一卡片的来源共享标签；来源编辑器改名会一起更新它们，普通所有者 API 也支持编辑账户标签。不自动读取 / 存储邮箱。

Google `authuser=N` 与 `/u/N/` 是匹配依据；相同账户的两种 URL 写法可复用，跨账户不匹配。注入读页函数会再次核对地址，防止导航过程中串写。浏览器增删登录账户后序号可能变，用户必须核对。其他站点同 URL 的不同账户不能自动分辨，需使用独立 Chrome 配置文件或禁用自动读取、逐账户手动获取；UI 明示需核对账户。

迁移 **0003_extension_accounts.sql** 加法创建 `extension_snapshots`，保存 API 类卡片的页面后备快照；不改动原 provider、credentials 或 snapshots 表结构，回退旧 Worker 不会删除新记录。标签存于已有 JSON 字段，旧 Worker 可忽略新增字段。旧行无需改密钥或重新加密。应用 0001、0002 后再应用 0003；本轮没有执行远程迁移。

官方 API 快照与页面后备分开保存。API 主值有效时优先 API，否则使用成功的页面值，并保留单 Key 预算等次级指标；页面不能把 API 账户余额改成单 Key 上限。页面失败保留最后成功值及观测时间。手动 / 订阅卡片沿用每卡片最后成功的一组指标；ChatGPT 与 Codex 等独立来源如需同时保留独立指标组，请建立两张卡片并分别绑定来源。

升级时仅将“空 locators 的 taught 来源”且地址匹配官方预设的记录补成启用的预设；旧 Gemini 应用地址会指向 AI Studio 并保留账户序号。已有教学和显式关闭的预设均保留。迁移后的来源仍需用户授予 host permission。

## 自托管与设备鉴权

沿用 `DB`、`ASSETS`、`MASTER_ENCRYPTION_KEY`、`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`、`OWNER_EMAIL`，没有新 secret、Worker Cron 或网络端点。

Cloudflare Access 只为 `<域名>/api/ext/*` 配置 Bypass，其余 HTML、静态资源和普通 `/api/*` 保持保护。`AUTH_MODE=access` 且所有 Access 配置完整才开放扩展入口；demo 不允许配对或设备写入。设备码只创建时返回一次，D1 只存随机设备令牌的 SHA-256 哈希；令牌只保存在 chrome.storage.local，不同步。撤销后立即失效。

扩展接口：`POST /api/ext/hello`、`GET /api/ext/config`、`GET /api/ext/summary`、`POST /api/ext/config`、`POST /api/ext/ingest`、`POST /api/ext/heartbeat`（`/status` 同义）。每次设备 Bearer 鉴权；设备每分钟最多 120 请求；JSON 最多 32 KiB。CORS 仅合法 chrome-extension origin，无 credentials；请求 omit 浏览器凭证、redirect:error。设备令牌不能访问普通 API，Access JWT 不能替代设备令牌。

`POST config` 继续支持 `{sources,defaultIntervalMinutes}`，另支持 `{addPage:{url,accountLabel}}` 创建已知官方页来源及所需卡片，不允许传供应商密钥。卡片账户改名使用所有者 `POST /api/providers/:id/account`。没有新增顶层源码路径，source-manifest 原有白名单覆盖本次文件；发布模式仍需干净工作树，本地未提交验证必须显式 `--worktree`。

Summary 仅投影 `id/name/providerType/accountLabel/usageUrl/primary {value,unit}/reset_at/last_sync_at/status/source/reason`，不返回凭据、设备记录或定位器；只读已保存快照，不请求供应商。reason 包括 permission_required、login_required、layout_changed、timeout、no_data、account_mismatch、disabled、not_synced、management_key_required、network。OpenRouter 没有主余额时始终说明 Management Key 要求及页面后备路径。

Ingest 顶层仍仅接受 `sourceId/providerId/items/observed_at/status`；item 仅 `id/amount/unit/resetAt`。拒绝未知字段、来源不匹配、未启用、未许可的指标 / 单位、未来或倒序观测；失败 items 必须为空。账户由来源绑定，设备不能在 ingest 任意指定另一账户标签。错误原因和最后成功时间独立保存，预计重置到时只提示重新确认。

## 本地验证

`npm ci`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:extension`、`npm run test:manifest`、`git diff --check`；打包另运行 `npm run build:extension`。`node scripts/smoke-extension-v12.mjs /workspace/quota-20261115/p12/shots` 加载真实扩展、新 Chrome 配置并运行合成浏览器检查，截图同步到 `docs/images/guide/`。不使用个人会话或真实密钥，所有上游页为拦截夹具。

## English

v1.2 prioritizes built-in official-page presets, Get current page and Sync all with per-account progress. Pair from the dashboard's `?pair=1` dialog, grant each site's optional permission, then read. Labels are user-entered; Google account indices are bound to URLs, not verified identities. Teaching remains a fallback with parsed value/unit preview and stable label/attribute locators. Apply additive migration 0003 after 0001/0002. API account values take priority; browser snapshots supply a fallback without replacing API key budgets. Device-only auth and the exact `/api/ext/*` Access boundary remain unchanged. Tests/screenshots use synthetic adapters; logged-in acceptance is still required.
