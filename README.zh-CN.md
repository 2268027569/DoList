# YiChen ToDo

![License](https://img.shields.io/badge/license-MIT-0FDC78)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-52525B)
![Languages](https://img.shields.io/badge/i18n-15%20languages-0FDC78)
![Status](https://img.shields.io/badge/status-spec%20stage-EFAA17)

> 一个尽量"不打扰"的桌面待办工具。
> 平时它只是桌面上一个可拖拽的小标记，点一下才展开面板。

本地优先、无账号、无云端服务、15 种语言、MIT 开源。

[English](README.md) · [功能模块清单](docs/FEATURES.md)

---

## 差异化定位

- **默认隐形** — 闲置时只有一个很小的标记（圆点 / 胶囊 / 图标），可拖到桌面任意位置；收起后连任务栏都不占位。点击展开，点别处收起。
- **标记即仪表盘** — 小圆环显示今日完成度，颜色提示风险：正常 / 临近截止 / 逾期，不用打开面板就知道今天紧不紧。
- **零打扰** — 无账号、无订阅、无广告、无遥测。通知是唯一的打扰，且可关闭。
- **原生级多语言** — 15 种语言（含阿拉伯语 RTL），复数、日期时间、相对时间、周起始日全部本地化，不是"翻几个字符串"。
- **数据属于你** — 本地 SQLite；可通过你已有的同步文件夹（OneDrive / Dropbox / iCloud Drive / 坚果云 / NAS）做轻量同步；一键导出加密包，换设备直接迁移。

## 当前状态

**规格阶段。** 范围与功能模块已确定，尚未开始编码，因此暂时没有安装包可下载。
已锁定决策：MIT 许可证 · 应用名 `YiChen ToDo` · Windows + macOS · SQLite · 首发 15 种语言 · 多主题 · 文件夹同步 + 设备迁移 · GitHub Actions 自动构建与签名。

## 功能模块

共 13 个模块，每个功能点标注优先级：**P0** = MVP 必须有、**P1** = 1.0 前完成、**P2** = 1.0 之后。详见 [docs/FEATURES.md](docs/FEATURES.md)。

| 模块 | 内容 |
|---|---|
| M01 隐形标记与窗口系统 | 可拖拽标记、边缘吸附、贴边自动隐藏、展开动画、多显示器 |
| M02 任务核心 | 任务、子任务、重复任务（RRULE）、优先级、提醒、拖拽排序、撤销 |
| M03 视图与组织 | 智能清单、自定义清单、标签、分组、筛选、搜索、归档 |
| M04 提醒与通知 | 系统通知、提前提醒、逾期与每日摘要、免打扰 |
| M05 聚焦与激励 | 今日焦点 3 件事、连续打卡、统计、可选番茄钟 |
| M06 国际化 | 15 种语言、ICU 复数、RTL、时区、CI 语言包校验 |
| M07 外观与个性化 | 亮/暗/跟随系统、内置主题、自定义主色、毛玻璃、隐私模式 |
| M08 数据、同步与迁移 | SQLite、备份、导入导出（JSON/CSV/Markdown/ICS）、文件夹同步、设备迁移 |
| M09 系统集成 | 全局快捷键、托盘、开机自启、单实例、`yichen-todo://` 协议、拖放捕获 |
| M10 设置中心 | 标记、面板、默认值、提醒、数据、快捷键、关于（署名 YiChen） |
| M11 更新与分发 | 自动更新、NSIS + dmg/zip、代码签名与 macOS 公证 |
| M12 开源工程化 | LICENSE、双 README、贡献文档、第三方许可、CI |
| M13 质量与测试 | 单元测试、Electron E2E、手动验收矩阵、性能预算 |

明确不做：团队协作、看板/甘特项目管理、账号体系与云端服务端、订阅付费、移动端 App。

## 里程碑

| 里程碑 | 内容 |
|---|---|
| M0 | 项目骨架：electron-vite + TypeScript + React + 主题令牌 |
| M1 | 标记窗口、拖拽、边缘吸附、展开动画、面板壳 |
| M2 | 任务 CRUD、SQLite 数据层、核心视图、快捷键 |
| M3 | i18n 框架、首发 15 语种、多主题、设置页 |
| M4 | 提醒、重复任务、托盘、开机自启、自动更新 |
| M5 | 开源配套、签名打包、v1.0 发布 |
| M6 | 差异化功能：自然语言快速添加、贴边自动隐藏、焦点模式、隐私模式 |

## 计划技术栈

Electron（官方稳定版）· electron-vite · TypeScript · React · Tailwind CSS + CSS 变量主题令牌 · Zustand · better-sqlite3 · i18next + ICU MessageFormat · electron-builder · electron-updater · Vitest + Playwright for Electron。

## 文档语言

项目文档目前以**中文为主**（维护者母语）；代码公开后欢迎贡献 `docs/` 的英文翻译。

## 参与贡献

欢迎提 Issue 与 Pull Request。贡献指南、行为准则与安全策略将随第一个代码里程碑一起落地。

## 许可证

[MIT](LICENSE) © 2026 YiChen。

正式分发包内包含 Electron / Chromium / Node.js，其许可文本必须随包分发，将在首个公开版本起列入 `THIRD_PARTY_NOTICES`。

## 作者

YiChen · GitHub [@2268027569](https://github.com/2268027569) · 仓库：[2268027569/DoList](https://github.com/2268027569/DoList)
