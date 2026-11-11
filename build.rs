use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn files(directory: &Path, output: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                files(&path, output);
            } else if entry.file_type().is_ok_and(|kind| kind.is_file()) {
                output.push(path);
            }
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=web/dist");
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let directory = root.join("web/dist");
    let ready = directory.join("index.html").is_file();
    let mut entries = Vec::new();
    if ready {
        files(&directory, &mut entries);
    }
    entries.sort();
    let mut code = format!("pub const FRONTEND_AVAILABLE: bool = {ready};\npub static ASSETS: &[(&str, &[u8], &str)] = &[\n");
    for path in entries {
        let relative = path
            .strip_prefix(&directory)
            .unwrap()
            .to_str()
            .unwrap()
            .replace('\\', "/");
        let mime = match path.extension().and_then(|value| value.to_str()) {
            Some("html") => "text/html; charset=utf-8",
            Some("js" | "mjs") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("svg") => "image/svg+xml",
            Some("json") => "application/json",
            Some("png") => "image/png",
            _ => "application/octet-stream",
        };
        code.push_str(&format!(
            "({relative:?}, include_bytes!({:?}), {mime:?}),\n",
            path.to_str().unwrap()
        ));
    }
    code.push_str("];\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("frontend_assets.rs"),
        code,
    )
    .unwrap();
}
