# 当前状态 · Phase 1

2026-11-15，分支 `feat/cloudflare-mvp`，基准 main `2561e54`。本地实现完成，未提交、未推送、未部署，未同步个人仓。任务入口为 `/workspace/quota-20261115/TASK.md`，设计为同目录 `plan/PLAN.md` 与 `plan/ISSUE.md` 顶部决定。

已完成：Rust / Windows 原型和原前端归档；原生 Worker + React/Vite + D1；Access JWT 纵深校验与 fail-closed 静态资源；只读合成 demo；加密密钥生命周期；官方余额 API；订阅手动记录和旧扩展摘要导入；真值 / 过期 / 重置提示；D1 原子冷却、Retry-After、六并发上限；深浅色、双语、响应式卡片及键盘 dialog；个人镜像同步脚本；Node 24 CI 和部署文档。

官方文档核对发现实际范围调整：SiliconFlow 官方已于 2026-08-14 停用 `/user/info`，因此两区域当前手动录入且不接收 Key、不出站；历史字段只做纯解析契约测试。当前自动读取为 DeepSeek、OpenRouter（Key / 可选账户 Management Key 两种能力）、Moonshot cn/ai。依据和 URL 见 `docs/providers.md`。密码登录、组织账单、AK/SK、扩展直推、定时器均保留 Phase 2。

验证基线：npm ci（0 vulnerabilities）、Wrangler 类型生成 + TypeScript、104 项 Vitest、Vite + Worker dry-run、25 项扩展测试、17 项 manifest / sync 测试、工作树指纹验证和 diff 检查通过；本地 demo HTML / overview 200，Access 无 JWT 的 HTML / API / 静态资源 401，demo 写入 403。Chrome 桌面 1280×900 / 手机 390×844，筛选、双语与主题持久化、对话框、无横向溢出和无外部请求检查通过。具体结果与日志集中于 `/workspace/quota-20261115/DONE.md`。本地日志在 `../logs/`，Chrome 截图在 `../shots/`，不进入源码仓库。全部网络测试使用 mock，无真实账户 API 调用。

下一步由操作者审阅工作树，在个人配置填入 D1 ID、完整 Access 变量及主密钥 secret，配置自己的受保护域名并执行迁移 / 发布。不要对现有个人仓盲目覆盖：按 README 说明审阅后运行 sync-personal；本次没有运行该目标。主密钥必须独立安全备份，不能把旧密文直接换主密钥。

## CI 工作流待替换（2026-11-15）
盒子上的 GitHub OAuth 令牌没有 `workflow` 权限，不能推送 `.github/workflows/` 的改动。新 CI 定义放在 `docs/ci/ci.yml`；旧的 Rust/Windows 工作流 “Local prototype and offline checks” 已在 GitHub Actions 中停用（代码已移到 `legacy/`）。授予 `workflow` 权限后：把 `docs/ci/ci.yml` 移到 `.github/workflows/ci.yml`，删除旧 `windows-noauth.yml`，再重新启用 Actions 工作流。本地门禁（typecheck / 单测 / build / 扩展与 manifest 测试）已在 PR 中记录。

## 部署检查点（2026-11-15 20:20 UTC+8）
- 公开仓 PR #2 已合并（fbbe59e）；个人仓 PR #2 已合并（40c55b5），core-backup 指纹已验证。
- 个人实例已部署：https://quota.alanzhu.dev（Worker `alanpersonal-quota`，版本 de7647aa，D1 `alanpersonal-quota` 迁移 0001 已应用，`MASTER_ENCRYPTION_KEY` 已设置，无 Cron）。
- 线上验证：未登录访问 `/`、`/api/overview`、静态资源、`/healthz` 均 302 到 Cloudflare Access 登录；伪造 JWT 头同样被拦；workers.dev 404。登录后的界面和 Worker 内 JWT 校验尚未在线上验证（需 Alan 登录）。
- DeepSeek 适配器已用盒子上的真实 Key 在本地调用官方接口验证通过（只核对字段，不输出数值）；线上需 Alan 在页面里录入 Key。
- 下一步：Alan 登录验收；Phase 2（扩展一键推送、组织级 Admin API、火山/阿里 AK/SK、可选 Cron、密码登录模式）；授予 `workflow` 权限后启用 docs/ci/ci.yml。
