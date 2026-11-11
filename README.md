# AI Quota Preflight

AI 订阅额度看板的阶段 0 验证工具。包括 Rust 离线解析器、Windows 只读诊断、官方客户端无登录检查，以及实验性的本地浏览器选中文字读取工具。

**真实账户验证尚未通过。** 已在隔离 Linux 环境运行官方 Codex 0.167.1，确认无登录时额度请求被拒绝，结果不等于零额度。真实 `probe-codex` 仍关闭；网页读取与 CLI 是并行候选，不要求先修好本机 npm。看板和 Sites 部署等待验证通过，当前没有后台采集、手机连接或云同步。

## 本地使用

从源码构建需要 Rust 工具链。工具不自动安装或更新 Codex、Antigravity、浏览器、VPN 或云服务。

```sh
cargo build --locked
cargo run --locked -- doctor
cargo run --locked -- parse-codex --input fixtures/codex-rate-limits.json --output synthetic-report.json
cargo test --locked
cargo test --locked --features test-support
```

示例文件是合成数据，不代表任何账户或套餐。输出文件须是新文件；重复运行时换一个文件名，避免覆盖已有数据。

- `doctor [--output <new.json>]`：检查本地运行环境，不启动官方客户端、不读取认证或聊天。
- `parse-codex --input <file.json> --output <new.json>`：离线读取指定的额度 JSON，输出归一化摘要。支持 RPC `result` 包装和直接结果；不保留完整原始输入。
- `probe-codex`：预留命令。当前返回 `live_probe_unverified`，退出码为 3；即使提供确认参数也不会启动进程或访问账户。

请勿把 `auth.json`、Cookie、浏览器会话或聊天导出作为解析输入。真实额度摘要也可能含个人使用信息，不应自动提交到仓库或公开 issue。

## 数据真实性

解析器保留平台的桶和窗口含义，优先使用多桶响应，避免重复计入兼容单桶。缺失比例、窗口或重置时间保持未知；认证错误、空快照和无效响应不会变成零额度。订阅 credits 不标成 API 余额或美元费用；时间到点不推断已经恢复。

`product="codex"` 是查询入口，不代表独占额度池。每桶 `applies_to_products=null` 表示覆盖产品未知；不根据套餐名称、桶名或相同比例推定共享范围，也不自动生成五小时窗口。

Rust 主程序只离线处理数据。独立的 Python 无登录检查会显式启动指定官方客户端，使用新的内存认证档案；浏览器实验只读取用户选中的额度文本。合成测试、无登录检查和 CI 都不能替代真实账户额度及平台政策验证。

`test-support` 仅为模拟传输测试提供辅助实现；它不会开放 `probe-codex`。正常构建不要启用该功能。

## 不依赖终端的网页候选

新版账户可在 [ChatGPT Usage](https://chatgpt.com/settings/usage?tab=overview) 查看额度；旧 Codex usage 链接可能重定向到首页，以账户实际页面为准。

`browser-extension/` 是 Chrome／Edge 桌面扩展验证器。它仅在用户点击时读取该额度页中**用户选中的文本**，不抓整页、不读取 Cookie、不调用隐藏接口、不上传数据。输出保留周额度、相对重置与 credits 的不同含义；数据来源和新鲜度仍需人工核对。它不是后台自动采集器。

安装和测试步骤见[网页读取验证](docs/browser-selection.md)。Windows 终端的更新故障不会阻塞这条路线。

## 后续验证与文档

- [阶段 0 操作与验收清单](docs/phase-0.md)：进入真实 Windows 验证的前提、观察项目和通过门槛。
- [Windows 客户端版本确认](docs/windows-preflight.md)：区分应用、CLI 与 App Server 版本，确认已有安装后再验证。
- [网页读取验证](docs/browser-selection.md)：本地选区读取、字段核对及扩展权限。
- [来源与证据状态](docs/evidence.md)：公开文档／源码与实账验证分开登记。
- [安全边界](docs/security.md)：凭据、进程、日志和后续网络访问的约束。
- [GitHub 与个人站点交付](docs/delivery.md)：主仓、Sites 发布条件和可执行的源码版本一致性检查。

开源主仓为 [alanxiaofeifei/ai-quota-dashboard](https://github.com/alanxiaofeifei/ai-quota-dashboard)，已由用户创建并核实公开可访问，以 GitHub 为功能源码主仓。个人网页默认采用 owner-private 的 ChatGPT Sites 托管；按用户选择，等待自动采集通过阶段 0 后再部署。当前尚未创建或部署 Site。未来两处使用同一已验证版本的功能源码，部署身份单独管理；源码清单工具已提供，后台自动同步服务尚未实现。

本项目采用 MIT 许可。当前代码是独立实现；未捆绑其他看板或官方客户端。后续引入第三方实现时另行记录来源和许可。
