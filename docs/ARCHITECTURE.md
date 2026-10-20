# M0 技术方案 · Architecture

> **English abstract.** This document is the technical plan for milestone M0 of YiChen ToDo: process and window
> architecture, repository layout, dependency policy, SQLite schema and migrations, IPC contract, theme tokens, i18n
> integration, the marker-window implementation strategy, performance budgets, security baseline, build/release setup
> and test strategy. It describes decisions, not code. Marker-window specifics (M01) are included because they
> determine the project skeleton.

- **状态**：待评审（尚未写代码）
- **范围**：[docs/FEATURES.md](FEATURES.md) 中 M0 骨架规划，外加 M01 的实现约束
- **前置决策**：MIT · `YiChen ToDo`（`com.yichen.todolist`）· Windows + macOS · SQLite · 15 语种 · 多主题 · 文件夹同步
- **变更方式**：本文件是设计契约。实现与本文不一致时，先改本文再改代码

---

## 1. 技术选型

| 领域 | 选型 | 理由 |
|---|---|---|
| 运行时 | Electron（官方稳定版，跟随最新 stable） | 一套代码覆盖 Windows + macOS；透明窗口、置顶、跳过任务栏等桌面能力齐备 |
| 构建 | electron-vite（Vite 驱动） | 主进程 / preload / 渲染层三端统一构建，热更新快，产物结构清晰 |
| 语言 | TypeScript（`strict: true`） | 主进程、IPC、数据层都是强类型契约，减少运行时错误 |
| 界面 | React（函数组件 + Hooks） | 面板界面复杂（视图、拖拽、列表虚拟化），生态成熟 |
| 样式 | Tailwind CSS + CSS 变量三层令牌 | Tailwind 只消费语义令牌，主题切换靠切换变量，不写 `dark:` 分支 |
| 状态 | Zustand（少量 store，按域拆分） | 体积小、无 Provider 嵌套，适合桌面面板 |
| 数据库 | better-sqlite3（同步 API） | 单进程本地库，同步调用最省心、事务简单、性能好 |
| 国际化 | i18next + i18next-icu | 复数 / 序数 / 相对时间可表达，语言包与代码解耦 |
| 打包分发 | electron-builder（nsis / portable / dmg / zip） | 三平台产物、签名、公证、自动更新一体 |
| 自动更新 | electron-updater + GitHub Releases | 与 electron-builder 天然配合，无需自建更新服务 |
| 测试 | Vitest（单元）+ Playwright（Electron E2E） | 数据层与纯函数用单元测试，窗口行为用 E2E |

**版本策略**：不追新、不预发版；Electron 固定在一个稳定大版本上，升级前先在 Windows 与 macOS 各跑一次验收矩阵。所有依赖通过 lockfile 锁定，升级走 Dependabot / Renovate 的 PR，逐条 review。**本文件不写具体小版本号**，以脚手架落地当天的最新稳定版为准，避免文档过期。

---

## 2. 目录结构

```
toDoList/
├─ src/
│  ├─ main/                        # 主进程（Node 环境）
│  │  ├─ index.ts                  # 启动编排：单实例、协议、托盘、快捷键
│  │  ├─ windows/
│  │  │  ├─ marker.ts              # 标记窗口：创建、拖拽、吸附、贴边隐藏
│  │  │  ├─ panel.ts               # 面板窗口：展开/收起、失焦隐藏、定位
│  │  │  ├─ detail.ts              # 详情窗口：开在面板旁、跟随标记、面板收起时一并关闭
│  │  │  ├─ reminder.ts            # 提醒弹窗：每实例一扇窗、不抢焦点
│  │  │  └─ window-state.ts        # 位置与尺寸持久化、多显示器纠偏
│  │  ├─ ipc/
│  │  │  ├─ register.ts            # 统一注册器：channel → handler + 校验
│  │  │  └─ handlers/              # 按域拆分：task / list / tag / settings / window / sync
│  │  ├─ db/
│  │  │  ├─ connection.ts          # WAL、pragma、事务封装
│  │  │  ├─ migrations/            # 0001_init.sql … 版本化迁移
│  │  │  └─ repositories/          # tasks / lists / tags / reminders / settings
│  │  ├─ services/
│  │  │  ├─ scheduler.ts           # 提醒调度（单一时间源，非轮询）
│  │  │  ├─ recurrence.ts          # RRULE 展开与下一次实例
│  │  │  ├─ sync/                  # 文件夹同步：导出/导入/冲突合并
│  │  │  ├─ backup.ts              # 快照、保留策略、恢复
│  │  │  └─ updater.ts             # 自动更新
│  │  └─ platform/                 # win / mac 差异封装（通知、托盘、置顶行为）
│  ├─ preload/
│  │  ├─ index.ts                  # 白名单 API 暴露（contextBridge）
│  │  └─ index.d.ts                # 渲染层可见的类型声明
│  ├─ renderer/
│  │  ├─ panel/
│  │  │  ├─ index.html
│  │  │  └─ src/                   # React 应用：视图、任务编辑、设置
│  │  ├─ marker/
│  │  │  ├─ index.html
│  │  │  └─ src/                   # 纯 DOM + CSS 实现（不引入 React）
│  │  └─ shared-ui/                # 跨窗口复用的样式与工具（非 React 亦可）
│  ├─ shared/                      # 主进程与渲染层共用的纯逻辑
│  │  ├─ types/                    # Task、List、Tag、Settings、IPC 载荷
│  │  ├─ contracts/                # IPC 通道常量与 zod schema
│  │  ├─ theme/tokens.css          # 三层令牌定义
│  │  ├─ i18n/format.ts            # Intl 封装（日期、相对时间、数字、周起始日）
│  │  └─ utils/                    # 纯函数：吸附计算、RRULE、排序
├─ locales/                        # 语言包：locales/<bcp47>/<namespace>.json
├─ resources/                      # 应用图标、托盘图标（win/mac 各一套）
├─ build/                          # electron-builder 配置、entitlements、签名资源
├─ scripts/                        # i18n:check、notices 生成、版本同步
├─ docs/                           # FEATURES.md、ARCHITECTURE.md
└─ .github/                        # CI、Issue/PR 模板
```

**两条结构性决定**：

1. **四个渲染入口**（`panel/index.html`、`marker/index.html`、`reminder/index.html`、`detail/index.html`），不做单入口路由。标记页零依赖 React、零依赖 i18next，只加载约 23 kB 的 DOM + CSS + 静态文案，保证常驻内存与 CPU 最低。提醒弹窗（M04）是第三个入口，也是一个独立窗口的页面：它只在提醒无人应答时出现，不跟着面板常驻，所以单列一份而不是塞进面板里（§5.3.2）。任务详情（M02 D6 改版）是第四个入口：它开在面板**旁边**而不是替换面板内容，两扇窗是两个渲染进程，因此必须各有一个页面（§9.1.2）。

   M0 实测产物：`marker.js 5.26 kB + marker.css 7.78 kB`（另需共享 i18n chunk 85.26 kB）、`panel.js 587.45 kB + panel.css 19.74 kB`、`main 377.85 kB`、`preload 3.36 kB`。

   M01 实测产物：常驻标记路径为 `marker.js 7.15 kB + marker.css 10.98 kB + common chunk 5.10 kB = 23.23 kB`（形态/角标/进度环与拖拽桥都在其中），i18next 已完全移出常驻路径，只随面板打包（`panel.js 587.45 → 673.04 kB`、`panel.css 19.74 → 21.80 kB`）；`main 384.07 kB`、`preload 3.74 kB`。ICU 打包（78.13 kB，`es-*.js`）仍由 i18next-icu 动态 import 承担，只有面板与提醒弹窗按需加载。

   M04 实测产物：`reminder.js 12.55 kB + reminder.css 31.41 kB`（React + 共享 UI 层 + 粒子特效），`main 513.88 kB`、`preload 10.97 kB`、`panel.js 88.34 kB + panel.css 32.13 kB`（面板此后按 chunk 拆分，`format-*.js 668.64 kB` 为共享 chunk）。

   M02 D6 改版实测产物：`detail.js 48.28 kB + detail.css 32.37 kB`（表单从面板搬出后的独立入口，与 `panel.js 45.86 kB` 同量级，React 与格式化仍是共享 chunk），`main 526.37 kB`、`preload 11.74 kB`。
2. **`src/shared` 只放纯函数与类型**，不 import `electron`、不 import Node 内置模块；这样吸附算法、RRULE、格式化函数可以直接被 Vitest 单测覆盖，也能被四个渲染入口共用。

---

## 3. 进程与窗口架构

```
                   ┌──────────────────────────────────────────┐
                   │           主进程 Main Process            │
                   │  单实例 · 托盘 · 快捷键 · 提醒调度 · DB   │
                   └───────┬──────────────────────┬───────────┘
             ipcMain.handle│                      │webContents.send
                   ┌───────▼──────┐        ┌──────▼───────────┐
                   │  标记窗口     │        │   面板窗口        │
                   │  28×28 透明   │◀─点击──▶│ 360–420 宽 React │
                   │  纯 DOM/CSS   │        │ 失焦自动收起      │
                   └──────────────┘        └──────────────────┘
                        ▲                          ▲
                        └──── preload 白名单 ───────┘
```

| 维度 | 标记窗口 | 面板窗口 |
|---|---|---|
| 渲染内容 | 纯 DOM + CSS（唯一例外：进度环用 `conic-gradient`） | React 应用 |
| 常驻 | 常驻（应用的心跳） | 按需 show/hide，不销毁（除非省电模式空闲销毁） |
| 任务栏 | `skipTaskbar: true` | `skipTaskbar: true`（全程靠托盘与快捷键访问） |
| 焦点 | `focusable: false`（不抢焦点） | 正常可聚焦，`blur` 后延迟收起 |
| 层级 | 置顶 | 置顶（写死，无开关） |

**为什么两个窗口都不进任务栏**：应用定位是"隐形"，任务栏出现条目会立刻破坏这个定位；常驻托盘图标 + 全局快捷键已能满足"随时可达"。这也避免了 Windows 上任务栏图标闪烁与 macOS Dock 常驻的观感问题。

**面板的视图切换只有一处**（M03 D1）：侧栏是一条 48 DIP 的窄图标条——图标是自绘内联 SVG，用 `currentColor` 跟随按钮状态，不为"选中色"再引一个令牌；头部只写当前清单名（大字号）与计数，不再放 tab。面板本身只有 320–640 DIP 宽，并排两栏会把两栏都挤到不可读（M02 D6 是同一条理由），所以侧栏取"常驻的窄条"而不是宽侧栏或覆盖式抽屉：窄到只剩图标，切换零额外点击，也不遮住列表。侧栏**不显示计数**——六个清单一轮就是六次查询，而当前这个的数字头部已经说了。

