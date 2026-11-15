# 项目与架构

当前为 Phase 1：Cloudflare Workers（原生 fetch 路由）+ Static Assets + D1 + React/Vite，单所有者、不使用 Cron。唯一功能源码在公开主仓，个人仓使用受管同步。

请求路径：`worker/index.ts` 先处理 `/healthz`，再检查 AUTH_MODE；Access 模式校验 JWT 后才调用 API 或 ASSETS。`assets.run_worker_first: true` 保证静态文件也经过鉴权。没有配置时返回 503；无效/缺失 JWT 返回 401，非所有者返回 403。demo 合成数据、拒绝写入、没有网络请求。

`server/api.ts` 负责 POST 的来源、JSON、32KiB 限制与输入白名单；`server/security.ts` 使用随机 12 字节 IV / AES-256-GCM，AAD 绑定 provider ID 和密钥种类。API 投影只显示凭据是否存在及检查元数据。

`migrations/0001_init.sql`：providers（实例、区域和刷新锁）、credentials（密文与固定检查状态）、snapshots（最新成功数据及观测时间）、meta（预览冷却）、auth_rate（为后续保留）。手动与扩展记录合并到 snapshots，不保留历史或原始输入。刷新锁放在 providers，以覆盖首次查询失败。D1 条件 UPDATE 抢占锁，每次请求最多 6 个并发请求。调用失败只改检查元数据，保留成功快照；上游 Retry-After 延长锁。

当前 API 平台为 DeepSeek、OpenRouter、Moonshot。SiliconFlow 官方已公告停用旧 `/user/info`，因此改为 cn/com 手动余额，历史 schema 仅做纯投影测试。`server/adapters/index.ts` 仅调用固定地址，经 `server/fetch-safe.ts` 限制 5 秒 / 64KiB / 禁止重定向。百分比、credits、CNY、USD 分桶；缺失字段保留 null。OpenRouter 的周期不虚构为确定重置时间。

`shared/contracts.ts` 是业务契约：过期以 observedAt 计算，扩展相对重置从页面读取时刻锚定，手动相对重置从保存时刻锚定。重置到点不修改数值。API 1h / 扩展 15m / 手动 24h。扩展摘要沿用旧 Rust 严格白名单，拒绝未知字段及早于已有快照的观测。

前端使用 YourFeed 配色变量（背景、表面、边线、琥珀、绿色），系统字体。`shared/locales/` 管理中文和英文。原生 dialog 提供焦点约束及 Escape，LocalStorage 仅保存主题和语言，不保存密钥。

测试：Vitest 网络全部模拟；Node 内置 SQLite 执行生产 SQL 的 D1 transport fake；RSA 测试现场生成临时密钥对。扩展与源码指纹 Node 测试独立运行；Chrome 本地检查响应式和交互。所有依赖锁定，类型按 Wrangler 配置生成。

Phase 2：密码登录、组织管理员账单接口、AK/SK 云账户签名接口、扩展直推及可选单定时器。没有为了 Phase 1 引入它们的可访问路径。
