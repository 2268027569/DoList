# 安全策略 · Security Policy

> **English summary.** YiChen ToDo is a local-first desktop app with no server side and no account system, so the main
> attack surface is the distributed binary, the Electron shell and local data handling. Please do not open a public
> issue for security problems — report them privately via GitHub Security Advisories (or a private message to the
> maintainer) and expect a reply within about 7 working days.

## 支持的版本

目前**尚无公开发布版本**，项目处于规格阶段。版本发布后，仅对最新稳定版提供安全修复；预发布（beta）版本不承诺修复。

| 版本 | 支持状态 |
|---|---|
| 最新稳定版 | 提供安全修复 |
| beta / 预发布 | 不提供安全修复 |
| 更早版本 | 建议升级到最新版 |

## 如何报告漏洞

**不要**在公开 Issue、讨论区或社交媒体中披露安全问题。

推荐渠道（按优先级）：

1. **GitHub Security Advisory（推荐）**：[私有上报入口](https://github.com/2268027569/DoList/security/advisories/new)
2. **私下联系维护者**：通过 GitHub 私信 [@2268027569](https://github.com/2268027569)

报告中请尽量包含：

- 受影响的版本或提交号，以及操作系统与版本；
- 问题类型（例如命令注入、任意文件读写、权限提升、数据泄露、签名/更新链路问题）；
- 完整复现步骤，最好是可执行的最小示例或复现工程；
- 影响评估：攻击者能做什么、需要什么前置条件（是否需要本地访问、是否需要用户交互）；
- 如有修复建议或 PoC，请一并附上。

**响应预期**：约 7 个工作日内确认收到并给出初步判断。修复完成后会在 [CHANGELOG.md](CHANGELOG.md) 与 Release Notes 中披露（在补丁发布之后，并在与你商定披露时间的前提下）。欢迎在发布后署名致谢，除非你希望匿名。

## 不在受理范围

- **Electron / Chromium / Node.js 上游漏洞**：请直接上报 [Electron](https://github.com/electron/electron/security) 或 Chromium 官方；本项目只能通过升级依赖间接修复。
- **需要用户设备已被完全控制才能触发的问题**：此类场景不在威胁模型内。
- **第三方同步网盘（OneDrive / Dropbox / 坚果云等）自身的安全问题**。
- **无账号体系相关的"漏洞"**：本项目没有账号、没有服务端、没有云端 API，因此不存在账号接管、越权接口一类问题。
- **缺少"防病毒/离线加密"类功能请求**：这属于功能建议，请走功能建议模板，不作为安全漏洞处理。

## 安全设计基线

从第一个可运行版本起，项目承诺：

- **本地优先、零遥测**：默认不采集、不上报任何使用数据；数据保存在本地 SQLite 中。
- **Electron 安全基线**：`contextIsolation: true`、`sandbox: true`、禁用 `nodeIntegration`、渲染层通过 preload 白名单与主进程通信，并设置严格 CSP。
- **外部输入校验**：所有来自渲染层、剪贴板、协议唤起（`yichen-todo://`）、拖放与文件导入的数据在主进程侧做类型与边界校验。
- **分发完整性**：Windows 安装包使用代码签名证书，macOS 使用 Developer ID 签名并公证（notarization）；自动更新走 HTTPS 校验。
- **依赖治理**：锁定依赖版本（lockfile 入库），并定期做依赖漏洞审计（`npm audit` / Dependabot）。
- **数据可迁移但不外泄**：导出包与本地数据库只写入用户指定目录，不主动上传任何位置。

## 致谢

在获得许可的前提下，安全报告者会被列入发布说明的致谢名单。感谢所有帮助这个项目变得更安全的人。
