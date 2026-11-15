# 服务商接口矩阵

2026-11-15 只读核对官方文档；没有使用真实 Key、付费推理或调用实际余额接口。订阅与 API 余额是不同计量体系，不交叉换算。

| 平台 | Phase 1 / 官方接口或使用页 | 字段与说明 | 官方文档 |
| --- | --- | --- | --- |
| DeepSeek | API `GET https://api.deepseek.com/user/balance` | `is_available`；`balance_infos[]` 的 `currency`、`total_balance`、`granted_balance`、`topped_up_balance`。金额字符串保留，按 CNY/USD 分桶。 | [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/) |
| OpenRouter Key | API `GET https://openrouter.ai/api/v1/key` | `data.limit`、`usage`、`limit_remaining`、`limit_reset`、`is_free_tier`。主数字仅为 Key 剩余预算，不当账户现金。null 不是 0 或无限资金。`usage` 为累计消费，不从 limit 减去它来推断当前周期剩余。 | [Get current API key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) |
| OpenRouter Account（可选） | API `GET https://openrouter.ai/api/v1/credits` | Management Key；`data.total_credits`、`total_usage`，两者都有才计算差值，USD；与普通 Key 预算分卡。 | [Get remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits) |
| Moonshot Kimi | API `GET https://api.moonshot.cn/v1/users/me/balance`，区域 ai 使用 `api.moonshot.ai` | `data.available_balance`、`voucher_balance`、`cash_balance`。cn CNY / ai USD，现金可为负，available 直接取官方值不自算；业务 code 非 0 / status false 为错误。 | [国内文档入口](https://platform.moonshot.cn/docs/api/balance)、[国际站官方文档](https://platform.kimi.ai/docs/api/balance) |
| SiliconFlow | **手动**，cn/com；不发送 API 密钥 | 历史字段 totalBalance / chargeBalance / balance 分别录入，cn CNY / com USD。官方旧 `/user/info` 已停用，无可核实的替代余额接口，当前不请求该地址。 | [官方停用公告](https://docs.siliconflow.cn/docs/release-notes/overview?release=api-service-adjustment-userinfo-endpoint-deprecation)、[历史 schema](https://siliconflow.readme.io/reference/user-info) |
| ChatGPT / Codex | 手动 + 现有扩展摘要粘贴；[Usage](https://chatgpt.com/settings/usage?tab=overview) | 5h %、weekly %、独立 credits、各自 reset。扩展 v1 只报告 weekly / credits，不生成不存在的 5h。 | [Usage limits](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits) |
| Claude | 手动；[Usage](https://claude.ai/settings/usage) | 5h / weekly %、credits、reset。个人订阅没有采用内部接口。 | [官方使用限制说明](https://support.anthropic.com/en/articles/8325612-does-claude-pro-have-any-usage-limits) |
| Gemini / Google AI Pro | 手动；[Gemini](https://gemini.google.com/) | 5h / weekly %、credits、reset（仅录入实际页面提供的数据，缺失留空）。 | [Google 官方说明](https://support.google.com/gemini/answer/16275805) |
| Grok | 手动；[Grok](https://grok.com/) | 独立窗口百分比、credits、reset；不读取网页会话。 | [官方使用限制](https://docs.x.ai/x-subscription/usage-limits) |
| GLM / Coding Plan | 手动；[BigModel](https://bigmodel.cn/usercenter/financial/overview) | bigmodel CNY 余额与 Coding Plan 5h / weekly % / credits 分桶；不接入未公开 monitor 端点。 | [Coding Plan](https://docs.bigmodel.cn/cn/coding-plan/overview) |
| Doubao / Volcengine | Phase 1 手动；[费用中心](https://console.volcengine.com/finance/overview/) | CNY 账户余额和独立 credits；需要 IAM AK/SK 的 QueryBalanceAcct 放 Phase 2。 | [QueryBalanceAcct](https://www.volcengine.com/docs/6269/116398)、[方舟计费](https://www.volcengine.com/docs/82379/1099475) |
| Qwen / Bailian | Phase 1 手动；[百炼](https://bailian.console.aliyun.com/) | CNY 余额和独立资源 credits；RAM AK/SK 签名 QueryAccountBalance 放 Phase 2。 | [QueryAccountBalance](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)、[百炼计费](https://help.aliyun.com/zh/model-studio/billing-for-model-studio) |
| 自定义 | 手动 | 百分比、credits、CNY 余额、tokens、requests 单独记录，不推断比例或汇率。 | 使用你自己的官方账户页面核对；不支持自定义 API URL。 |

## 官方文档核对与计划差异

- DeepSeek 文档确认 `balance_infos` 数组及字符串金额，与 TASK 的已验证形状一致。
- PLAN 的 OpenRouter 文档路径返回 404；现路径含 `/docs/api/api-reference/`，已改用表中路径。字段仍为 limit / usage / limit_remaining / limit_reset / is_free_tier。`limit_reset` 是 daily / weekly / monthly 周期，不是绝对时间，因此仅展示周期，不编造倒计时。官方扩展响应中的 label、creator_user_id 等全部不投影。
- Moonshot 国内文档在本环境读取超时；通过重定向后的国际官方文档核对端点及三项余额字段。现国际官方域名为 platform.kimi.ai，API 示例仍使用 api.moonshot.ai。文档正文写明 code=0 成功；自动生成的示例有 code=123，与正文冲突，因此按正文检查业务码。国内 CNY 和 cn 地址沿用任务已核对约定，未用真实请求验证。
- **SiliconFlow 的计划必须修正**：历史官方 ReadMe 内嵌 OpenAPI 确认三项金额字段和 code=20000，但现官方 [2026-08-11 公告](https://docs.siliconflow.cn/docs/release-notes/overview?release=api-service-adjustment-userinfo-endpoint-deprecation) 明确 `/user/info` 于 2026-08-14 停用，后续替代接口另行公告。按 TASK 的“文档不一致以官方为准”，两区域当前均采用手动，拒绝密钥提交，allowlist 排除旧地址；保留纯历史 payload 投影及测试，不包含可调用适配器。未核实全球区仍有效的公开替代余额 API，不能猜测地址。
- 上表订阅及 AK/SK 文档是官方来源入口，不代表已实现其 API 或本轮逐页重验；当前只有 DeepSeek、OpenRouter、Moonshot 的 Bearer 余额适配器（OpenRouter 两种独立能力）。没有公开个人订阅额度 API 时只记录用户输入，不用推理请求“探测额度”。

全部适配器：固定 HTTPS 地址、redirect manual、5s（含读体）、64KiB，错误码固定；失败保留上次成功快照；缺失金额 null。没有 API 的平台不要填写推理 Key。