**应用菜单只有一处定义**（M02 §8，S8）：`main/platform/app-menu.ts` 既给托盘图标挂上下文菜单，也给标记的右键弹出——两个入口、一份列表。菜单的文案取自主进程的 i18n 实例，动作是开窗口或退出应用，因此菜单**整个住在主进程**；标记渲染层只发一次"我被右键了"（`marker:context-menu`），既不拼文案也无从伪造动作。

---

## 4. 依赖清单

仅列计划使用的一级依赖与归属。**原生模块与需要在运行时从 `node_modules` 读取资源的包放在 `dependencies`**，其余（会被打包进前端 bundle 的库）放 `devDependencies`，以减小安装包体积。

### 运行时（`dependencies`）

| 包 | 用途 | 备注 |
|---|---|---|
| `better-sqlite3` | 本地数据库 | **Node-API 原生模块**（通过 `node-addon-api`）：ABI 无关，Electron 与开发机的 Node 加载同一份 prebuild，故 `prepare` 里的 `install-app-deps` 不是 ABI 重建而是 `asarUnpack` 等打包准备；打包仍需 `asarUnpack`（M02 S0 实测更正，见 §12） |
| `electron-updater` | 自动更新 | 主进程使用，保留在 `node_modules` 中由其自行处理更新清单 |

### 开发与构建（`devDependencies`）

| 包 | 用途 |
|---|---|
| `electron` | 运行时本体 |
| `electron-vite` / `vite` | 构建与开发服务器 |
| `typescript` | 类型系统 |
| `react` / `react-dom` | 面板界面 |
| `tailwindcss` / `postcss` / `autoprefixer` | 样式工具链 |
| `zustand` | 渲染层状态 |
| `i18next` / `react-i18next` / `i18next-icu` | 国际化 |
| `zod` | IPC 载荷与设置项校验（主进程 + shared） |
| `date-fns`（或 `luxon`） | 日期计算与 RRULE 辅助（纯函数、可测） |
| `electron-builder` | 打包、签名、公证 |
| `vitest` / `@vitest/coverage-v8` | 单元测试 |
| `playwright`（`@playwright/test`） | Electron E2E |
| `eslint` / `prettier` / `typescript-eslint` | 规范与格式化 |
| `license-checker` | 生成 `THIRD_PARTY_NOTICES` |
| `@electron/fuses` | 构建期收紧 Electron 能力开关（见 §11） |

**被明确否决的依赖**：任何 UI 组件库（Ant Design / MUI 等）——它们体积大、主题模型与本项目的令牌体系冲突；任何要求联网/账号的 SDK；任何遥测 SDK（含崩溃上报，默认关闭且不集成商业服务）。

---

## 5. 数据层设计

### 5.1 关键约定

- 主键用 **UUID v7**（时间有序），便于同步时跨设备不冲突、索引局部性好；不用自增整数。
- 时间统一存 **Unix 毫秒（UTC）整数**；"今天"的判定交给渲染层用 locale + 时区计算，数据库不存本地日期字符串。
- 全部业务表带 `updated_at`（LWW 合并依据）与 `deleted_at`（软删 + 同步墓碑）。
- 迁移版本存在 `meta` 表，迁移文件不可修改，只追加；每次启动检查并顺序执行。
- 连接开启 `journal_mode = WAL`、`foreign_keys = ON`、`synchronous = NORMAL`、`busy_timeout = 5000`。

M02 把下面几条写进了仓储层（`src/main/db/repositories/`），而不是只写在文档里：

- **子任务只允许一层**：`parent_id` 指向的任务自身必须是顶层、且不在回收站；创建时校验，不依赖界面的约束。
- **子任务跟随父任务**：完成父任务不级联子任务；软删父任务时子任务在同一事务内一并软删，恢复时只带出**墓碑时间戳相同**的子任务——单独删过的那个留在回收站。
- **一次写入一个事务**，并返回受影响行数，供撤销栈（M02 D7）与变更事件（M02 D4）使用。
- 行 id 由 `shared/utils/id.ts` 的 `newId()` 生成 UUID v7；`now` 由调用方传入而非各写路径自己读时钟，这样同一动作的多次写入共享时间戳，测试也可确定。
- `sort_order` 是**组内**序号：顶层任务按 `list_id` 分组、子任务按 `parent_id` 分组；只有插入到中间时整体重排（M02 D3）。
- `sort_order` 在组内**始终是干净的 `0…n-1`**，且只有位置真的变了的行才会被写（`updated_at` 不动，M08 靠它判冲突）。`reorderTasks` 允许只点名一部分行——面板发的就是它画出来的那些，组里没点名的（例如收件箱过滤掉的已完成行）按原序排到末尾；只写被点名的行会让它们占住中间位置、两行拿到同一个 `sort_order`，同时显示完成与未完成的视图就会画出不确定的顺序。
- **重复规则存 RFC 5545 property list**（`repeat_rule`），写入口就校验（`shared/utils/recurrence.ts` 的 `isValidRule`）：`rrule` 认不出的规则一律拒绝，不落库，于是不存在"存进去却永不重复"的任务。`repeat_mode`（`fixed` / `after_completion`）决定模式锚在原到期还是完成当天。
- **勾选完成即生成下一次实例**（M02 D10）：`updateTaskFromPatch` 在同一个写动作里建出新行，因此一次用户动作的 `change.ids` 会**出现两行**（旧实例 + 新实例），撤销栈与标记重算都按整个效果记。新实例只继承"这件事是什么"（标题 / 清单 / 父任务 / 备注 / 优先级 / 标签 / 预估 / 提前提醒 / 规则），不继承子任务、实际耗时与完成时间——清单是这次要做的，不是下一次已经做过的。
- **撤销栈存的是"要放回的行"的快照**（M02 D7）：条目不是逆操作、而是一组 `{ id, before, tags }`——`before` 为 `null` 表示这行是**新建**的（撤销即软删它），否则按快照整行回写（`restoreTask`，带上它在改动前的标签集）。一次用户动作 = 一条条目（批量命令一条、勾选生成下一次的旧+新两行一条），所以一次 `Ctrl+Z` 收回的是整个效果。栈在内存、上限 30、进程退出即失效；`popUndo` 是**消费式**弹出（不压回），否则连按 `Ctrl+Z` 会撤销自己的撤销、栈永不空。
- **一次批量命令 = 一次写入 = 一次通知 = 一条撤销条目**（M02 §5）：`bulkTasks` 内部循环调用单行的 `applyPatch` 后再**统一**压一条撤销条目，所以选择集多大都只让标记重算一次、只让面板重取一次；`delete` 与单行走**同一条软删级联**路径。
- **附件是复制进来的，不是引用**（M02 §6，M03 S3）：点「添加文件」后主进程把选中的文件**复制**到 `<userData>/attachments/`，库里 `path` 存的是**副本**路径，副本名是 `newId()` + 源文件扩展名（同一轮里两个同名文件不会互相覆盖，系统仍按正确类型打开），行里展示的 `name` 存**源文件的** basename——用户认得的是自己选的那个文件名。`size` 存复制时的实测值，不是每次 `statSync` 现读：`attachments` 行描述的是将要被打开的那个副本，而副本由 app 自己产生、不会自己变化。删除附件行时**连带删掉这份副本**，但只删 `attachments/` 目录**直属**下的路径（`dirname(resolve(path)) === resolve(dir)`）——从旧 profile 恢复或手写进去的行可能指向用户的文件，点一下"移除"不该删掉别人的文档。源文件始终归用户所有，只读不动。
  - 为什么不再只存引用：用户整理一下选文件时所在的目录，那条引用就断了；更关键的是 M10 的文件夹同步只搬 app 自己的目录，引用带不走——"附件跟着任务走"这件事只有副本能兑现。代价是同一份文件在磁盘上有两份，这是明确接受的交换。
  - 渲染层**永远不发路径**，只能点按钮让主进程弹 `dialog` 选择器；`shell.openPath` 也只在 IPC handler 里——服务层因此不 import electron、可单测（目录由 IPC 层传进去）。
- **缩略图是另一条通道，不是行上的字段**（M03 S3）：图片附件的预览走 `attachment:thumbnail`（id → data URL | null），不与 `attachment:list` 混在一起——预览是两者中唯一的大负载，非图片行根本不需要它。主进程先问平台自己的缩略图器（Windows shell provider / macOS Quick Look，`nativeImage.createThumbnailFromPath`，正好只有这两个平台），平台拒绝时退回自己解码并缩到 128px（`data URL` 全长要过一个 IPC 字符串，不缩会是几 MB）；两条路都拿不到东西就回 `null`，面板据此画文件行而不是空卡片。是否是图片由 `shared/utils/attachment.ts` 的 `isImageName` 一处判断，主进程与渲染层共用同一个答案。
- **视图是过滤条件，不是另一份数据**（M02 §6，M03 §2）：面板只存一个 `view`，六个视图（收件箱 / 今天 / 明天 / 即将到期 / 已完成 / 已取消）是同一个查询换 `filterFor(view)`——切换即重取，行不复制、也不缓存。所以菜单的「今天」项与侧栏落在同一个字段上，两条路径不可能得到两种状态。M03 S1 起切换视图只有**一个入口**：两个控件写同一个状态，用户分不清哪个才是"当前"，点谁都会再动一次。
- **归档视图是同一条查询换状态，不是新表**（M03 D5）：已完成 = `status: done` + `completed_at DESC` 排序，已取消 = `status: cancelled`。「已完成」里点勾 = 回到 `todo`——不记录完成前是什么状态，那要每行多存一个字段、在所有写入口维护它，为一个能手动改回去的差别不值；「已取消」里不给勾钮，改状态走详情面板。

### 5.2 表结构

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  list_id        TEXT REFERENCES lists(id) ON DELETE SET NULL,
  parent_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'todo',   -- todo | doing | done | cancelled
  priority       INTEGER NOT NULL DEFAULT 0,     -- 0 无 1 低 2 中 3 高
  due_at         INTEGER,                        -- 到期时刻（UTC ms）
  due_has_time   INTEGER NOT NULL DEFAULT 0,     -- 0 = 仅日期，1 = 含时刻
  repeat_rule    TEXT,                           -- RFC 5545 RRULE
  repeat_mode    TEXT,                           -- fixed | after_completion
  estimate_min   INTEGER,
  actual_min     INTEGER,
  remind_lead_min INTEGER,                       -- 提前 N 分钟提醒；NULL = 不提醒（M02 加列）
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  completed_at   INTEGER,
  deleted_at     INTEGER
);

