# 服务商接口矩阵

2026-11-15 只读核对官方文档；没有使用真实 Key、付费推理或调用实际余额接口。订阅与 API 余额是不同计量体系，不交叉换算。表中「手动」表示无公开余额 API，也可通过浏览器扩展预设（教学作后备）自动同步官方页显示值。

| 平台 | Phase 1 / 官方接口或使用页 | 字段与说明 | 官方文档 |
| --- | --- | --- | --- |
| DeepSeek | API `GET https://api.deepseek.com/user/balance` | `is_available`；`balance_infos[]` 的 `currency`、`total_balance`、`granted_balance`、`topped_up_balance`。金额字符串保留，按 CNY/USD 分桶。 | [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance) |
| OpenRouter（统一） | API `GET https://openrouter.ai/api/v1/credits`（Management Key）；可选 `GET https://openrouter.ai/api/v1/key`（普通 Key） | 主数值账户余额 = total_credits − total_usage，次行「已充值 / 已使用」。普通 Key 仅次行显示此 Key 的消费上限 limit、已用 usage、剩余上限 limit_remaining 和 limit_reset；显式 null limit 显示「无上限」，缺失仍未知。两槽可分别保存，不用 usage 推断周期余量。403 / 管理 Key 误用于 /key → wrong_key_type。 | [Credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits)、[Key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)、[Management keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys) |
| Moonshot Kimi | API `GET https://api.moonshot.cn/v1/users/me/balance`，区域 ai 使用 `api.moonshot.ai` | `data.available_balance`、`voucher_balance`、`cash_balance`。cn CNY / ai USD，现金可为负，available 直接取官方值不自算；业务 code 非 0 / status false 为错误。 | [国内文档入口](https://platform.kimi.com/docs/api/balance)、[国际站官方文档](https://platform.kimi.ai/docs/api/balance) |
| SiliconFlow | **手动**，cn/com；不发送 API 密钥 | 历史字段 totalBalance / chargeBalance / balance 分别录入，cn CNY / com USD。官方旧 `/user/info` 已停用，无可核实的替代余额接口，当前不请求该地址。 | [官方停用公告](https://docs.siliconflow.cn/docs/release-notes/overview)、[历史 schema](https://siliconflow.readme.io/reference/user-info) |
| ChatGPT / Codex | 扩展自动同步 + 手动 / 旧摘要兼容；[Usage](https://chatgpt.com/settings/usage?tab=overview) | 5h %、weekly %、独立 credits、各自 reset。扩展支持教学与 ChatGPT/Codex 预设；缺失 5h 不生成数值。 | [Usage limits](https://help.openai.com/en/articles/20001625-understanding-chatgpt-and-codex-usage-limits) |
| Claude | 手动；[Usage](https://claude.ai/settings/usage) | 5h / weekly %、credits、reset。个人订阅没有采用内部接口。 | [官方使用限制说明](https://support.claude.com/en/articles/11647753) |
| Gemini / Google AI Pro | 扩展 / 手动；[AI Studio usage](https://aistudio.google.com/usage) | requests / tokens 用量独立显示，不称作余额或订阅剩余。Gemini 应用页无本项目可读余额。 | [Google 官方说明](https://support.google.com/gemini/answer/16275805) |
| Grok | 手动；[Grok](https://grok.com/) | 独立窗口百分比、credits、reset；不读取网页会话。 | [官方使用限制](https://docs.x.ai/overview) |
| GLM / Coding Plan | 手动；[BigModel](https://bigmodel.cn/finance-center/finance/overview) | bigmodel CNY 余额与 Coding Plan 5h / weekly % / credits 分桶；不接入未公开 monitor 端点。 | [Coding Plan](https://docs.bigmodel.cn/cn/coding-plan/overview) |
| Doubao / Volcengine | Phase 1 手动；[费用中心](https://console.volcengine.com/finance/fund/overview) | CNY 账户余额和独立 credits；需要 IAM AK/SK 的 QueryBalanceAcct 放 Phase 2。 | [QueryBalanceAcct](https://www.volcengine.com/docs/6269/116398)、[方舟计费](https://www.volcengine.com/docs/82379/1099475) |
| Qwen / Bailian | Phase 1 手动；[百炼](https://bailian.console.aliyun.com/) | CNY 余额和独立资源 credits；RAM AK/SK 签名 QueryAccountBalance 放 Phase 2。 | [QueryAccountBalance](https://help.aliyun.com/zh/user-center/developer-reference/api-bssopenapi-2017-12-14-queryaccountbalance)、[百炼计费](https://help.aliyun.com/zh/model-studio/billing-for-model-studio) |
| 自定义 | 手动 | 百分比、credits、CNY 余额、tokens、requests 单独记录，不推断比例或汇率。 | 使用你自己的官方账户页面核对；不支持自定义 API URL。 |

## 官方文档核对与计划差异

- DeepSeek 文档确认 `balance_infos` 数组及字符串金额，与 TASK 的已验证形状一致。
- PLAN 的 OpenRouter 文档路径返回 404；现路径含 `/docs/api/api-reference/`，已改用表中路径。字段仍为 limit / usage / limit_remaining / limit_reset / is_free_tier。`limit_reset` 是 daily / weekly / monthly 周期，不是绝对时间，因此仅展示周期，不编造倒计时。官方扩展响应中的 label、creator_user_id 等全部不投影。
- Moonshot 国内文档在本环境读取超时；通过重定向后的国际官方文档核对端点及三项余额字段。现国际官方域名为 platform.kimi.ai，API 示例仍使用 api.moonshot.ai。文档正文写明 code=0 成功；自动生成的示例有 code=123，与正文冲突，因此按正文检查业务码。国内 CNY 和 cn 地址沿用任务已核对约定，未用真实请求验证。
- **SiliconFlow 的计划必须修正**：历史官方 ReadMe 内嵌 OpenAPI 确认三项金额字段和 code=20000，但现官方 [2026-08-11 公告](https://docs.siliconflow.cn/docs/release-notes/overview) 明确 `/user/info` 于 2026-08-14 停用，后续替代接口另行公告。按 TASK 的“文档不一致以官方为准”，两区域当前均采用手动，拒绝密钥提交，allowlist 排除旧地址；保留纯历史 payload 投影及测试，不包含可调用适配器。未核实全球区仍有效的公开替代余额 API，不能猜测地址。
- 上表订阅及 AK/SK 文档是官方来源入口，不代表已实现其 API 或本轮逐页重验；当前只有 DeepSeek、OpenRouter、Moonshot 的 Bearer 余额适配器（OpenRouter 两槽合并）。没有公开个人订阅额度 API 时只记录用户输入，不用推理请求“探测额度”。

全部适配器：固定 HTTPS 地址、redirect manual、5s（含读体）、64KiB，错误码固定；失败保留上次成功快照；缺失金额 null。没有 API 的平台不要填写推理 Key。

## Phase 1.1 链接与密钥指引

完整的已验证链接冻结在 [provider-links](../fixtures/provider-links.md)，catalog 测试逐项核对；区域链接由 providerLinks 生成。GLM 同时提供 [余额](https://bigmodel.cn/finance-center/finance/overview) 与 [Coding Plan 用量](https://www.bigmodel.cn/coding-plan/personal/usage)。Moonshot 国内控制台为 platform.kimi.com，国际 platform.kimi.ai，API 主机仍分别 api.moonshot.cn / api.moonshot.ai。DeepSeek 与 Moonshot 的余额均为账户级，任意该账户 API Key 可用，推荐单独创建 quota-dashboard Key；Moonshot 两区域 Key 不通用。OpenRouter 账户必须创建 Management Key，普通 Key 的消费上限与充值余额无关。UI 添加对话框提供中文 / English 指引及创建密钥、用量与文档链接。

## v1.2 页面预设与账户（2026-11-21）

新增各家官方页预设和 [中文图文教程](extension-guide.zh.md)。具体 URL 模式与指标单位在 `browser-extension/presets.mjs`，HTML 合成夹具在 `tests/fixtures/provider-pages/`；这表示已实现并验证解析契约，不表示真实登录后 DOM 已逐家验收。Claude、xAI、火山、阿里云、百炼、SiliconFlow 等页若没有唯一可见的已知标签，会返回「此页没有可识别的额度数字」，不能猜测余额。

GLM 财务页读取「当前余额」CNY；Coding Plan 百分比只在明确剩余 / 已用语义时读取。OpenRouter 页面读取 Total Credits Available USD，与 `/credits` API 账户余额语义相同，API 有值时优先 API；普通 Key 预算始终次级。页面快照与 API 快照分开保存（迁移 0003），失败不覆盖最后成功值。所有 API 类卡片也可选择仅通过扩展读官方页，无需提交推理 Key。

Google 官方 [AI Studio 入门](https://aistudio.google.com/docs/get-started) 与 [计费说明](https://aistudio.google.com/docs/billing) 已重新核对。用量入口为 AI Studio；现行说明涉及预付费及部分账户后付费，不能再把“所有付费 API 账户均后付费”作为假设。该预设只读取明确展示的请求 / token 用量，不根据付款模式推断余额，不把 Gemini / Google AI Pro 订阅与 API 项目用量混同。每张卡片保存用户输入账户标签，Google 地址保留 `authuser=N` 或 `/u/N/`；序号不证明真实账户身份，需用户核对。
