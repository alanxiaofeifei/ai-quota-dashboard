use ai_quota_preflight::{server, store::Store};
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    if let Err(code) = run().await {
        eprintln!("{code}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), &'static str> {
    let mut args = std::env::args_os().skip(1);
    let mut data_dir = None;
    let mut port = 0_u16;
    let mut open = true;
    while let Some(argument) = args.next() {
        match argument.to_str() {
            Some("--help" | "-h") => {
                println!("AI Quota 本地只读原型\n双击或运行 ai-quota-dashboard 自动打开本地授权窗口。\n可选参数：--data-dir <绝对目录> --port <端口> --no-open（仅开发诊断）\n只监听 127.0.0.1，不向平台查询，不上传数据。导入扩展导出的摘要 JSON 后查看。");
                return Ok(());
            }
            Some("--version") => {
                println!("ai-quota-dashboard {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            Some("--data-dir") => {
                data_dir = Some(PathBuf::from(args.next().ok_or("invalid_arguments")?));
            }
            Some("--port") => {
                port = args
                    .next()
                    .and_then(|value| value.to_str().and_then(|s| s.parse().ok()))
                    .ok_or("invalid_arguments")?;
            }
            Some("--no-open") => {
                open = false;
            }
            _ => return Err("invalid_arguments"),
        }
    }
    if !server::frontend_available() {
        return Err("界面尚未构建：开发者请先在 web 中运行 npm ci 和 npm run build，再重新编译；最终用户请使用完整发行包。");
    }
    let data_dir = match data_dir {
        Some(path) => path,
        None => directories::ProjectDirs::from("", "AIQuota", "AIQuotaDashboard")
            .ok_or("local_data_directory_unavailable")?
            .data_local_dir()
            .to_path_buf(),
    };
    if !data_dir.is_absolute() {
        return Err("absolute_data_directory_required");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = std::fs::DirBuilder::new();
        builder
            .recursive(true)
            .mode(0o700)
            .create(&data_dir)
            .map_err(|_| "local_data_directory_unavailable")?;
    }
    #[cfg(not(unix))]
    std::fs::create_dir_all(&data_dir).map_err(|_| "local_data_directory_unavailable")?;
    let store =
        Store::open(&data_dir.join("quota.sqlite")).map_err(|_| "local_database_unavailable")?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .map_err(|_| "loopback_listener_unavailable")?;
    let address = listener
        .local_addr()
        .map_err(|_| "loopback_listener_unavailable")?;
    let origin = format!("http://127.0.0.1:{}", address.port());
    let (router, bootstrap) =
        server::make_app(store, origin.clone()).map_err(|_| "local_authorization_unavailable")?;
    // Some browser openers wait for the target page. Start serving before the
    // opener so the page can complete its initial authorization request.
    let task = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await
    });
    if open {
        let url = format!("{origin}/#bootstrap={bootstrap}");
        // The opener's error can contain the URL. Never print it or a fallback
        // launch URL; start a new authorized window by restarting this program.
        let opened = tokio::task::spawn_blocking(move || webbrowser::open(&url)).await;
        if !matches!(opened, Ok(Ok(()))) {
            task.abort();
            return Err(
                "无法自动打开授权窗口。请确认默认浏览器可用后重新启动应用；未输出任何授权令牌。",
            );
        }
    }
    drop(bootstrap);
    println!("AI Quota 本地原型已启动。仅保存和展示本地摘要；关闭程序将停止服务。");
    if !open {
        println!("诊断模式未打开授权窗口，也不输出访问令牌。");
    }
    task.await
        .map_err(|_| "local_server_stopped")?
        .map_err(|_| "local_server_stopped")
}