CREATE INDEX idx_tasks_status_due ON tasks(status, due_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_list_sort  ON tasks(list_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_parent     ON tasks(parent_id);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE reminders (            -- 提醒实例：重复任务每次触发都是独立一行
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  fire_at      INTEGER NOT NULL,
  state        TEXT NOT NULL DEFAULT 'pending',  -- pending | fired | snoozed | dismissed
  snooze_until INTEGER
);

CREATE INDEX idx_reminders_fire ON reminders(state, fire_at);

CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,        -- 指向 <userData>/attachments/ 下的副本，不做云上传
  name       TEXT,                 -- 源文件的 basename（用户认得的名字）
  size       INTEGER,              -- 复制时的实测字节数
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (             -- 单行 KV，含窗口位置、主题、locale、快捷键
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,         -- JSON 编码
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_journal (         -- 文件夹同步的变更日志（只增不改）
  seq       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL,          -- task | list | tag | setting
  entity_id TEXT NOT NULL,
  op        TEXT NOT NULL,          -- upsert | delete
  device_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 5.3 为什么需要 `reminders` 独立表

重复任务不能只存一个 `remind_at`：每次展开出来的是**独立实例**，需要各自的状态（已触发/已稍后/已忽略）。把"下一次触发时间"算在调度器里，把已生成的实例落到 `reminders`，能让"稍后提醒"、"错过的提醒"、"休眠唤醒后补发"三件事都有明确的数据落点。

M04 把下面几条写进了代码（`src/main/db/repositories/reminders.ts` + `src/main/services/tasks.ts`），而不是只写在文档里：

- **`reminders` 只存实例，意图在任务行**：用户表达的是「提前 30 分钟」（`tasks.remind_lead_min`），实例是 `fire_at = due_at - lead × 60_000`（`shared/utils/reminder.ts` 的 `fireAtFor`）。两边任一为空就没有实例——提醒是**相对截止时间**定义的，没有截止就没有可回数的时刻，不补一个默认时间。
- **写任务即重算实例**：`services/tasks.ts` 的 `syncReminder` 在一次写动作里把任务的等待实例替换成新推导出的那个；`pending` 的旧实例被删除而非保留，否则用户改了截止时间后会在两个时刻各被叫一次。已完成 / 已取消 / 在回收站的任务**没有等待实例**——提醒一件做完的事是噪音，而且没有哪个更晚的时刻能让它变正确。
- **已经触发过的实例不动**：`state` 一旦离开 `pending` 就是"说过什么"的流水，重算任务不得改写它。`replacePendingReminder` 因此只碰 `pending` 行。
- **刚过去不久的时刻仍然武装**：`armableFireAt` 在 `fireAtFor` 之上加一条宽容规则——未来的时刻照收；**已经路过、但不超过 6 小时**的也落库，落在过去的那一刻上，于是调度器给它排一个 delay 为 0 的定时器，下一刻就开口。这一条是为了「5 分钟前提醒」在 18:47 设置、而其时刻（18:45）已经被走过去时不被静默丢弃：丢掉它，用户得到的是一个永远不会到的提醒，任务行看起来却完全正常。超过 6 小时的时刻直接不武装——那是上面「错过」那条的另一半，同一个 `REMINDER_GRACE_MS` 读两次。
- **删除连带清除**：`deleteTasks` 在同一次写入里清掉被墓碑的那批任务（含级联子任务）的等待实例；撤销一个新建也走同一路径。回收站里的任务不该还在被播报。
- **逾期不足 6 小时的才算"错过"**：调度器启动时把 `fire_at < now - 6h` 的 `pending` 行置为 `dismissed` 而不是补发。晚几小时说还有意义；晚几天说没有——任务本身已经在视图里显示逾期，一串关于上周的通知只会训练用户忽略全部提醒。
- **一个任务同时只有一个等待实例**：`MIN(fire_at)` 就是调度器要排的下一刻，没有第二处需要去重。
- **实例是派生数据，启动时重建**：只有写动作会重算实例，所以「写完任务、还没写实例」之间进程若死掉，留下的是一个永远不会到的提醒，而任务行看起来完好无损。`services/tasks.ts` 的 `reconcileReminders` 在启动时问出「当前时刻还没有任何实例替它站着的开放任务」（`tasksMissingReminderInstance`），逐个重算。某个时刻已经有实例的行不会被返回——等待中的属于调度器，已经说过的不得再说，所以这一遍既补得上、也不会重播。

### 5.3.1 调度器：单一时间源，非轮询

`src/main/services/scheduler.ts` 是提醒的唯一时间源：读出最近的 `fire_at`，排**一个** `setTimeout`，触发后重排。**不轮询**——一个三天后才响的提醒，让应用可以真的闲着，这正是标记窗口能是一个 23 kB DOM 页的前提。`setTimeout` 的毫秒数是 32 位有符号，超过约 24.8 天会溢出成立即触发，所以单次等待被切成 `MAX_TIMER_MS` 的片段，片尾的重排与其他任何一次触发走同一条代码路径。

三件让它可单测的事：

- **服务层不 import electron**（§2 的结构性决定）。交付一个提醒意味着一条系统通知、以及无人应答时的一个内置弹出窗口，但调度器只知道**实例**和它对应的任务；`SchedulerDeps.deliver` 是启动时注入的回调，`src/main/platform/notifications.ts` 才是那个会说 OS 语言的人。于是时序规则可以对着一份真库、一只手工拨动的时钟单测，全程不碰 Electron。
- **时钟可注入**（`now`），**定时器可注入**（`arm`）——测试自己拥有两端，所以断言的是算术与事件顺序，而不是机器跑了多久。
- **数据库就是记忆**：已交付的实例移到 `fired` 并留在那里，重启不会重播；错过的被标成 `dismissed`。【从不重复】这条规则因此不必记在调度器里——它已经是一行数据。

再排一次的时机是 `services/task-events.ts` 的 `notifyTasksChanged`：那是**每一次写入**的唯一必经点，所以调度器不必被任务服务知道，而一次写入既能武装一个提醒也能取消一个，`MIN(fire_at)` 一处覆盖两种。

### 5.3.2 提醒的两段式交付与去重

`src/main/platform/notifications.ts`。一个到点的提醒被说两遍，第二遍是第一遍的沉默换来的：

1. **系统原生通知**（Windows toast / macOS 通知中心）——在人所在的地方开口，且能在应用退到后台时存活；点击即应答，并把面板打开到那个任务。
2. 若数分钟后仍无人应答，再浮出**应用自己的置顶弹窗**（`src/main/windows/reminder.ts` + 第三个渲染入口 `renderer/reminder/`），这是 OS 收不走的那一层。

- **第二遍不是面板**：早先这一层是面板里内嵌的一张卡片，那样面板会为了播报而展开——而这条播报存在的理由恰恰是"用户正在做别的事"（M04 D2）。现在它是**一个独立的小窗口**：`transparent + frameless + alwaysOnTop + skipTaskbar`，每个实例一个窗口，多个同时到点就逐个竖直堆叠，窗口位置与堆叠由 `shared/utils/anchoring.ts` 的 `placeReminderPopup` 纯函数算出（复用 `placePanel` 的停靠边规则，末尾一律夹回工作区），标记拖动时所有弹窗跟着标记走（与面板同一条 `onMarkerMoved` 订阅）。
- **弹窗不抢焦点**：`showInactive()`（而不是 `show()` / `focus()`），因为它是"一条没人应答的通知"的兜底，把光标从用户正在打字的地方夺走正是两段式想要避免的打扰。窗口尺寸与位置**先定好再显示**，缓入动画只动 `opacity` 与 `transform`（`reminder.css`，300ms；退出 180ms），因此没有一帧碰到窗口尺寸——与面板同一条 §7 / §9.1 的纪律。
- **点击「完成」会有一次粒子爆发**：Canvas2D 绘制（`renderer/reminder/src/particles.ts`），约 1.2 秒，颜色取自 `tokens.css` 的 `--burst-*` 令牌（渲染层不写死颜色）。`prefers-reduced-motion` 下整段跳过，但**应答照发**——特效是装饰，不是流程里的一步。特效演完才发应答，所以写入不会和动画抢时间。
- **两者绝不同时说话**：一个提醒是一个实例一行数据，那行数据就是全部的协调——点击 toast 把实例置为 `dismissed`，弹窗定时器开窗时重读那份内存条目（已被应答的条目连同定时器一起被删掉了），于是什么都不再开。反向亦同：应答弹窗时顺带关掉 toast（Windows 上横幅不点会一直留着，留着就是对一件刚处理过的事做第二次、过时的播报）。**关窗写在应答路径里而不是渲染层**：渲染层只上报"我答了"，由 `answerReminder` 一处决定关哪些 OS 对象。
- **提醒域的两条渲染层→主进程通道**（§6.4）：`reminder:dismiss`（只知道读过了，任务不动）与 `reminder:done`（顺手把任务勾成完成）。后者的两次写入——任务状态与实例状态——由 handler 在**同一条命令**里做完并只发一次 `task-events`，和面板自己的勾选是同一条服务层路径；把两件事拆成两个通道会让渲染层有机会只做成一件。
- **弹窗按载荷绘制**：`ReminderDuePayload` 经 `loadRenderer` 的附加查询串（`?reminder=<json>`，为主进程与渲染层共用的解析函数 `parseReminderPopupPayload` 校验）随窗口一起来，于是首帧就是正确的那条提醒，而不必先画一张空卡片等 IPC 回话。它是一条通知，不是数据的一个视图。
- **平台没有通知就只剩弹窗**：`Notification.isSupported()` 在某些 Windows / macOS 会话里为假，此时弹窗仍按同一只定时器到达，而不是被跳过。
- **任务没了就不说**：交付时任务行已不在（在别处被删）则实例直接置为 `dismissed`——一个没有名字可叫的播报比沉默更糟。

M04 P0 落地的档位是 5 / 10 / 30 分钟、1 小时、1 天（`REMIND_LEAD_PRESETS`），详情页把它们画成 chip 并保留原来的数字输入框（`data-field="detail-remind"` 不变，冒烟依赖它）；`leadBucketOf` 决定这个档位该说"分钟 / 小时 / 天"。**Snooze 未实现**：`snooze_until` 列已就位，但弹窗上不提供这个按钮——一个说了却不算数的按钮比没有更糟（P2）。

### 5.4 迁移与备份

- 迁移：`src/main/db/migrations/0001_init.sql` 起顺序编号；启动时在事务内执行，失败则回滚并弹错误页（不静默继续）。
- 备份：每次启动后与每 24h 各做一次快照（`VACUUM INTO` 生成单文件），保留最近 N 份（默认 7），备份目录与数据目录分离；恢复入口在设置页，恢复前先自动备份当前库。
- 清空/删除：默认软删；设置页的"彻底清空"需要二次确认并先写一份快照。

### 5.5 同步模型（文件夹同步）

- 机制：不使用服务端。每台设备在同步目录写自己的 `sync/<device_id>.jsonl`（只追加的变更日志），并读取其它设备的日志文件做**按实体合并**。
- 冲突策略：同一实体以 `(updated_at, device_id)` 做 LWW；检测到"字段级冲突"或时钟偏移（设备间时间差 > 5 分钟）时，按设置保留双份（生成 `标题 (冲突副本 来自设备X)`）。
- 删除：靠 `deleted_at` 墓碑传播，墓碑保留 90 天后物理清理。
- 明确不做：CRDT、字段级三方合并、实时同步。同步是**手动触发或定时触发**的批量操作，失败不阻塞应用使用。
- 已知局限：依赖设备时钟可信；同一文件被两个网盘客户端并发改写时行为不可控（文档中明确提示）。

---

## 6. IPC 契约

### 6.1 通道命名

`<domain>:<action>`，全小写下划线，例：`task:create`、`task:update`、`task:list`、`list:archive`、`tag:rename`、`settings:get`、`settings:set`、`sync:run`、`window:expand`、`window:collapse`、`marker:set-state`、`app:quit`、`i18n:set-locale`。

事件（主进程 → 渲染层）统一加 `event:` 前缀：`event:task-changed`、`event:reminder-fired`、`event:theme-changed`、`event:locale-changed`、`event:sync-progress`。

### 6.2 两种调用形态

- **请求/响应**：`ipcRenderer.invoke` ↔ `ipcMain.handle`，用于所有数据读写与窗口操作。
- **订阅**：`on` + 返回取消订阅函数，用于任务变更、提醒触发、主题与语言变更。渲染层不轮询。

### 6.3 统一响应与错误模型

所有 handler 统一返回：

```ts
type IpcResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: { code: IpcErrorCode; message: string; details?: unknown } };

type IpcErrorCode =
  | 'VALIDATION_FAILED'   // 载荷不合法（zod）
  | 'NOT_FOUND'
  | 'CONFLICT'            // 乐观锁 / 唯一约束冲突
  | 'IO_ERROR'            // 文件系统或备份失败
  | 'DB_ERROR'
  | 'PERMISSION_DENIED'   // 快捷键被占用、无通知权限
  | 'UNSUPPORTED';        // 平台不支持的能力
```

**错误以值返回、不靠抛异常跨进程**：跨 IPC 抛异常会丢失类型与堆栈细节，渲染层也难以区分"用户错误"与"程序缺陷"。主进程侧捕获所有异常并转成错误码，同时在本地日志中保留原始堆栈。

### 6.4 校验与暴露边界

契约的实现位置是 `src/shared/contracts/`（`channels.ts` 通道常量 + 各域 schema），主进程与 preload 共用同一份：

```ts
// src/shared/contracts/task.ts（节选，M02 S2 落地）
const title = z.string().trim().min(1).max(500);           // 先 trim 再 min，空白标题在入口被拒
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const taskCreateInput = z.object({
  title,
  listId: z.string().min(1).max(128).nullable().optional(),   // null = 收件箱
  parentId: z.string().min(1).max(128).nullable().optional(), // null = 顶层
  notes: z.string().max(20_000).nullable().optional(),
  priority: priority.optional(),
  dueAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  dueHasTime: z.boolean().optional(),
  repeatRule: z.string().min(1).max(1_000).nullable().optional(),
  repeatMode: z.enum(REPEAT_MODES).nullable().optional(),
  estimateMin: minuteCount.nullable().optional(),
  remindLeadMin: minuteCount.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});
```

- **`undefined` 与 `null` 语义不同**：`undefined` = 不动该字段，`null` = 清空该列。补丁因此在「每次改动即时保存」下可以只带一个字段（M02 D9、§5.2 的 `TaskPatch`）。
- 与早先草案的两处差异：`listId` / `parentId` 用**有界标识符**而非 `z.string().uuid()`（id 由本项目的 UUID v7 生成，不接受任意 uuid 版本）；`tags` 传的是**标签名**而非标签 id（`tags.name` 已是 UNIQUE，主进程按名去重创建，M02 §4）。
- 任务通道：`task:query` / `task:create` / `task:update` / `task:delete` / `task:restore` / `task:reorder`，事件 `event:task-changed`。一次写入恰好一次通知，通知发给**面板与详情窗**（`services/task-events.ts`）——详情窗是自己的一份行拷贝，它靠这个事件重读那一行；只发面板时表单会一直停在打开那一刻的旧值，点另一个 chip 选中标记不移动（"样式不切换"）。标记窗口不订阅任务事件，不发给它
- 附件通道：`attachment:list` / `attachment:add` / `attachment:remove` / `attachment:open` / `attachment:thumbnail`（M03 S3）。
- 提醒通道（M04）：渲染层→主进程只有两条，`reminder:dismiss`（`reminderDismissInput`：用户看过了）与 `reminder:done`（`reminderDoneInput`：id + taskId，把任务勾成完成并在同一条命令里应答实例）。主进程→渲染层的事件只有一个：`event:task-focus`（toast 被点击要打开的那个任务，载荷 `TaskFocusPayload`）。渲染层既不查询也不排期提醒——主进程说什么时候到，弹窗按它自己窗口的载荷（`ReminderDuePayload` 经 `loadRenderer` 的附加查询串传入）画出来，以及回答"我答了哪一条"。
- 每个 handler 的第一行是 `schema.safeParse(payload)`，**主进程不信渲染层的任何输入**；注册器与各域 handler 共用 `ipc/validate.ts` 的 `invalid()`，保证拒绝形状与日志一致。
- preload 通过 `contextBridge.exposeInMainWorld('api', ...)` 只暴露白名单方法（`window.api.task.create(...)`），**不暴露 `ipcRenderer` 本体**，渲染层无法发送任意通道。
- 渲染层不接触 `fs` / `path` / `db`，所有文件操作在主进程完成。
- 主进程侧对来自 `yichen-todo://` 协议、剪贴板、拖放、导入文件的数据套同一批 schema。

---

## 7. 主题令牌

三层结构，**组件只消费语义令牌**，切换主题 = 切换变量值：

```
① 原始色板    --palette-green-600: #0FDC78;    --palette-neutral-900: #171717;  …
② 语义令牌    --bg-surface: …; --text-primary: …; --border-default: …;
             --accent: …; --priority-p0: …; --status-overdue: …;
③ 组件令牌    --panel-radius: …; --marker-size: …; --panel-shadow: …;
```

- 主题切换靠两个属性：`data-theme="minimal|graphite|ocean|matcha|sunset|sakura|…"` 与 `data-mode="light|dark|system"`；`system` 由 `nativeTheme.shouldUseDarkColors` 解析为具体明暗。
- Tailwind 配置只做映射，不写死颜色：

```js
// tailwind.config.js（节选）
theme: { extend: { colors: {
  surface: 'var(--bg-surface)',
  'text-primary': 'var(--text-primary)',
  accent: 'var(--accent)',
} } }
```

- **只允许在令牌层出现十六进制颜色**；组件样式里出现 `#fff`、`rgba(0,0,0,.3)` 一律视为缺陷（CI 用正则做静态检查）。
- 防闪白：主进程在建窗前先读设置算出 `mode`+`theme`，写入 `BrowserWindow` 的 `backgroundColor`，并在 HTML 顶部内联脚本先行设置 `data-mode`，避免首帧白屏闪烁。
- **毛玻璃是系统材质，不是 CSS**：面板 / 详情 / 提醒弹窗三个窗口在 Win11 22H2+ 用 `backgroundMaterial: 'acrylic'`、macOS 用 `vibrancy: 'under-window'` + `visualEffectState: 'active'`。`backdrop-filter` 在这里不成立——窗口为了让卡片自己画阴影而透明，页面后面没有可模糊的像素；只有让系统在窗口**底下**画材质才有真磨砂。材质窗口反过来**不能** `transparent: true`（分层窗口带不了 DWM 材质，只会得到黑矩形），所以玻璃路径是 `transparent: false` + `backgroundColor: '#00000000'` + `roundedCorners: true`，圆角从 CSS 交给窗口。能力判定与参数收在 `src/main/platform/window-material.ts`，低版本 Windows 与 Linux 退回原透明窗口。渲染层拿到 boot 的 `glass` 后写 `data-material="glass|flat"`：玻璃下外层 8px 内边距归零（卡片填满窗口），卡片底色降到 50% × 面板不透明度、圆角归零（14px 卡片弧套在约 10px 的窗口弧里会留下材质楔形）。材质在窗口终态矩形上绘制、无法动画，所以展开 / 收起仍然只动卡片的 `opacity` / `transform`（§9.5）。材质明暗跟系统暗色标志走，`applyNativeTheme()` 在启动前与 `themeMode` 变化时设置 `nativeTheme.themeSource`，否则深色主题会压在浅色玻璃上。
- 无障碍：主题需通过对比度校验（正文 ≥ 4.5:1，次要文字 ≥ 3:1）；令牌文件里附一组对比度断言，由单测执行。
- 标记窗口消费同一套令牌（独立作用域），保证"标记颜色 = 面板颜色"的视觉一致性。
- **用户怎么选**：面板右上角 **◐**（`data-field="panel-settings"`）的弹层里放外观模式（`panel-mode-light|dark|system`）、主题（`panel-theme-minimal|graphite`）与不透明度滑杆。控件读的是**偏好**（设置行里的 `themeMode`，含 `system`），不是已经解析过的 `boot.mode`——后者在跟随系统时永远是 light/dark，"我当初选了哪一个"只在设置行里。写入走 `settings:set`，`themeMode` / `themeId` 变化时主进程 `broadcastTheme()` 把新的 `resolveBoot` 推给所有窗口（§9.7 的 `event:theme-changed`），面板与详情窗各自 `applyBootParams` 换根属性。预热中的详情窗也订阅这条事件——它比点击更早加载页面，不重画就会带着预热时的令牌出现在另一套配色里。

---

## 8. i18n 接入

- **入口**：主进程与面板入口各自初始化一次 i18next（面板额外挂 `react-i18next`，并按需动态 import `i18next-icu`）。**常驻的标记入口不引入 i18next**：它只用到一条静态文案，改由 `src/renderer/marker/src/labels.ts` 直接读取 `locales/*/common.json`（§2）。
- **静态文案的兜底**：`labels.ts` 里的类型约束保证「某语言缺 key 就 typecheck 失败」，同时把该 key 登记进 `locales/static-keys.json`，由 `npm run i18n:check` 逐语言校验存在性——因为 key 集合比对只看「各语言是否一致」，无法发现「所有语言都漏了」这种情形。
- **语言检测顺序**：`settings.locale` → `app.getLocale()` → `Intl.DateTimeFormat().resolvedOptions().locale` → `en`。
- **语言代码**：CLDR 规范，`locales/zh-Hans/`、`locales/zh-Hant/`、`locales/en/`、`locales/ja/`、`locales/ko/`、`locales/es/`、`locales/fr/`、`locales/de/`、`locales/ru/`、`locales/pt/`、`locales/it/`、`locales/ar/`、`locales/vi/`、`locales/th/`、`locales/id/`。
- **命名空间**：`common`、`tasks`、`lists`、`settings`、`notifications`、`onboarding`、`errors`。
- **key 规范**：`<域>.<组件>.<元素>[.<变体>]`，如 `tasks.editor.due.label`；禁止把整句 UI 文案当 key；禁止在代码里拼接句子（用 ICU 插值与复数）。
- **ICU 用法**：复数、序数、性别与选择全部走 ICU，例如

```json
{
  "tasks.summary.pending": "{count, plural, =0 {今天没有待办} other {今天还有 # 项待办}}"
}
```

  阿拉伯语有 6 种复数形态，靠字符串拼接必然出错，这是选 ICU 而非简单插值的核心理由。
- **格式化统一入口**：`src/shared/i18n/format.ts` 封装 `Intl.DateTimeFormat`（含 `dateStyle`/`timeStyle`）、`Intl.RelativeTimeFormat`、`Intl.NumberFormat`，以及周起始日（`Intl.Locale.weekInfo`，缺失时按语言表回退）。**业务代码禁止自己拼 `YYYY-MM-DD`**。
- **RTL**：根节点 `dir="rtl"`，样式只允许 CSS 逻辑属性（`margin-inline-start`、`inset-inline-end`、`padding-inline`）；需要镜像的图标（箭头、进度方向）用 `transform: scaleX(-1)` 统一处理，标记页的进度环角度也要按 RTL 反转。
- **质量闸门**：`npm run i18n:check` 对比各语言 key 集合，缺失/多余/占位符不一致都会失败并列出清单；运行时缺失 key 回落英文并（仅开发环境）打印警告。
- **翻译流程**：先走 PR（`i18n/<locale>` 分支 + 模板校验），达到一定活跃度后再评估接入 Crowdin，避免过早引入外部平台。

---

## 9. 标记窗口实现要点（M01 的技术约束）

### 9.1 窗口参数

| 参数 | 标记窗口 | 面板窗口 | 提醒弹窗（M04） |
|---|---|---|---|
| 尺寸 | 美术尺寸（`MARKER_ARTWORK`）：圆点 28×28；胶囊 56×28；图标 40×40；随 `markerScale` 缩放 0.8–1.5。**窗口尺寸 = max(美术尺寸, 平台下限)**，win32 下限 32×39（§9.1.1），darwin 无下限 | 宽 320–640，高 420–900，默认 380×560 | 固定 340×124（`REMINDER_POPUP_SIZE`，不可缩放） |
| `frame` / `transparent` | `false` / `true` | `false` / `true`；有系统材质时 `false` + `transparent: false`（§7） | `false` / 同上 |
| `backgroundColor` | `#00000000` | `#00000000`（材质窗口里它是"透明"，背景由系统材质提供） | `#00000000` |
| `skipTaskbar` | `true` | `true` | `true` |
| `focusable` | `false`（不抢焦点） | `true` | `true`，但只用 `showInactive()` 显示（不抢光标，§5.3.2） |
| `alwaysOnTop` | `true`（macOS 用 `setAlwaysOnTop(true, 'screen-saver')`；Windows 层面参数无效，用顶层置顶） | `true` 写死（无开关，见 §9.9） | `true` 写死（没人应答的通知不能被盖住） |
| `hasShadow` / `roundedCorners` | `false` / 系统默认 | 无材质：由 CSS 画圆角与阴影（`false` / `false`）；有材质：`true` / `true`，形状与投影交给系统 | 同面板 |
| macOS 额外项 | `acceptFirstMouse: true`、`type: 'panel'`、`visibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` | 同左（`type` 视情况） | 同左（`type: 'panel'`） |
| 其他 | `resizable: false`、`maximizable: false`、`fullscreenable: false` | `resizable: false`，`movable: false`（位置由程序计算） | `resizable: false`、`maximizable: false`、`minimizable: false`、`spellcheck: false`；每实例一个窗口，位置由 `placeReminderPopup` 算出 |

**关键取舍**：标记窗口**不能**用 `setIgnoreMouseEvents`——那是点击穿透，会让标记彻底点不到。

**详情窗口（M02 D6 改版）**：除 `focusable: true`（详情要拿键盘，用户点的是「编辑」）与 `spellcheck: false` 外，与面板窗口是同一组参数——同尺寸（`clampPanelSize`，冒烟固定为 `PANEL_SIZE`）、同 `transparent`、同 `skipTaskbar`、同置顶。它不随应用常驻，但会**预热**：启动后 1.2 秒与面板每次显示后 260ms 各建一扇 `show:false` 的详情窗并加载页面（§9.1.2），面板收起时销毁；真正打开的那扇关闭即销毁。

#### 9.1.1 实测结论（M0，Windows 11 · 1920×1080 · scale 1 · Electron 44.9.0）

用 `scripts/smoke-marker-input.mjs`（`npm run smoke:marker`）驱动真实系统光标，结论如下：

| 结论 | 证据 |
|---|---|
| **非聚焦透明窗口能收到指针事件**——`focusable: false` + `skipTaskbar: true` + `transparent: true` 下 `pointerdown / pointermove / pointerup` 全部到达渲染层，拖拽与单击展开均可用 | `drag-start`(ticks 35) → `drag-end` → `expand` → `panel-expanded` 全链路贯通；`--focusable` 对照跑同样 7/7 通过 |
| **系统光标坐标与 Electron DIP 一致**——按所在显示器 `scaleFactor` 换算后，标记落点与手的净位移偏差为 **0 DIP** | 期望值由「脚本净位移 + 起始窗口 bounds」推出（**不读中途光标**），30 帧小步拖拽实测 `Δ 0/0`（偶发 ~9 DIP 瞬态，见 §9.2.1） |
| **Windows 会强制放大透明无边框顶层窗口**——请求 28×28 一律得到 **32×39 DIP**；换成不透明窗口则为 32×31（`thickFrame: false` 无效，已放弃该尝试） | 临时探针逐一试了 10 组参数组合，只有 `transparent: true` 稳定得到 32×39 |
| **`element.setPointerCapture` 是必需的**——窗口只有 32×39，一旦去掉捕获，指针离开窗口后 Chromium 立刻停止投递 `pointermove`，拖拽**根本无法成立**（`drag-start` 不再出现） | 去掉捕获的对照跑：光标轨迹干净但 3 次尝试全部"no drag events" |
| **Chromium 在「捕获态拖拽 + 窗口移动」时会 warp 系统光标**——窗口每移动一次，系统光标会被再定位一次，故中途回读光标值不能当作手的真实位置 | 同一份代码，静止窗口跑 2 次光标轨迹与脚本路径**逐点完全一致**；移动窗口时则随机出现跳变（如 `1649,765 → 1837,755`）。M01 已量化并判定无害，见 §9.2.1 |

**因此窗口尺寸的处理方式**：`MARKER_ARTWORK` 只是美术尺寸；窗口尺寸走 `markerWindowSize()` = `max(美术尺寸 × 缩放, 平台下限)`，创建后回读 `getBounds()` 并按**实际**尺寸重算锚点位置，保证美术图形在窗口内居中、锚点数学始终自洽。形态/缩放变化时按新尺寸重算窗口并推送渲染层（§9.8）。

**冒烟脚本的工程细节**（脚本自身踩过的坑）：拖拽判据**不能**用中途回读的光标——它被 warp 带偏，会把应用缺陷判成通过，也可能把正确的运行判成失败；正确做法是用「手的净位移 + 起始 bounds」做端到端断言。点击阶段必须瞄准**拖拽之后**的实际位置（启动快照已过期），并等 > 450ms 避开渲染层的 300ms 点击抑制；合成 `mouse_event` 的按下偶发不生效（约 1/6 次），需要有限次重试；冒烟模式下标记窗口强制从默认锚点起步，避免上一轮持久化的位置把标记推出工作区。

#### 9.1.2 详情窗口：开在面板**旁边**（M02 D6 改版）

- **为什么不放在面板里**：面板宽 320–640 DIP，表单和列表塞进一扇窗确实挤；但原来的答案「详情替换列表」让用户在两个任务之间对照、或改完一个接着改下一个时，每次都要按 Esc 来回切。两扇窗同时在场是唯一能同时满足「表单要宽」和「列表要一直在」的形态，代价是多一个渲染进程
- **只有一个详情窗**：编辑是一个一个来的，两扇表单对一份列表是两个答案回答同一个问题。再点一行是**换指向**——同一扇窗收到 `event:detail-open`（`{ taskId }`）后改画另一行，位置不动，用户挪过的窗口不会被程序挪回去。**不重新加载页面**：重载会把 i18n 引导、React 挂载与整份样式表重做一遍只为换一行，点击之间还会露出一张空白卡片；页面本来就对每个任务相同，只有 id 不同。唯一例外是窗口的首个页面**还在加载**（`webContents.isLoading()`）——那时监听器尚未注册、事件会被丢掉，于是退回带新 `?task=` 的重新加载，首帧直接是最后点的那一行
- **首开的成本**：`ready-to-show` 时记一条 `detail window ready { ms }`，从点击到首帧；这是整条路径里唯一随机器的部分，再有人报"打开慢"可以直接看日志。开窗后 `open()` 先只读一行就画表单，检查清单与附件在折叠线以下、彼此独立，因此并发读（`Promise.all`），缩略图在附件行画出之后再补一次 `set`
- **首开不再等页面加载（预热窗）**：页面加载（渲染进程、i18n 引导、React 挂载、样式表，dev 下还有 Vite 模块图）与"打开哪个任务"无关，所以它在空闲时就做完——`windows/detail.ts` 建一扇 `show:false` 的窗口并 `loadRenderer`，第一次点击只 `takeWarm()` 接管它：发 `event:detail-open`、`show()`、`focus()`，日志里 `warm: true` 表示这一击没有付页面加载的钱。时机有两个：启动后 `STARTUP_WARM_DELAY_MS`（1200ms，避开标记 / 托盘 / 快捷键到达的那一刻）与面板每次显示后 `WARM_DELAY_MS`（260ms，等展开动画跑完；面板在场即"用户正在挑行"）。`onPanelHidden` 里 `discardWarm()`：没有列表可倚靠的预热窗只占内存，下次展开再预热；已有一扇打开的详情时不再预热。冒烟模式跳过预热——否则两扇窗共享详情 URL，"按 URL 认窗"就不再唯一。预热窗在接管前不挂 `closed` 清理（没有行要忘、没有面板的持住要释放），`attachLifecycle()` 在 `takeWarm()` 与 `createWindow()` 里各挂一次
- **换指向的竞态**：`open()` / `refreshSubtasks()` / `refreshAttachments()` 在 await 之后都比对 `get().taskId === id` 才 `set`，否则旧那行的读取会落在新任务上（快速连点两行时）
- **摆在面板旁边**：`shared/utils/anchoring.ts` 的 `placeTaskDetail(panelBounds, size, workArea)`。两侧（左 / 右）停靠时用 `placePanel` 的风格算出首选位置，若与面板矩形相交就翻到**另一条轴**的另一侧，两边都放不下时退回首选并按工作区夹取
- **上下停靠时改为并排、共享边线**：面板本来就贴顶向下、贴底向上长，详情再沿同一根垂直轴往下排，面板一高就落到屏幕另一头，两扇窗看起来只剩对角关系（这正是用户截图里的错位）。所以 `dockedEdge` 为 `top` / `bottom` 时走 `placeBeside`：在面板左 / 右中挑空间更大的一侧，`y` 取面板的上沿（top）或下沿（bottom），两扇窗从同一条线开始 / 结束；两侧都放不下或仍与面板相交时回退到上面的首选 + 翻面路径。纯函数，8 个单测覆盖四个停靠方向、垂直停靠的共享边线与选边、翻面、窄屏与带偏移的显示器原点
- **面板在详情开着时不收起**（`windows/panel.ts` 的 `setPanelHeld`）：详情是唯一会拿焦点的窗口，而面板的失焦收起会连列表一起带走。持住期间 `scheduleCollapse` 直接返回；释放时**重新问一次** `isFocused()`，因为松手那一刻指针可能已经回到面板上。关窗前先 `focusPanel()` 把键盘还给列表，再释放——否则释放后的定时器会看到一个没有焦点的面板，把列表收掉
- **面板走了详情一起走**：`onPanelHidden` 订阅（`hidePanel` 的通知点）让详情销毁。留着一条正在编辑、却没有列表可回的表单，比关掉更糟
- **标记拖动时跟着走**：`onMarkerMoved` 里两者都用新矩形**重新推导**位置（面板用 `placePanel`、详情用 `placeTaskDetail`），不读对方窗口的实时 bounds——两个订阅者的调用顺序不该决定结果
- **动画纪律同 §9.1**：窗口先定尺寸与位置再 `show()`，缓入只动 `opacity` 与 `transform`（`detail.css`，220ms；`prefers-reduced-motion` 下 1ms），没有一帧改窗口尺寸

#### 9.1.3 详情窗的视觉语言（2026-10-20 整改）

- **只有两级标题，没有第三级**：分组标题（10px、`0.14em` 字距、"时间 / 归类 / 子任务 / 附件"）说明"这一块在讲什么"，字段标签（11px、`text-secondary`）说明"这个控件要填什么"，任务标题（20px 半粗）说明"这是哪件事"。三层文字对应三层重要性；上一版给每个字段套边框，等于给每个字段发了第三级标题，于是眼睛没有可读的骨架
- **控件边界只在需要时出现**：输入框是填色块（`--bg-surface-muted`，与 chip 同底色）+ 透明边框；悬停显示 `--border-default`，聚焦显示 `--accent` 加 `--accent-soft` 环（`.detail-field`）。全局 `:focus-visible` 的 2px accent 框对按钮正确、对填色块像荧光笔，所以详情窗的文本控件自己接管这一条
- **标题是内容而不是字段**：常态无框，指针或光标进来才浮出浅底与内描边（`.detail-title`）。第一屏最显眼的位置不该是一条 accent 粗线
- **一个"选择题"只有一种形状**：`Choice`（圆角 pill，`aria-pressed`）承载优先级、状态、重复预设、提醒档位与日期快捷键；**未选中是透明底、无可见边框**，悬停只提亮文字，选中项是整行里唯一带 accent 边与底的那个。上一版未选中也铺填色块，六个 chip 各有一块底色，"每天 / 自定义 / 每月"看上去像六个都被勾上了。`dashed` 变体只给"自定义"或"关闭"这类**打开输入 / 执行动作**而不是**选中值**的项，用来在形状上区分"选一个"与"展开"
- **"有没有"是开关，"哪一个"才是选择**：重复与提前提醒都把一个 `Switch`（`role="switch"` + `aria-checked`）挂在 `Field` 的标签行右侧。关着的时候下面什么都不画——一次性的任务不该被画成六个未选中的重复预设，"没有提醒"也不该被画成五个未选中的档位；打开之后才出现预设、自定义值（提醒还有单位）。**打开本身不写库**：替用户默认一个重复规则会凭空生成后续实例，默认一个提前量会凭空武装提醒；选中某个值才是那一次写。关掉开关（或再点一次当前的预设 / 清空自定义值）写回 `null` 并收起。本地状态是 `repeatOn` / `remindOpen`，与 `task.repeatRule !== null` / `task.remindLeadMin !== null` 同源初始化
- 开关的 `data-field` 是 `detail-repeat-toggle` / `detail-remind-toggle`；冒烟按名把键盘放上去再回车，开启后等 `waitForFieldPresent` 看到第一个预设再继续（开启不产生 `task-changed`）
- **破坏性动作最后、最轻**：删除任务 11px、灰、隔一条 `--border-default`，不与字段同高。它有软删兜底（可撤销），所以不需要确认框，但也不该是这一屏最容易点中的东西
- **视觉验收走 CDP 而不是人工截图**：`Page.captureScreenshot` + `Emulation.setDeviceMetricsOverride`（宽 380、高 1500）把整张表单一次拍下来，不必打包、不必滚动、不必占用桌面；拍窗口原尺寸（不覆盖视口）用来判断首屏密度

### 9.2 拖拽与点击为什么不用 `-webkit-app-region: drag`

标记要同时支持"拖动"和"单击展开"，而 `-webkit-app-region: drag` 的区域内**点击事件会被系统吞掉**（Electron 已知行为）。因此标记采用 JS 拖拽：

1. `mousedown` 后仅注册监听，不立即移动窗口；
2. 移动超过阈值（默认 4px）才进入拖拽态，用 `requestAnimationFrame` 循环读 `screen.getCursorScreenPoint()` → `win.setPosition()`；
3. 抬起时：位移 < 阈值且时长 < 300ms 判定为**单击**（展开面板），否则判定为拖拽结束并触发吸附；
4. 拖拽期间不写任何 DOM 之外的状态，结束才落盘，避免频繁 IO；
5. `drag` 只在用户按住期间跑 rAF，空闲零开销。
6. **抓取点**：渲染层在 `pointerdown` 记录屏幕坐标并随 `marker:drag-start` 上报，主进程用它算偏移（`offset = grab − windowBounds`），而不是用"识别出拖拽那一刻"的光标位置——否则标记会在起步瞬间跳过一个 4px 阈值。

#### 9.2.1 已定稿：warp 不影响落点，保留「主进程采样真实光标」（M01）

Chromium 在「指针捕获 + 窗口移动」时会重新定位系统光标（§9.1.1：静止窗口的对照跑轨迹逐点精确，移动窗口则出现跳变）。M01 用冒烟脚本把它量到底了，结论是**保留现有方案、不做缓解**：

| 判定 | 证据 |
|---|---|
| warp 不累积误差 | 30 帧小步拖拽（节奏远慢于人手的连续移动），落点 `Δ 0/0 DIP`；修正判据后连续 3 轮 7/7 |
| 落点只由手的净位移决定 | 期望值用「脚本路径净位移 + 起始窗口 bounds」推出，**不读中途光标**；实测 `rawBounds` 与期望完全一致（`(1876,695) + (−220,+160) = (1656,855)`） |
| 唯一存在的偏差 | 少量尝试出现 `Δ 1/9 DIP`（约 1/7 次），重试后回到 0；属释放瞬间那一次采样的瞬态，量级 ≈ 9 DIP，不叠加 |

因此 §9.1.1 里「长拖拽后光标偏离物理鼠标」的担忧**不成立**：warp 与 `window = cursor − offset` 恰好构成同一个不动点，光标在拖拽全程仍跟随手的相对位移。原先列的候选方向（改用渲染层增量驱动、加单帧位移上限）都不再需要——它们会把已经准确的方案改差。`setPointerCapture` 保留（必需，见 §9.1.1）。

**为什么不用 `-webkit-app-region: drag`**：[FEATURES.md](FEATURES.md) M01 的「全桌面拖拽」原本写的是「系统原生拖拽，不用 JS 逐帧计算坐标」，但 Windows 上原生拖拽靠 `WM_NCHITTEST` 返回 `HTCAPTION` 实现，**窗口从此收不到任何鼠标事件**，会直接毁掉同为 P0 的「点击展开面板」和 P1 的「右键菜单」。32×39 的同一块像素无法既是标题栏又是按钮，故 M01 采用 JS 拖拽。这是对**实现手段**的一处偏离，产品行为（全桌面平滑拖拽）不变；2026-10-19 已确认接受，FEATURES.md 的措辞已同步（见 §14.7）。

### 9.3 吸附与位置持久化

- 吸附：拖拽结束时用 `screen.getDisplayNearestPoint()` 取所在显示器与 `workArea`（已扣除任务栏/Dock），距边缘小于阈值（设置项 `markerSnapThreshold`，默认 24px）即吸附到该边。
- **阈值 0 即"关闭吸附"**：`snapToWorkArea` 的阈值只控制"是否吸附到边"，为 0 时永不命中，函数退化为纯粹的"clamp 回工作区"，此时拖拽结束产出的是 `free` 锚点，经 `fromAnchor` 原样还原——所以"关掉吸附"不需要第二条代码路径，只需把 `markerSnapThresholdOf()` 的返回值压成 0。
- 持久化用**锚点**而不是绝对坐标：记录 `{ displayId, edge, offsetFromEdge, ratioAlongEdge }`。显示器分辨率或任务栏高度变化时，按比例与边缘锚点还原，比存绝对 x/y 稳得多。
- 显示器变化监听：`display-added` / `display-removed` / `display-metrics-changed` → 若标记落在所有 `workArea` 之外，移回主屏右下角并提示一次。
- 最小可见性保证：`placePanel(markerBounds, panelSize, workArea)` 按**标记停靠的那条边**决定面板朝哪开——贴顶向下、贴底向上、贴左向右、贴右向左；只有离开所有边（`dockedEdge()` 返回 `free`）时才退回"避开光标所在的那半屏"。两个分支最后都 clamp 到 `workArea` 内，所以面板不可能开到屏幕外。
  - 判定只看几何、**不读存储的锚点**：`dockedEdge()` 用与吸附同一个阈值（24px）判断标记贴着哪条边，因此拖拽过程中每一帧都能重新推出方向——不需要"松手后再修一次"。
  - 垂直/水平方向的居中会被 clamp 让位：标记贴着工作区下沿时，面板即使该居中也会被推回去（这正是"不能开到屏幕外"的代价，冒烟因此允许 `centred` 或 `clamped` 二选一）。
  - **面板跟随标记**（`followMarker`，`windows/panel.ts`）：标记每次 `setBounds`（拖拽帧，含松手吸附）都通知订阅者，面板用新矩形**重新推导**而不是按位移平移——所以标记中途越过一条边时，面板会当场翻到另一侧，而不是吊在错的那一边。面板隐藏时不参与（`isVisible()` 直接返回）。通知放在 `windows/marker.ts` 的 `onMarkerMoved()`，矩形而非位移进回调，正是为了让每个订阅者自己决定怎么用。
  - 跟随只写主进程内存里的窗口位置，**不落盘**（§9.9 的"位置不存"同一条理由）。

### 9.4 贴边自动隐藏（P1）

- 仅在"已吸附"状态下启用（`free` 锚点永不隐藏）；隐藏后保留 4–6px 可见条（可调，默认 5px）。
- 探测：`screen.getCursorScreenPoint()` 定时读取，间隔 100ms，**只在"已吸附且未被拖拽、且面板未展开"时启动**；其余状态一个定时器都不存在（浮出后不停表——浮出状态仍要判断"光标是否已离开"，停表就再也收不回去了）。
- 浮出：光标到**隐藏条**的距离 ≤ 24px（默认）；隐藏：光标到**完整标记**的距离 > 48px（默认）。两个距离留出滞回区间，光标落在区间内时保持当前状态，避免边界抖动。
- 全局总开关：`markerAutoHide` 默认**关**。默认标记就是贴着右边缘打开的，若默认开启，首次启动的用户只会看到一个 5px 的小条。
- **M01 落地实现**：判定逻辑是纯函数 `nextEdgeHideState()` / `parkedRect()`（`src/shared/utils/edge-hide.ts`，8 个单测覆盖滞回、peek 夹取、free 锚点）；主进程只负责采样光标与 `setBounds`。
  - 判定与 `setBounds` 用的都是**锚点推出的矩形**，不是 `getBounds()`：已隐藏时实时 bounds 是那块故意留了 5px 在外面的矩形，用它判定会永远收不回来。
  - 拖拽开始前必须停表并把标记浮出（§9.2 的抓取点要相对真实 bounds 计算）；面板展开时也浮出——面板是按标记位置贴上去的，不该贴着一个 5px 小条。
  - 冒烟脚本：park 与 reveal 放在**拖拽之前**（此时标记还是 boot 的吸附锚点，也是唯一会触发隐藏的状态），先把真实光标移到隐藏条上（若已隐藏则浮出、若已显示则保持显示，两种状态都收敛到"可见"），再把光标移到工作区中心触发隐藏、随后移回隐藏条触发浮出；断言只露 5px 与浮回锚点位置。冒烟态用固定的 `SMOKE_EDGE_HIDE` 策略，且 `syncEdgeHideWatch('boot')` 在冒烟下同样执行（否则脚本没有 watcher 可用），断言因此是确定的。phase 1 共 3 项断言。

### 9.5 展开/收起动画（好看且低耗的唯一正确做法）

- **不做** JS 逐帧 `setBounds`——那会抖动、掉帧、耗电。
- 做法：先把窗口 `setBounds` 到终态尺寸（`opacity: 0` 或 `show: false`），再由渲染层用 Web Animations API 播一段 `transform + opacity` 动画：

```css
/* 展开：气泡弹出感 */
@keyframes panel-in {
  from { opacity: 0; transform: scale(.96) translateY(8px); }
  to   { opacity: 1; transform: none; }
}
/* 时长 180–220ms，缓动 cubic-bezier(.22, 1, .36, 1) */
```

- 收起时反向播完再 `hide()`（监听 `animationend`，加 50ms 兜底超时防卡死），避免窗口在动画中途消失造成"截断感"。
- 只动 `transform` / `opacity`（合成层属性），不触发重排；`will-change` 仅在动画期间临时添加，动画结束移除。
- **M01 落地实现**：用 CSS `transition` 而非 Web Animations——展开 200ms、收起 180ms（都在 180–220ms 区间内），`transform` 走带轻微过冲的 `--ease-spring: cubic-bezier(.34, 1.42, .5, 1)`，`opacity` 走普通缓动（对不透明度做过冲只会被 1 截断，没有收益）。收起结束由渲染层 `transitionend` 回报 `window:collapse-finished`，主进程另有 400ms 兜底定时器（§9.6）；`prefers-reduced-motion` 下把时长压到 1ms。
- 低耗档（设置里的"极致省电"）：跳过缩放动画，直接 show/hide，并禁用毛玻璃——这是给低配机与电池模式准备的降级路径。
- 毛玻璃：默认关闭，开启时限制作用面积（仅面板背景一层），并提供"性能优先"自动降级（检测到动画掉帧或用户手动切换）。

### 9.6 面板收起与焦点

- 收起策略：`blur` + 150ms 延迟（`mouseleave` 误收率太高，禁用）。延迟期内若重新聚焦则取消收起。
- 例外保护：任务编辑弹窗、日期选择器、颜色选择器等子面板打开期间不收起。
- 打开面板时用 `win.showInactive()` 还是 `focus()`？——**用 `focus()`**，因为面板需要键盘输入；但标记窗口保持 `focusable: false`，避免"点一下就丢掉当前应用焦点"的抱怨。

### 9.7 性能预算（M0/M1 验收线）

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 冷启动到标记可见 | < 1.5s | 手动 + 日志打点 |
| 空闲 CPU（折叠状态） | ≈ 0%（无定时器、无轮询） | 任务管理器 / 活动监视器采样 60s |
| 标记窗口内存 | 显著低于独立 React 窗口（页数越多越明显） | 进程资源监视 |
| 展开/收起动画 | 不丢帧（60fps） | DevTools Performance 录制 |
| 面板隐藏后的渲染开销 | 停止（后台节流） | `backgroundThrottling: true` |

### 9.8 标记外观与状态推送（M01）

**单一输入源**：标记渲染层不自己算任何东西。主进程把「外观（来自设置）+ 计数（来自任务表）」合成一个 `MarkerStatePayload`，经 `event:marker-state` 推送；渲染层只负责把它写成 DOM 属性与 CSS 自定义属性。

| 字段 | 来源 | 渲染层落点 |
|---|---|---|
| `appearance.shape` / `scale` | `markerShape` / `markerScale` | `element.dataset.shape`、`--marker-w/--marker-h` |
| `appearance.opacity` | `markerOpacity` | `--marker-opacity`（悬停时 CSS 强制回到 1） |
| `appearance.tint` | `markerTint` | `html.dataset.markerTint` → 令牌层选中 `--marker-tint` / `--marker-on-tint` |
| `appearance.badgeMode` → `badge` | 计数 | `element.dataset.badge` + 数字文本；`0` 即隐藏 |
| `progress` / `risk` | 今日完成率 / 逾期与临期计数 | `--marker-progress`、`html.dataset.markerRisk` |

**为什么外观也要走 boot query**：窗口是**先按外观定尺寸、后创建渲染层**的。若首帧才知道形态，就会出现"窗口已是胶囊、画面还是圆点"的闪一下（§7 防闪白同理）。故 `BootParams.marker` 在 `bootQuery()` 里编成一个 6 字段 token，`main.ts` 先按它画第一帧，`marker-state` 到达后再校正。

**颜色一律不在渲染层出现**：`marker.css` 只写 `var(--marker-tint)` 这类变体名，具体色值由 `tokens.css` 按 `data-*` 属性选中；`scripts/check-tokens.mjs` 在 CI 里兜底（§7）。形态/缩放变化会触发窗口重算尺寸（§9.1）与重新推送，无需重启。

**胶囊的进度不能用"环色→填充色"渐变**：默认 accent 调色板下 `--marker-ring` 与 `--marker-tint` 是同一个绿色，两色渐变会变成一块纯色、进度不可见。故胶囊的"未完成"部分用 `--marker-ring-track`（半透明中性色），已完成部分保留 `--marker-tint`。

**`--marker-ring-track` 为什么不是主题边框色**：标记浮在**桌面**上，不在任何主题表面上，浅灰边框色在浅色壁纸下等于隐形。改用随 `data-mode` 翻转的半透明中性色（light 下 `rgba(0,0,0,.3)`、dark 下 `rgba(255,255,255,.38)`），与面板阴影同一套思路，无需采样壁纸。

**悬停反馈为什么不新增元素**：悬停环画成 `.marker__core` 的**第二层 `box-shadow`**（常态扩散为 0，`:hover` 与 `[data-panel='shown']` 时扩散到 `--marker-hover-ring-width`）。这样悬停只改一个合成属性，既不触碰布局，也不必为环再挂一个 DOM 节点——常驻窗口的节点数要省。环色与 `--marker-ring-track` 同理，用随 `data-mode` 翻转的半透明中性色，白环在浅色壁纸下同样会隐形。

**为什么没有 `:focus-visible` 样式**：标记窗口是 `focusable: false`（§3），它永远拿不到键盘焦点，焦点环规则不可达，属死代码。

### 9.9 面板尺寸记忆、透明度与"伪 resize"（M01）

面板窗口 `resizable: false`——Windows 上无边框透明窗口只有在 `thickFrame: true`（即带系统边框）时才有可拖拽的 resize 边框，那正是我们要避免的（§9.1.1）。因此：

- 渲染层右下角画一个 grip，`pointerdown` 后自己算目标尺寸（**从手势起点量**，不读 `innerWidth`——那是本次手势的输出，回读会自我漂移），节流 32ms 上报 `window:resize-panel`。
- 主进程用 `clampPanelSize()` 夹到 320–640 × 420–900，再用 `snapToWorkArea(..., 阈值 0)` 把位置 clamp 回工作区（此处不需要吸附语义，只是"别跑出屏幕"），最后 `setBounds`。左上角保持不动。
- 尺寸在停手 250ms 后防抖写入设置（`panelWidth` / `panelHeight`）；**位置不存**——每次展开都由 `placePanel()` 依标记重新推导，存了反而会和标记位置打架。
- 设置里的尺寸在下次创建窗口时生效。

**面板固定置顶**：`alwaysOnTop: true` 写死在窗口参数里，`window:set-always-on-top` 通道与 `panelAlwaysOnTop` 设置项**都已删除**。面板靠标记与快捷键到达，一个能被别的窗口盖住的面板就不叫"随时可达"；留一个开关等于留一条"它在我看不见的地方"的路径。

**面板透明度**（`panelOpacity`，0.5–1，默认 1）：

- 唯一一个面板自己的外观旋钮，摆在面板头部（`panel-settings.tsx`）而不是设置窗口里——这个控件必须"一边拖一边看见效果"，面板自己淡下去就是它的预览。M10 的设置窗口将来读写的是同一个字段。
- **只降表面透明度，不动正文**：`panel.css` 用 `color-mix(in srgb, var(--bg-surface) calc(var(--panel-opacity, 1) * 100%), transparent)` 混出卡片底色。若改用 `opacity`，文字会跟着一起淡，对比度就守不住了；用 `color-mix` 还顺带做到**主题无关**——不必为每套主题再抄一份背景色，也不在 JS 里算颜色。
- 取值在**首绘前**随 boot 参数到达（§7），所以窗口不会先不透明画一帧再淡下去；`--panel-opacity` 也刻意**不进**展开动画的过渡属性，否则拖动滑杆时动画会追着跑。
- 写入防抖 200ms（`use-panel-opacity.ts`）：滑杆连续上报，一次上报=一次 SQLite 写+一次贴边隐藏重算，所以只在停手后落盘，而**应用**是每帧都做（看得见效果才是这个控件的意义）。

---

## 10. 安全基线

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、不开启 `webSecurity: false`。
- 严格 CSP（`default-src 'self'`，禁止远程脚本；如需内联样式用 nonce）。
- 不加载任何远程页面；`setWindowOpenHandler` 默认 deny，仅对白名单 https 域走 `shell.openExternal`。
- preload 白名单 API + zod 校验（见 §6.4）；协议唤起与导入数据同批校验。
- 单实例锁；`yichen-todo://` 注册参数做长度与类型校验，防注入。
- 自动更新走 HTTPS，安装包必须签名；macOS 走 `notarize` + Hardened Runtime。
- Electron Fuses 收紧（`runAsNode: false`、`enableNodeCliInspectArguments: false`、`onlyLoadAppFromAsar: true`、`enableEmbeddedAsarIntegrityValidation: true`）。
- 默认零遥测；崩溃日志仅本地写入，用户主动导出诊断包时才产生文件。

---

## 11. 构建与发布

- electron-builder 关键配置：`appId: com.yichen.todolist`、`productName: YiChen ToDo`、`asar: true` + `asarUnpack` 原生模块、`files` 白名单（排除源码与 devDeps 残留）、`npmRebuild: true`（对 Node-API 模块并非 ABI 必需，保留以覆盖将来可能引入的非 N-API 原生依赖）。
- 产物：Windows `nsis`（含 `portable`）x64/arm64；macOS `dmg` + `zip`，`x64` + `arm64`（后续可出 Universal）。
- 签名：Windows 需 OV/EV 证书（**需你提前申请**）；macOS 需 Developer ID + Apple 公证凭据，CI 中通过加密 Secrets 注入，绝不入库。
- 更新：`electron-updater` + GitHub Releases，稳定/beta 双通道；更新说明取自 Release Notes。
- CI：现有 [ci.yml](../.github/workflows/ci.yml) 的脚手架检测会在 `package.json` 出现后自动生效；M11 追加三平台打包与发布工作流（仅 tag 触发）。
- 版本：`package.json` 版本号与 `CHANGELOG.md` 顶部条目由发布脚本同步。

---

## 12. 测试策略

| 层级 | 覆盖对象 | 工具 |
|---|---|---|
| 单元 | 吸附/锚点还原算法、RRULE 展开、ICU 与格式化封装、同步合并与冲突判定、DB repository | Vitest（`src/shared` 纯函数优先，天然可测） |
| 集成 | 迁移链（空库 → 最新版）、仓储层 CRUD、约束与软删过滤 | Vitest + 临时目录真实 SQLite（`src/main/db/test-db.ts` 的 `withTempDatabase()`：临时目录 → `openDatabase` → `migrate` → 跑断言 → 关库并连同 `-wal` / `-shm` 一起清理） |
| E2E | 标记拖拽/吸附、展开收起动画、任务 CRUD、通知触发、快捷键 | Playwright for Electron |
| 手动验收 | 多显示器、DPI 125%/150%、休眠唤醒、断电恢复、RTL 布局 | 验收清单（docs 内维护） |

CI 门槛：`lint` + `typecheck` + `test` + `i18n:check` + 主题令牌静态检查（禁止组件层硬编码颜色）。

---

## 13. 风险与备选方案

| 风险 | 影响 | 应对 |
|---|---|---|
| ~~非聚焦透明窗口在 Windows/macOS 上的鼠标事件行为不一致~~ → **已在 M0 实测排除（Windows）** | ~~标记点不到或拖不动~~ | 结论见 §9.1.1：事件全通、坐标一致；macOS 待 M01 用同一脚本复测 |
| ~~捕获态拖拽时 Chromium 会 warp 系统光标~~ → **M01 已量到底，判定无害** | ~~拖拽抖动、长拖拽后光标偏离物理鼠标~~ | 见 §9.2.1：30 帧拖拽落点 `Δ 0/0`，误差不累积；唯一偏差 ≤ ~10 DIP 且不叠加 |
| Windows 上置顶窗口压不过全屏独占应用（游戏/演示） | 标记被遮挡 | 记为已知限制，不做注入式覆盖（不越界） |
| better-sqlite3 原生模块编译/ABI 问题 | 数据库直接不可用 | **M0 已验证**：开发态（`electron-builder install-app-deps` 重建）与打包态（`npm run pack` → `release/win-unpacked`，`asarUnpack` 生效，启动日志 `database ready`）均可打开 WAL 库；备选：Electron 内置 `node:sqlite`（实验性）或 `sql.js`（内存库 + 手动落盘，性能下降） |
| 两台设备时钟偏差导致同步误判 | 冲突合并顺序错 | `(updated_at, device_id)` LWW + 偏移检测 + 保留双份；文档明示局限 |
| 签名证书与公证周期 | 阻塞 v1.0 发布 | 尽早申请（Windows 证书审批可能数日；macOS 需 Apple Developer 账号） |
| 透明窗口在部分显卡驱动下的渲染瑕疵 | 视觉毛刺 | 提供"关闭透明/毛玻璃"开关作为兜底 |
| ~~两个渲染入口的构建配置复杂化~~ → **M0 已验证** | ~~脚手架阶段踩坑~~ | 双入口 + 生产 CSP 注入已跑通，见 §2 实测产物 |
| 冒烟脚本注入的文本被机器输入法改写（TSF 系 IME 不认 `ImmAssociateContext`） | 断言测的是那台机器的输入法而不是应用 | **M02 S3 用 `WM_CHAR` 直投窗口规避，S4 起不再需要**：文本改由 DevTools 协议送进渲染进程，本就不经过输入法；热键之外的一切输入都不走 OS 了 |
| 注入点击给面板的前台会被注入它的控制台抢回，面板判定失焦后自行收起 | 冒烟在打字前就把面板关掉了 | **M02 S3 已解决**：该路径完全不碰光标——文本直投窗口，本就不需要前台 |
| 冒烟脚本把按键直投面板窗口，文字能到、焦点移动到不了 | Tab 不改变焦点，脚本却仍按固定次数按下去，回车落到别的控件上（实测把任务标成了完成） | **M02 S4 已解决**：冒烟态开 `remote-debugging-port`（仅 `YICHEN_SMOKE` 时开），脚本通过 DevTools 协议附着面板页面——控件按 `data-field` 名**直接设焦点**、按键直接送进渲染进程，不经过 OS 输入队列、不受输入法影响、也不要前台；全流程只剩打开面板的全局快捷键走真实输入（`RegisterHotKey` 只认输入队列产生的事件） |
| ~~列表排序用 HTML5 `draggable`~~ → **M02 S5 未采用** | ~~拖拽幽灵图是整行的位图，落在透明无边框窗口上观感差；落点判断仍要自己写；且会吞掉行内控件（标题按钮、复选圆钮）需要的点击~~ | 直接用 M01 验证过的 pointer 方案（`setPointerCapture` + 自绘落点线，§9.2）。顺带拿到两个好处：拖动中只有被拖那一行写 `translateY`（合成属性，其余行经 `memo` 跳过重渲染），以及拖拽可以被 `Input.dispatchMouseEvent` 合成出来，自动化不必碰真鼠标 |

---

## 14. 待你确认的开放问题

1. **葡萄牙语基准**：`pt` 统一（巴西为主）还是区分 `pt-BR` / `pt-PT`？（我建议首发只做 `pt`，巴西葡萄牙语为基准）
2. ~~面板是否默认置顶~~ → **已决（2026-10-20）**：**固定置顶**，连开关都不留。面板靠标记与快捷键到达，能被别的窗口盖住就破坏了"随时可达"；`window:set-always-on-top` 通道与 `panelAlwaysOnTop` 设置项已随之删除。面板自己的外观旋钮只剩透明度（§9.9）。
3. ~~标记默认形态~~ → **已实现**：圆点 28×28，`markerBadge` 默认 `open`、`markerRing` 默认开；形态/缩放/透明度/配色均可在设置里改（§9.8）。
4. **是否允许面板出现在任务栏**：我建议两个窗口都不进任务栏，只留托盘。
5. ~~默认快捷键~~ → **已实现（M02 S3）**：唤起/隐藏 `Ctrl/Cmd+Shift+Space`、快速新增 `Ctrl/Cmd+Shift+N`，注册与拒绝都写日志；M09 才做可配置与冲突检测。
6. **数据目录默认位置**：默认放应用数据目录（`%APPDATA%\YiChen ToDo` / `~/Library/Application Support/YiChen ToDo`），还是首次启动让用户自选（便于放进同步文件夹）？我建议默认放系统目录 + 设置页可改。
7. ~~M01「全桌面拖拽」的实现手段偏离~~ → **已决（2026-10-19 用户确认）**：FEATURES.md 原文写"系统原生拖拽，不用 JS 逐帧计算坐标"，但 Windows 原生拖拽（`HTCAPTION`）会让窗口再也收不到鼠标事件，直接毁掉同为 P0 的"点击展开"与 P1 的"右键菜单"。M01 采用 JS 拖拽（主进程 16ms 采样真实光标，§9.2 / §9.2.1），**产品行为不变**（全桌面平滑拖拽、Δ 0 DIP），仅实现手段偏离。已确认接受，实现以 §9.2 为准，FEATURES.md 的对应措辞同步更新。

M0 脚手架与冒烟验证已完成；M01（隐形标记）已交付；M02（任务核心）已收尾——S0–S8 全部过门，见 [M02-PLAN.md](M02-PLAN.md)。
