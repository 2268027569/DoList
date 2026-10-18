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

### M01 隐形标记（进行中）

- 标记形态：圆点 / 胶囊 / 图标三态，尺寸（0.8–1.5）、透明度、配色（accent / info / warning / overdue / neutral）均可调；窗口尺寸随形态与缩放重算，无需重启
- 状态角标与进度环：未完成 / 今日剩余 / 逾期三种角标模式；圆环显示今日完成度，形状不支持圆环时退化为胶囊双色填充；风险色按「临近截止→橙、逾期→红」覆盖
- 单一输入源：主进程把「外观 + 计数」合成 `MarkerStatePayload` 推送；外观同时编入 boot query，保证首帧不会闪成另一种形态
- 屏幕边缘吸附改为可配置（阈值 0 即关闭，复用 `free` 锚点路径）
- 展开 / 收起动画改为 spring 缓动（展开 200ms / 收起 180ms，仅 transform 与 opacity），失焦收起沿用 blur + 150ms
- 面板形态：右下角 grip 上报目标尺寸，主进程夹取并 `setBounds`（面板窗口本身不可 OS resize），尺寸停手后防抖落库；位置仍每次由标记重新推导
- 常驻标记路径去 i18next：改为静态文案表（约 23 kB 全量，含形态/角标/进度环与拖拽桥），i18next 只随面板打包；新增 `locales/static-keys.json` 与 `i18n:check` 的静态 key 校验兜底
- 冒烟脚本扩展至 12 项断言：新增标记状态推送与渲染层落点、面板尺寸 / 工作区贴合 / 与标记相邻
- 视觉问题修复（由计算样式审计发现）：胶囊进度在默认调色板下与填充同色而不可见；圆环轨道原用主题边框色，在浅色壁纸下等于隐形，改为随明暗模式翻转的半透明中性色
- 悬停与面板展开时给标记加环状反馈：环画成核心元素的第二层 `box-shadow`（常态扩散为 0），悬停只改一个合成属性，不为环新增 DOM 节点；顺手删掉不可达的 `:focus-visible` 规则（标记窗口 `focusable: false`）
- 贴边自动隐藏（P1）：仅对已吸附边缘的标记生效，可留 3–8px 的可见条，靠光标接近浮出、远离后收起，浮出与收起用两个距离留出滞回区间避免抖动；默认关闭（默认标记本来就贴着右边缘，默认开启会让首次启动只看到一个 5px 小条），开关与两个距离均可在设置里调。判定逻辑是纯函数（`edge-hide`，8 个单测），主进程只负责采样光标与移动窗口
- 冒烟脚本扩展至 15 项断言：新增贴边自动隐藏的浮出 / 收起 / 只剩 5px / 回到锚点 4 项，由真实系统光标驱动；另外拖拽失败时会指出「光标偏离脚本路径」多少像素，便于区分「桌面被占用」与「应用真出错」

[Unreleased]: https://github.com/2268027569/DoList/commits/main
