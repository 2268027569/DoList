# 变更日志 · Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。条目以中文为主；首个公开版本起，Release Notes 会同时提供英文版本。

## [Unreleased]

### Added

- 仓库初始化：MIT [LICENSE](LICENSE)、双 README（[英文](README.md) / [中文](README.zh-CN.md)）、`.gitignore`、`.gitattributes` 与 GitHub Actions CI 骨架
- [docs/FEATURES.md](docs/FEATURES.md)：13 个模块的功能模块清单（P0/P1/P2 优先级）、锁定决策、明确不做与 MVP 边界
- 社区文档：[CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、[SECURITY.md](SECURITY.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- GitHub 模板：Bug 报告、功能建议、Issue 模板配置与 Pull Request 模板
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：M0 技术方案（进程与窗口架构、目录结构、依赖清单、SQLite 表设计与迁移、IPC 契约、主题令牌、i18n 接入、标记窗口实现要点、性能预算、安全与发布）

### M0 脚手架（进行中）

- 工程栈：electron-vite 6 + Electron 44 + TypeScript 5.9（strict）+ React 19 + Tailwind 4；**双渲染入口**（`marker` 纯 DOM/CSS、`panel` React），生产构建期注入 CSP，开发态不注入
- 主进程：6 组启动编排日志、单实例、SQLite（WAL + 版本化迁移，迁移 SQL 内嵌避免 `asarUnpack` 额外文件）、统一 IPC 注册器（13 通道 + 值返回错误模型 + zod 校验）、托盘、全局快捷键、标记与面板窗口、锚点式位置持久化（`displayId / edge / offsetFromEdge / ratioAlongEdge`）
- 渲染层：`preload` 仅 `contextBridge` 白名单 API（`contextIsolation` + `sandbox`）；标记窗口的 JS 拖拽（抓取点 + 心跳 + 看门狗）、单击展开、单击抑制
- 共享层：IPC 契约与 zod schema、三层主题令牌（palette → semantic → component）、i18next + ICU 语言包（`en` / `zh-Hans`，4 个命名空间）
- 质量门：`lint`（含令牌静态检查）、`typecheck`（node / web 双配置）、`test`（Vitest 34 例）、`i18n:check`（key 全等校验）全部接入 CI
- 工具脚本：图标生成（`scripts/make-icons.mjs`）、标记输入冒烟（`scripts/smoke-marker-input.mjs`，驱动真实系统光标）
- 实测结论回写 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：透明非聚焦窗口可正常收到指针事件（M01 最大风险排除）、Windows 对透明无边框窗口强制最小 32×39 DIP、OS 光标与 Electron DIP 换算一致、better-sqlite3 打包态可用

[Unreleased]: https://github.com/2268027569/DoList/commits/main
