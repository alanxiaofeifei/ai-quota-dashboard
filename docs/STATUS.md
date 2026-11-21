# 当前检查点 · v1.2 本地实现，待授权 GitHub 交付

2026-11-21（Asia/Bangkok）。入口：[总单 #13](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/13)，修复范围 #5–#11；[#12](https://github.com/alanxiaofeifei/ai-quota-dashboard/issues/12) 仅 [托盘设计](tray-plan.md)。分支 `feat/v1-2-extension-ux`，起点 / 当前已提交 HEAD `0aae092c7daca8b245f072e62e0492237aa48493`。本轮代码、测试与文档均为**未提交工作树**。

当前会话用户给出的规则要求仅本地、不提交 / 推送 / GitHub 写入，而 p12 任务要求提交、推送并开 PR。已在开工时请求澄清，未收到覆盖本地限制的答复，因此暂不执行这些写操作。没有同步个人仓、合并、远程 Wrangler、D1 远程写入、部署或 Release；不把本地验证说成线上已通过。

## 已完成

- #5：400 × 600 工具栏弹窗、内部滚动、按钮不竖排；440 × 640 可调尺寸独立窗口，复用同布局与快捷键。
- #6：未配对 / 设置页三步说明、配对码密码提醒、已连接主机名；`?pair=1` 自动打开看板原生配对 dialog，Esc / 焦点仍由 dialog 管理。
- #7/#9：统一官方页面预设表、默认启用、逐站授权按钮；识别当前页并添加来源 / 卡片，一键读取并显示账户 / 单位结果；全部同步显示逐来源进度。OpenRouter 页面 USD 余额作为 API 缺失后备，可用 API 主余额优先，普通 Key 预算不当账户余额。明确区分需授权、需登录、页面改版、无数字、超时、未启用等原因。
- #8：教学后备向导、数值 / 单位预览、默认剩余额度、保存后同步；优先标签 / aria / 稳定属性，不新建 React `_r_` ID 或 nth 链；兼容保存的旧定位器，失效时重新教学。
- #10：每账户独立卡片、可编辑标签，来源与快照保存标签，Google URL 序号绑定与读取时复核；摘要和看板按服务商 → 账户排序。迁移 `0003_extension_accounts.sql` 加法保存 API 类页面后备，不改凭据与旧表结构。
- #11：[中文图文教程](extension-guide.zh.md)、README / 扩展帮助链接、协议 / 服务商说明，真实加载 MV3 扩展的 Chrome 合成截图位于 `docs/images/guide/`，副本 `/workspace/quota-20261115/p12/shots/`。
- 扩展版本 1.2.0；ZIP 打包纳入新 presets 模块。AGENTS 入口改为 GitHub issues / PRs 并指向本检查点。

## 验证基线

Node 24.22.1、npm 11.21.1；锁文件依赖未升级，Wrangler 4.162.0、Chrome 156.0.8078.47。

已通过：`npm ci`（0 vulnerabilities）、`npm run typecheck`、`npm test`（143）、`npm run build`（Vite + Worker dry run）、`npm run test:extension`（43）、`npm run test:manifest`（17）、`npm run build:extension`、`git diff --check`。最终执行日志与门禁结果记录在 `/workspace/quota-20261115/p12/DONE.md`。Worker 配置未修改，types 随 typecheck 生成且忽略。

`node scripts/smoke-extension-v12.mjs /workspace/quota-20261115/p12/shots` 已验证真实扩展加载、当前页 runtime 链路、逐行同步、原生 Chrome 125% 缩放、双账户、教学保存、未配对三步和 `?pair=1` 原生 dialog，以及局部 DOM 的隐私读取界限。看板传输、权限和页面执行适配器模拟；来源标签页均为网络拦截夹具。早期浏览器试跑曾因未预置全部后台标签页触发外部加载尝试，未使用真实账号；最终脚本预先拦截所有来源页。截图并不证明真实供应商页面已适配成功。

source-manifest 本地验证显式使用 `--worktree`，默认发布模式继续拒绝脏工作树。没有新增顶层源码目录，原白名单已覆盖。既有 Access / 设备令牌隔离、失败保留快照与非法单位回归测试均保留。

## 待 Alan / 集成者验收

1. 明确是否允许本轮提交、推送并开单一 PR（不合并）；准备好的标题与正文保存在 `/workspace/quota-20261115/p12/PR_BODY.md`，完成记录在同目录 DONE.md。
2. 在独立个人仓同步并先应用 0003，再部署；保持原主密钥，Access 仍仅 `/api/ext/*` Bypass。此步骤不在当前会话授权范围。
3. 真实登录页验证 OpenRouter、GLM、Coding Plan、ChatGPT/Codex、Claude、AI Studio、DeepSeek、Kimi、xAI、火山、阿里云 / 百炼及 SiliconFlow 标签与布局。合成夹具只验证明确标签 / 数值契约。
4. 核对两个 Google 账户的 URL 序号、标签及实际登录账号；增删账号可能改变序号。其他平台共享相同 URL 的不同账户必须使用独立 Chrome 配置文件，或禁用自动读取、逐账户手动获取。扩展不读取身份信息，不能凭标签证明登录身份。
5. 订阅卡片保留最后成功的一组来源指标；ChatGPT / Codex 若需分别长期保留，建立两张卡片并各绑定来源。预计重置到达仍需重新确认。

## 模型与上下文记录

任务指定的 Phase 1.1 已验证基线是 Codex CLI gpt-6.1-sol / reasoning high（并说明 agy 当日 Google 浏览器验证不可用）。本会话没有工具可核实精确模型 / 档位、上下文占用、费用或额度，没有切换模型，也不将历史基线冒称本轮实际配置。以本仓门禁及合成浏览器检查作为本轮证据。未使用子 Agent。未声称已执行原生压缩。

下一步：先读取 `/workspace/quota-20261115/p12/DONE.md` 并核对工作树；若取得 GitHub 写入授权，再按逻辑提交、推送当前分支并创建单一 PR，保持不合并 / 不发布。
