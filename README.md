# AI Quota Preflight

AI 订阅额度看板的阶段 0 验证工具，使用 Rust 实现。当前交付包括本地环境检查、严格的 Codex 额度响应解析、合成测试和 Windows 验证清单。

**阶段 0 尚未通过。** 当前开发环境是 Linux，没有完成 Windows 真实账户验证；新的本地应用认证适用性、官方客户端启动副作用与 Windows 凭据隔离也未确认。因此真实 `probe-codex` 命令保持关闭，不启动客户端。依照已批准计划，暂未进入看板、自动轮询、手机连接或云同步开发。

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

当前验证器没有看板或同步服务，不会自动查询网络。测试仅使用合成数据和受控模拟子进程，不能证明官方认证、真实额度、Windows 兼容或平台政策已经通过。

`test-support` 仅为模拟传输测试提供辅助实现；它不会开放 `probe-codex`。正常构建不要启用该功能。

## 后续验证与文档

- [阶段 0 操作与验收清单](docs/phase-0.md)：进入真实 Windows 验证的前提、观察项目和通过门槛。
- [Windows 客户端版本确认](docs/windows-preflight.md)：区分应用、CLI 与 App Server 版本，确认已有安装后再验证。
- [来源与证据状态](docs/evidence.md)：公开文档／源码与实账验证分开登记。
- [安全边界](docs/security.md)：凭据、进程、日志和后续网络访问的约束。
- [GitHub 与个人站点交付](docs/delivery.md)：主仓、Sites 发布条件和可执行的源码版本一致性检查。

开源主仓为 [alanxiaofeifei/ai-quota-dashboard](https://github.com/alanxiaofeifei/ai-quota-dashboard)，已由用户创建并核实公开可访问，以 GitHub 为功能源码主仓。个人网页默认采用 owner-private 的 ChatGPT Sites 托管；按用户选择，等待自动采集通过阶段 0 后再部署。当前尚未创建或部署 Site。未来两处使用同一已验证版本的功能源码，部署身份单独管理；源码清单工具已提供，后台自动同步服务尚未实现。

本项目采用 MIT 许可。当前代码是独立实现；未捆绑其他看板或官方客户端。后续引入第三方实现时另行记录来源和许可。
