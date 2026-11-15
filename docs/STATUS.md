# 当前状态 · Phase 1.1

2026-11-15，分支 `feat/phase-1-1`，基准 `b94dd3952f36a2e38c0534545adfd4d156cdc852`。本轮任务入口 `/workspace/quota-20261115/p11/TASK.md`，已验证公开链接见 `fixtures/provider-links.md`。所有工作仅本地，未提交、未推送、未部署、未同步个人仓，未执行 GitHub 写入或远程 Wrangler。

已实现：catalog 官方用量 / 密钥 / 文档链接与区域指引；OpenRouter 单卡双槽位，账户余额主数值与此 Key 消费上限次行分离；0002 兼容旧密文 AAD 并使旧错误快照失效；设备配对 / hash / 撤销 / 限流与独立扩展路由；可编辑来源；MV3 教学、预设、定时后台读、状态与通知；看板横幅 / 卡片告警；zip 打包及恢复 `.github/workflows/ci.yml`，旧 Windows 工作流移除。安装与 Access bypass 说明见 `docs/extension.md`。

验证完成：`npm ci`（0 vulnerabilities）、Wrangler 类型 + TypeScript、130 项 Vitest、Vite + Worker dry-run、36 项扩展测试、Node 原生 ZIP 打包、17 项 manifest / sync 测试、`git diff --check` 全部通过；默认 source-manifest 发布约束保留，本地使用显式 `--worktree` 构建并验证指纹。真实本地 D1 0002 迁移通过。Wrangler demo 页面 / overview 200、写入 403；Access 无 JWT 页面 / API / 资源 401；扩展无令牌或只有 Access 头 401。

系统 Chrome 156 的桌面 / 手机交互、配对码关闭后隐藏、OpenRouter 指引和普通 Key 主数值、原生 DOM 预设定位及扩展 HTML 渲染通过；截图同时放在 `p11/shots/` 和 `docs/images/`。网络与浏览器 API 使用合成适配器，不访问真实账户。完整门禁结果和日志入口见 `/workspace/quota-20261115/p11/DONE.md`。版本：Node 24.22.1、npm 11.21.1、Wrangler 4.162.0；锁文件固定依赖。沿用会话默认模型与推理配置，未声称切换；工具未提供可核实的价格、额度或上下文占用统计。

下一步仅由操作者执行：审阅未提交工作树，应用迁移 0002，并仅为 `/api/ext/` 子路径设置 Access Bypass，保留其他路径保护。仍需 `AUTH_MODE=access`、完整 Access 变量、`DB`、`ASSETS` 与原加密主密钥。无需新增 secret 或 Worker Cron。本轮未提交、未推送、未创建 / 更新 PR、未部署、未验证线上或同步个人仓。

已知边界：Chrome 运行时才能读取；网站登录 / 挑战需用户处理；预设只能识别明确的小额度区块，不支持跨域 iframe / 封闭 Shadow DOM；不同来源绑定同卡片时显示最近一次成功来源快照，独立显示建议分卡。真实网站改版和登录状态未使用账户验证；截图为真实 Chrome 渲染的合成数据。


## Follow-up · TASK2 / ADDENDUM

任务入口 `/workspace/quota-20261115/p11/TASK2.md`。保留上一轮未提交成果，默认扩展弹窗现为 360px 额度摘要，缓存首屏 + 独立设备鉴权的严格投影 `GET /api/ext/summary`；实时重置倒计时、成功同步相对时间、六种状态、官方页面行链接、看板 / 同步 / 设置入口及未配对引导。原教学预览与多指标保存保留在次级视图，匹配域名页面和扩展设置均可进入。

`Alt+Q` 打开弹窗；全局 `Ctrl+Shift+9` 打开或复用 380 × 560 小窗口（同一 UI），可在 `chrome://extensions/shortcuts` 修改。Chrome 必须运行，可未聚焦；小窗口不置顶，托盘 companion 留在 Phase 2 / Issue #1。全局默认间隔 60 分钟（15–10080），在 D1 meta 保存，经既有 config 协议供两端设置编辑；新来源继承默认，旧来源保留单独间隔，无新增迁移。

新增接口鉴权 / 隔离 / 投影 / 限流 / 状态 / 间隔测试，保留旧测试；最新为 135 项 Vitest、39 项扩展测试和 17 项 manifest 测试全部通过。其余安装、类型、构建、扩展 ZIP、diff、真实本地 Wrangler smoke 与 Chrome 交互门禁通过；日志为 `p11/logs/followup-*`。真实系统 Chrome 渲染的合成截图：`docs/images/island-popup.png`、`docs/images/island-mini-window.png`，任务目录 `p11/shots/` 同步保存。完整 Follow-up 记录见 `/workspace/quota-20261115/p11/DONE.md`。

HEAD 仍为上述基准；全部工作仅在本地，未提交 / 推送 / 发布 / GitHub 写入 / 远程 Wrangler。下一步仍是审阅工作树及 `dist/ai-quota-sync-extension.zip`；发布前操作者按既有说明配置迁移 0002 与精确 `/api/ext/` Access Bypass。本次未验证真实登录网站、OS 快捷键分配或线上行为。
