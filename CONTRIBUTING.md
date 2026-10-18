# 贡献指南 · Contributing

> **English abstract.** Thanks for helping. This project is at the specification stage — there is no code to compile
> yet, so the most useful contributions today are bug reports, scope discussions and translations. Once the code
> scaffold lands (M0), code contributions follow Conventional Commits, must pass CI (`lint` / `typecheck` / `test` /
> `i18n:check`) and carry a DCO sign-off. Full details below are Chinese-first.

感谢你愿意参与。先读这份指南，能省下很多来回沟通的时间。

## 目录

- [项目现状](#项目现状)
- [报告问题](#报告问题)
- [提议功能](#提议功能)
- [参与翻译](#参与翻译)
- [代码贡献流程](#代码贡献流程)
- [代码与提交规范](#代码与提交规范)
- [安全漏洞](#安全漏洞)
- [许可与贡献者协议](#许可与贡献者协议)

## 项目现状

目前处于**规格阶段**：功能范围已确定在 [docs/FEATURES.md](docs/FEATURES.md)，代码脚手架（M0）尚未创建，因此**暂时无法编译或运行**，也没有安装包。

现阶段最有价值的贡献：

1. 对功能范围与优先级的讨论（哪些该进 MVP、哪些该砍）；
2. 翻译与语言质量审查（15 种首发语言）；
3. 桌面端体验细节的建议（标记形态、动画节奏、多显示器行为）。

## 报告问题

- 使用 [Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.yml) 提交，并尽量填写版本号、操作系统、复现步骤与日志。
- **先搜索现有 Issue**，重复问题会被合并。
- 日志请先移除个人隐私内容（任务标题、文件路径、邮箱等）。
- 一个 Issue 只描述一个问题。

## 提议功能

- 使用 [功能建议模板](.github/ISSUE_TEMPLATE/feature_request.yml)。
- 提案前请先读 [docs/FEATURES.md](docs/FEATURES.md)：范围、优先级（P0/P1/P2）与"明确不做"都写在那里。
- 与"明确不做"冲突的提案（团队协作、云端账号、看板/甘特项目管理等）默认不接受，除非你先说服维护者修改产品定位。
- 新功能请说明它解决什么真实场景问题，而不是"别人有所以也要有"。

## 参与翻译

这是目前门槛最低、收益最大的贡献方式。

- 语言包位置：`locales/<bcp47>/`（脚手架落地后创建），例如 `locales/zh-Hans/`、`locales/zh-Hant/`、`locales/en/`、`locales/ar/`。
- 首发语言：中简、中繁、英、日、韩、西、法、德、俄、葡、意、阿（RTL）、越、泰、印尼。
- Key 命名：语义化、英文小写点分，如 `task.due.label`；**禁止**用中文或界面文案当 key。
- 复数、序数、相对时间必须使用 ICU MessageFormat（`{count, plural, ...}`），不要硬编码"1 个任务 / 3 个任务"。
- **不要修改占位符**（`{name}`、`{count}` 等），也不要调整 ICU 结构；只翻译可见文案。
- 阿拉伯语等 RTL 语言需同时检查布局镜像是否正常（CSS 逻辑属性、图标镜像）。
- CI 会校验各语言 key 是否齐全（`npm run i18n:check`）；缺失 key 会回落英文，并在 CI 中报错。
- 新增语言：复制 `locales/en/` 作为模板，保留目录名与 key 结构，在 PR 中说明语言代码与本地化注意事项。

## 代码贡献流程

1. 先提 Issue 讨论，达成一致再动手（避免写完被拒）。
2. 从 `main` 拉分支，命名：`feat/xxx`、`fix/xxx`、`docs/xxx`、`i18n/xxx`、`chore/xxx`。
3. 小步提交，**一次提交只做一件事**，便于 review 与回滚。
4. 每个提交使用 `git commit -s` 带上 `Signed-off-by`（见下节 DCO）。
5. 发起 PR，填写 PR 模板；涉及 UI 的改动请附截图或录屏。
6. 必须通过 CI：`lint`、`typecheck`、`test`、`i18n:check`（脚手架落地后生效）。
7. 维护者 review 通过后合并；不接受未经讨论的大范围重构。

## 代码与提交规范

- 语言：TypeScript 严格模式（`strict: true`），不使用 `any` 规避类型问题。
- 风格：ESLint + Prettier，提交前本地跑一遍；不要提交被注释掉的死代码。
- 命名：文件名与目录用小写中划线；变量、函数用 camelCase；类型/组件用 PascalCase；常量用 UPPER_SNAKE_CASE。
- 注释：公共 API、复杂算法与平台差异处必须写注释；注释与文档注释建议使用英文，便于国际贡献者阅读（Issue/PR 用中文或英文都可以）。
- 提交信息：**Conventional Commits**（英文），类型限定 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`i18n`。

```
feat(marker): 支持标记边缘吸附与位置持久化
fix(reminder): 修复休眠唤醒后错过提醒的问题
docs(readme): 补充 macOS 公证说明
i18n(zh-Hans): 补齐设置页缺失文案
```

- 破坏性变更：在提交信息中用 `!` 标记（如 `feat(api)!: ...`），并在 PR 中说明迁移方式。
- 版本与日志：遵循 [语义化版本](https://semver.org/lang/zh-CN/)，用户可见的变更必须写入 [CHANGELOG.md](CHANGELOG.md)。

## 安全漏洞

**不要**在公开 Issue 中披露安全问题，请按 [SECURITY.md](SECURITY.md) 的流程通过私有渠道上报。

## 许可与贡献者协议

- 本项目采用 [MIT 许可证](LICENSE)，`Copyright (c) 2026 YiChen`。
- 所有贡献默认以 MIT 许可证授权（inbound = outbound），请在提交时使用 `git commit -s` 附上 `Signed-off-by`，即表示同意 [Developer Certificate of Origin](https://developercertificate.org/)（DCO）。
- 若未来引入双许可等需要额外授权的模式，会在本文件与 PR 模板中提前说明，不会追溯既往贡献。

## 行为准则

参与本项目即代表同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

有任何流程上的疑问，直接在 Issue 或 PR 里问即可，不用客气。
