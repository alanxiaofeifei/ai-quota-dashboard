# Windows：确认待验证的客户端

本页只确认已有客户端的版本，不查询账户、读取凭据或启动额度探测。应用的 About 版本、Codex CLI 版本与 App Server 构建是不同信息，不能互相推定。Google Play 等付款渠道也不能用于推定当前设备的操作系统。

## 当前最小步骤

在用于采集的 Windows 电脑上打开 PowerShell，运行：

```powershell
codex --version
```

仅需提供版本输出。若 PowerShell 提示找不到命令，记录“未安装 CLI”并停止；本步骤不要求安装或登录，不扫描应用安装目录，也不要求认证文件、邮箱或账单截图。

官方 CLI 的版本参数在进入正常配置及交互流程前解析，见 [CLI 源码](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/cli/src/main.rs)。本项目不会根据桌面应用版本自动选取或执行某个 CLI。

## 核查后仍需完成的工作

取得实际 CLI 版本后，核查对应官方发行物、启动行为、专用运行目录与认证存储隔离，再安排同一账户、同一额度窗口的官方界面对照。版本存在或 Windows CI 通过不代表该过程已经完成。

当前 `ai-quota-preflight probe-codex` 仍固定拒绝启动。不要把确认参数、更新客户端或复制 token 当成绕过此门槛的方法；本工具不自动修改官方客户端。

## 额度解释

- 应用显示的套餐名称不自动转换为猜测的 RPC `planType`。
- 官方说明当前 Pro 档位没有 Work／Codex 五小时限制；解析器只保留实际返回的窗口，不依据套餐生成窗口。[官方使用说明](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex)
- 账户页面展示的共享范围是页面证据。将其绑定到具体 RPC 额度桶之前，必须核对账户和窗口，不能仅凭 `limitId` 或相同百分比合并。
- `product="codex"` 表示查询入口，不说明额度只能由 Codex 消耗，也不说明所有 ChatGPT 产品均纳入该额度。覆盖产品未知时保持未知。

真实验证标准见[阶段 0 清单](phase-0.md)。个人 Sites 看板仍在至少一个自动数据源通过后部署。
