# 第三方许可与署名 · Third-Party Notices

> **English summary.** This file lists the third-party components YiChen ToDo builds upon, with their licenses.
> It is a **planning placeholder**: no dependency is installed yet. Once the code scaffold exists, the file will be
> regenerated automatically from the lockfile (`npm run notices`), and the full license texts of Electron, Chromium
> and Node.js must be bundled with every distributed installer.

## 为什么要保留这个文件

本项目以 MIT 许可证发布，但**分发安装包**时捆绑了 Electron、Chromium 与 Node.js，这些组件的许可证要求随二进制包一并提供其版权声明与许可文本。删除本文件或发布不带这些文本的安装包都会构成许可证违规。

因此：**从第一个公开安装包起，`THIRD_PARTY_NOTICES` 必须随包分发**，并同时在本仓库保留完整文本。

## 当前状态

**尚未安装任何依赖**（项目处于规格阶段）。下表是计划使用的组件清单，用于提前梳理授权关系；具体的版本号与完整许可文本将在脚手架落地后由脚本依据 lockfile 生成，以实际安装包为准。

## 运行时依赖（随安装包分发，需附带许可文本）

| 组件 | 用途 | 许可证 | 备注 |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) | 桌面应用运行时 | MIT | 其许可文本必须随包分发 |
| Chromium（随 Electron 分发） | 渲染引擎 | BSD-3-Clause 及多项第三方许可 | 需附带 Chromium 完整许可清单 |
| [Node.js](https://github.com/nodejs/node)（随 Electron 分发） | 运行时 | MIT 及多项第三方许可 | 需附带 Node.js 许可与依赖文本 |
| [React](https://github.com/facebook/react) | 界面渲染 | MIT | |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 本地数据库 | MIT | 内含 SQLite（Public Domain） |
| [i18next](https://github.com/i18next/i18next) / [react-i18next](https://github.com/i18next/react-i18next) | 国际化 | MIT | |
| [Zustand](https://github.com/pmndrs/zustand) | 状态管理 | MIT | |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | 样式工具链 | MIT | 仅构建期参与，产物为 CSS |
| [electron-updater](https://github.com/electron-userland/electron-builder) | 自动更新 | MIT | |

## 开发与构建依赖（不随安装包分发）

| 组件 | 用途 | 许可证 |
|---|---|---|
| [TypeScript](https://github.com/microsoft/TypeScript) | 类型系统 | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) / [electron-vite](https://github.com/alex8088/electron-vite) | 构建与开发服务器 | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 打包与签名 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 单元测试 | MIT |
| [Playwright](https://github.com/microsoft/playwright) | E2E 测试 | Apache-2.0 |
| [ESLint](https://github.com/eslint/eslint) / [Prettier](https://github.com/prettier/prettier) | 代码规范与格式化 | MIT |
| [license-checker](https://github.com/davglass/license-checker) | 生成本文件 | BSD-3-Clause |

## 字体与素材

| 资源 | 用途 | 许可证 | 备注 |
|---|---|---|---|
| Inter | 界面文字（拉丁/数字） | SIL OFL-1.1 | 需保留许可证文本，允许再分发 |
| Noto Sans 系列 | 多语种回退字体（含阿拉伯语、泰语等） | SIL OFL-1.1 | 建议做子集化以控制体积 |
| 思源黑体 Source Han Sans | 中日韩回退字体 | SIL OFL-1.1 | 同上 |
| 应用图标与界面插画 | 品牌与界面图形 | 自有版权（© 2026 YiChen） | 必须自绘或使用明确授权的素材 |

不使用任何来源不明、许可证缺失的图标、插画或字体。

## 维护方式

脚手架落地后，本文件将由脚本自动生成，人工只维护"字体与素材"一节：

```bash
npm run notices   # 依据 lockfile 生成第三方许可清单
```

CI 会增加检查项，确保每次发布前本文件与依赖树一致。
