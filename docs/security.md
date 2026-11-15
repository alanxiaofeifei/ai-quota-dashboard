# 安全模型（Phase 1 Web）

单所有者实例。Cloudflare Access 边缘策略和 Worker JWT 校验同时生效，所有 HTML、静态资源和 API 都经过 Worker。仅 `/healthz` 匿名可见；`/api/ext/*` 使用独立设备令牌，其余受 Access JWT 保护。不接受密码模式或默认开放状态；缺少/不支持 AUTH_MODE 或 Access 配置返回 503。

JWT 只接受 RS256、非空 kid，拒绝 none/HS256/crit。固定 team.cloudflareaccess.com 主机取 JWKS，最多 64KiB、5 秒、禁止重定向；每 issuer 内存缓存 1 小时，未知 kid 每分钟至多刷新一次。验签后校验 iss、aud、exp 和可选 nbf（30 秒偏移），email 忽略大小写匹配 OWNER_EMAIL。禁止依赖未验签的 email / Access 用户头。JWKS 故障拒绝访问；无法通过静态文件绕过。

主密钥是 Worker secret `MASTER_ENCRYPTION_KEY`，严格 base64 编码 32 字节。每次使用新 12 字节 IV，以 AES-256-GCM 加密 API 密钥，AAD 为 `quota:cred:${providerId}:${kind}`。D1 只存密文；密钥仅经 POST JSON 正文接受，不放 URL、LocalStorage 或日志。响应凭据字段只有 configured、lastCheckAt、lastCheckStatus、lastErrorCode，不含掩码、尾号或密文；OpenRouter 仅额外报告已配置的槽位名。替换 / 清除同样受完整鉴权与写保护。

所有所有者 API 写入要求同源 Origin 和 application/json（可附 UTF-8 charset），流式限制 32KiB，禁止用户选择任意 API Base URL。适配器只向 allowlist 中固定 HTTPS 主机与路径发送 Bearer，GET、不附浏览器 Cookie、禁止跟随跳转。超时 5 秒（包括响应体），流式最多 64KiB。错误只返回 unauthorized / rate_limited / upstream_error / invalid_response / timeout / wrong_key_type，不保存上游消息、URL 参数或堆栈。

D1 原子条件 UPDATE 保护 provider 60 秒冷却，失败同样冷却；Retry-After（秒或 HTTP-date）延长等待。预览测试使用单独的按 provider type 的 D1 冷却，测试不会持久化密钥或快照。每个 refresh 请求最多 6 路并发。无 Cron 或脱离请求生命周期的后台任务。

CSP 仅允许同源脚本（无 unsafe-inline script）、样式允许内联进度条、字体仅同源；无外链字体/CDN。所有响应 private,no-store / nosniff / no-referrer / X-Frame-Options DENY / frame-ancestors none。D1 故障等未知异常转换为固定 internal_error，程序不打印原始错误或请求体。

扩展摘要不是账户认证材料，必须通过同一所有者入口粘贴导入；只允许已定义字段，丢弃不可信 reset label 并重建显示，时间保留原始页面观测，不依据导入时间伪装新鲜。旧 Rust 和 Windows 构建仅归档。不存在 Session/Cookie 抓取、内部监控接口或消耗 Token 的探测。扩展设备令牌路径在下节说明。

demo 公开但只读：任何写操作返回友好 403，供应商密钥测试也不会出站。健康检查仅说明 Worker 存活，不证明 D1、Access 或供应商已配置。

备份 D1 密文时必须另外安全保存主密钥；主密钥更换需重新录入供应商密钥。清除凭据保留历史成功快照，并不代表余额归零。数据库与 Cloudflare 账户访问、Access 策略及部署域名由操作者负责。当前未进行真实账户 API 或线上部署验证，测试均为合成材料。

## Phase 1.1 扩展设备边界

`/api/ext/*` 只接受设备 Bearer，完全不使用 Access JWT。Access 配置必须完整，缺失仍 503；demo 拒绝设备读写。所有者配对 / 列表 / 撤销 / 来源设置仍在 `/api/extension`，必须通过 Access。配对返回一次性展示的 aiq1 码，包含看板 origin 与 32 字节随机令牌；D1 仅保存 SHA-256、名称、创建 / 心跳 / 撤销时间。哈希查找后作固定长度比较。每设备每分钟 120 请求，32 KiB 流式体积限制，严格白名单嵌套投影，失败不写数值、不覆盖最后成功快照；拒绝未来与倒序观测。

扩展域 CORS 精确反射合法 chrome-extension origin，无 Allow-Credentials。只有扩展路径提供 Authorization / Content-Type 的预检许可；其他路由无 CORS。令牌无 Cookie 认证，扩展 fetch 使用 credentials:omit、redirect:error，目的地仅为配对的 HTTPS origin。无 Origin 的受信客户端也必须给令牌。Cloudflare Access 仅在 /api/ext/ 子路径 bypass；Worker 的设备鉴权仍执行。

扩展没有默认主机权限，仅在用户启用 / 教学时申请对应 HTTPS origin。storage.local 不同步令牌。页面注入函数只读语义标题和被指定的小显示元素，不读取 Cookie、页面存储、请求或 body.innerText。登录路径 / 密码表单、找不到定位器、超时和网络失败均报告固定状态；定位器配置与测量数字投影发回自己的看板，不上传原始预览文字。详见 [扩展指南](extension.md)。

0002 合并旧 OpenRouter 凭证时保留原 AAD provider/kind 坐标，避免不解密就重绑密文。旧快照失效，合并后重新抓取；重复旧槽取最后更新的一条，明细见迁移文档。新写密钥按新卡片 id 加密；仍需原主密钥。
