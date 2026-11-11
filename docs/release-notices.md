# 可下载包的第三方声明

仓库的 MIT 许可只覆盖本项目自有代码。每个可执行文件下载包还须附完整第三方声明；不能仅分发裸 exe，或只提供 SPDX 名称。

在固定 Rust 工具链、`cargo fetch --locked` 和 `npm ci --prefix web` 完成后运行：

```sh
python scripts/package-notices.py --output dist/notices
```

缺失的父目录会被创建，输出目录不得存在。脚本仅离线读取 Cargo 元数据、已缓存 crate、已安装前端依赖和当前工具链的标准库声明，不安装工具或联网。错误输出不包含本机缓存路径。失败后的输出不可发布，应由调用方删除该次新目录后重新生成。

将输出目录的全部内容放在每个二进制发布包中，与可执行文件并列，包括项目 `LICENSE`、`THIRD_PARTY_NOTICES.txt`、清单、`licenses/` 和 `third-party-sources/`。不要只复制清单。Rust 范围取 Windows/Linux 的非 dev 依赖并集，保留 build／宏依赖声明以避免漏项；React、react-dom、scheduler 与 Vite 注入的 modulepreload 辅助代码单独列出。源码归档 URL 仅作来源记录，不能代替随包的许可正文。

`option-ext 0.2.0` 使用 MPL-2.0；同包保留其未修改的原始源码和许可，不包含 Cargo 私有元数据，也不将本项目其他代码改为 MPL。标准库使用当前固定工具链提供的 `COPYRIGHT-library.html` 和其引用的 `licenses/`。新增许可证表达式、来源或其他 MPL 依赖会使脚本失败，须先重新核查分发义务。
