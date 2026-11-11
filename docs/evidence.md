# 阶段 0 证据登记

核查日期：**2026-11-11（Asia/Taipei）**。

“文档已核查”和“源码已核查”只说明公开材料确实描述了该能力，不表示本项目已经连接真实账户。此仓库当前没有任何通过阶段 0 的自动数据源。测试夹具是合成数据，不能作为套餐、认证或平台政策的验证证据。

## OpenAI

| 结论 | 证据与级别 | 尚待验证 |
| --- | --- | --- |
| App Server 公布了 `account/rateLimits/read` 和相关更新通知，stdio 是可用传输 | [官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)，文档已核查 | 所选官方 Windows 发行版的实际行为、可用字段、限频 |
| 多桶响应与兼容单桶响应不能重复计数；窗口、重置和 credits 可缺失 | [固定提交的账户协议类型](https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/app-server-protocol/src/protocol/v2/account.rs)，源码已核查 | 真实套餐的桶、字段精度及缺失值 |
| 额度接口要求 Codex 后端认证，API-key-only 不足；空快照不等于零 | [固定提交的账户处理代码](https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/app-server/src/request_processors/account_processor.rs)，源码已核查 | 真实过期登录及错误分类 |
| 现有本地／开源应用可继续使用 App Server authentication；商业或托管服务不在许可范围 | [官方文档 Auth endpoints](https://learn.chatgpt.com/docs/app-server)，文档已核查 | **新建本地只读看板的认证适用性尚未确认**，不能把开源代码许可当作认证许可 |
| `account/read` 的 `refreshToken:false` 不强制刷新，但后续调用和官方进程仍可能维护认证状态 | [官方认证说明](https://learn.chatgpt.com/docs/app-server)，文档已核查 | 本地文件写入、凭据存储隔离、自动刷新、插件及其他启动副作用 |
| 命名配置 profile 与运行目录不是同一个概念；官方可从多层配置加载行为 | [官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)，文档已核查 | Windows 的实际配置、系统策略、密钥链命名空间是否隔离 |
| App Server 启动会初始化本地状态及插件启动工作，RPC 白名单不能约束全部进程行为 | [固定提交的 App Server 启动实现](https://github.com/openai/codex/blob/87b7bdbf2efb9cb6fb15d821ef535061012c0138/codex-rs/app-server/src/lib.rs)，源码审查 | 未选择并放行具体官方构建；当前真实探测关闭 |
| Codex 额度不能覆盖所有 ChatGPT 消费额度；12 月共享 allowance 是未来公告 | [使用限制公告](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits)，文档已核查 | 用户当前套餐及账户是否已经启用任何新规则 |

本项目不实现 Sign in with ChatGPT 推理，也不假定其具备完整额度读取接口。订阅加购 credits、重置权益、API 余额和美元费用分别处理。

## xAI

| 结论 | 证据与级别 | 本项目状态 |
| --- | --- | --- |
| Grok 官方使用页面展示用量与重置信息 | [Grok FAQ](https://docs.x.ai/grok/faq)，文档已核查 | 真实页面与套餐待验证；未实现采集 |
| 新 X Subscription 有合资格跨产品共享周池；旧 Grok Bot 与 Cursor 计量需要区分 | [共享额度说明](https://docs.x.ai/x-subscription/usage-limits)、[Bot 套餐说明](https://docs.x.ai/x-subscription/grok-bot)，文档已核查 | 不推定同邮箱即共享，不修改或迁移用户套餐 |
| 社区曾因接口字段变化显示假零；免费重置倒计时没有可靠服务端依据 | [grok-usage-watch 变更记录](https://github.com/JoshuaWang2211/grok-usage-watch/blob/ebff9c76749603280181c25a92575c88ffd75768/CHANGELOG.md)，源码材料已核查 | 仅作为错误用例参考；未调用该接口 |
| 自动访问和抓取有政策限制 | [AUP](https://x.ai/legal/acceptable-use-policy)、[订阅条款](https://x.ai/legal/x-subscription-terms-of-service)，公开条款已核查 | 非公开适配器不进入当前实现；用户页面读取也不能称作官方 API |

## Google

| 结论 | 证据与级别 | 本项目状态 |
| --- | --- | --- |
| Gemini App 有五小时与周限制，使用页在 Settings → Usage Limits | [官方 Gemini Apps 限额](https://support.google.com/gemini/answer/16275805?hl=en)，文档已核查 | 真实账户字段与 DOM 可解析性待验证；未实现采集 |
| Antigravity 的模型组与套餐有不同窗口，不能把所有计划生成相同窗口 | [套餐说明](https://antigravity.google/docs/plans/)、[`/usage` 说明](https://antigravity.google/docs/cli/commands/usage/)，文档已核查 | 与 Gemini App、Google AI credits 分开 |
| 官方 CLI v1.1.11 起支持 `-p "/usage" --output-format json` 等只读报告，无需启动 agent turn | [官方 CLI changelog](https://antigravity.google/docs/changelog?tab=cli)，文档已核查 | 未运行；版本、身份、启动副作用和字段均待验证 |
| 第三方软件访问受到明确限制 | [Antigravity 条款第 6 条](https://antigravity.google/terms/)，公开条款已核查 | 官方命令本身是公开功能，第三方定时封装的适用性未确认；不复用 OAuth 或内部 RPC |
| 旧 Gemini CLI 消费者登录服务已停止，不能冒充 Gemini App 当前订阅额度 | [Google 弃用说明](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)，文档已核查 | 不实现旧消费者 OAuth 适配器 |

## 复用与许可证

本仓库的验证器是独立实现，不捆绑其他看板、Codex、Antigravity、浏览器扩展或官方客户端。公开文档和协议只用于确定边界和测试场景。

既有项目的 MIT 许可证已在前期研究中读取正文：[CodexBar](https://github.com/steipete/CodexBar/blob/7447bc77c2497323d9c41e40164ce705533493c8/LICENSE)、[subscription-monitor](https://github.com/Suppressor72/subscription-monitor/blob/862e15be714ddff0852163c15c06e8c17c175094/LICENSE)、[ai-usage-dashboard](https://github.com/neyham/ai-usage-dashboard/blob/0349801444ce99f0a185c66dbf1aa450fc43b258/LICENSE)。这不等于第三方依赖、品牌、字体和发行资产均已完成许可审计。后续若复制实现或夹具，必须逐文件记录来源、版本、许可和修改。

## 更新证据的规则

每次真实验证应在本地单独登记：核查日期、操作系统、官方客户端版本、套餐类别、批准范围、官方界面对照、失败案例、是否触发认证刷新、最终通过或阻塞原因。只保留非敏感结论，不把原始账户响应、邮箱、Cookie、token 或聊天提交到仓库。

研究结论不得自动转为“账户已验证”；合成测试通过、Linux 编译通过、Windows CI 通过也不能替代 Windows 真实账户验证。
