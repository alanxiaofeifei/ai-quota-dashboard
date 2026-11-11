# Windows：确认待验证的客户端

CLI 是后台本地采集的一个候选，不是查看额度的唯一途径，也不是网页路线的前置条件。用户日常使用不需要反复打开终端输入命令。新版网页可使用 [Usage](https://chatgpt.com/settings/usage?tab=overview)，见[网页读取验证](browser-selection.md)。

## 命令未找到或更新没有进展

命令未找到只说明当前会话没有解析到它，不等于未安装。PowerShell 的 Process PATH 来自父进程，可能不同于持久 User／Machine PATH；应用内终端、WSL、容器和普通 PowerShell 也可能处于不同环境。npm 在 Windows 通常把全局命令 shim 放在 prefix 中，实际 prefix 不应靠猜测。

仅凭更新器打印安装命令，无法判断下载、解压、锁等待或网络是否卡住。不要并行启动多个更新，也不要根据存在某个 node 进程就结束全部 node 进程。

在需要诊断的 PowerShell 7 会话中，从源码目录运行：

```powershell
& .\scripts\windows-cli-diagnostics.ps1
```

分别在表现不同的会话中执行，可比较脱敏 JSON。脚本只检查已加载命令类型、本地固定磁盘上的已知命令文件、PATH 差异及有限进程元数据；不执行客户端／npm，不修改 PATH，不输出真实路径或命令行，不读取认证、npmrc、聊天或日志。它不能证明安装进度或具体卡住原因。若执行策略阻止脚本，保留错误类别，不为诊断全局关闭执行策略。

官方说明：[PowerShell 环境继承](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables?view=powershell-7.5)、[npm Windows 目录](https://docs.npmjs.com/cli/v11/configuring-npm/folders/)。

## 云端检查的边界

开发环境可以临时安装经核实的官方客户端，检查版本、协议和无登录拒绝行为。它无法继承本地浏览器或 Windows 应用的登录态；不得把 Cookie／token 上传到云端来补足这一点。

`scripts/codex-unauthenticated-smoke.py` 使用新临时目录、内存认证、关闭插件与遥测，要求账户为空且额度请求返回已知认证拒绝；不登录、不调用模型，也不输出原始响应。Linux 实测额外在断网 namespace 执行；脚本本身不会默认声明网络已隔离。无登录测试不能替代真实额度验证。

本页只确认已有客户端的版本，不查询账户、读取凭据或启动额度探测。应用的 About 版本、Codex CLI 版本与 App Server 构建是不同信息，不能互相推定。Google Play 等付款渠道也不能用于推定当前设备的操作系统。

## 当前最小步骤

在用于采集的 Windows 电脑上打开 PowerShell，运行：

```powershell
codex --version
```

仅需提供版本输出。若 PowerShell 提示找不到命令，记录“当前会话未找到 CLI”；它不能证明其他会话或环境中未安装。本步骤不要求安装或登录，不扫描应用安装目录，也不要求认证文件、邮箱或账单截图。

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
