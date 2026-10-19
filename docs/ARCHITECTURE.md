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

1. **两个渲染入口**（`panel/index.html`、`marker/index.html`），不做单入口路由。标记页零依赖 React、零依赖 i18next，只加载约 23 kB 的 DOM + CSS + 静态文案，保证常驻内存与 CPU 最低。

   M0 实测产物：`marker.js 5.26 kB + marker.css 7.78 kB`（另需共享 i18n chunk 85.26 kB）、`panel.js 587.45 kB + panel.css 19.74 kB`、`main 377.85 kB`、`preload 3.36 kB`。

   M01 实测产物：常驻标记路径为 `marker.js 7.15 kB + marker.css 10.98 kB + common chunk 5.10 kB = 23.23 kB`（形态/角标/进度环与拖拽桥都在其中），i18next 已完全移出常驻路径，只随面板打包（`panel.js 587.45 → 673.04 kB`、`panel.css 19.74 → 21.80 kB`）；`main 384.07 kB`、`preload 3.74 kB`。ICU 打包（78.13 kB，`es-*.js`）仍由 i18next-icu 动态 import 承担，只有面板按需加载。
2. **`src/shared` 只放纯函数与类型**，不 import `electron`、不 import Node 内置模块；这样吸附算法、RRULE、格式化函数可以直接被 Vitest 单测覆盖，也能被两个渲染入口共用。

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
| 层级 | 置顶 | 置顶（可配置） |

**为什么两个窗口都不进任务栏**：应用定位是"隐形"，任务栏出现条目会立刻破坏这个定位；常驻托盘图标 + 全局快捷键已能满足"随时可达"。这也避免了 Windows 上任务栏图标闪烁与 macOS Dock 常驻的观感问题。

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
- **附件只存路径引用，不复制文件**（M02 §6）：`attachments` 行只记 `path`；展示用的 `name`（basename）与 `size` 由主进程每次 `statSync` 现读，文件被删或改名时这一行仍在、`size` 为 `null`。渲染层**永远不发路径**，只能点按钮让主进程弹 `dialog` 选择器；`shell.openPath` 也只在 IPC handler 里——服务层因此不 import electron、可单测。

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
  path       TEXT NOT NULL,        -- 本地文件引用，不做云上传
  name       TEXT,
  size       INTEGER,
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
- 任务通道：`task:query` / `task:create` / `task:update` / `task:delete` / `task:restore` / `task:reorder`，事件 `event:task-changed`。一次写入恰好一次通知，通知只发面板窗口（`services/task-events.ts`）。
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
- 无障碍：主题需通过对比度校验（正文 ≥ 4.5:1，次要文字 ≥ 3:1）；令牌文件里附一组对比度断言，由单测执行。
- 标记窗口消费同一套令牌（独立作用域），保证"标记颜色 = 面板颜色"的视觉一致性。

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

| 参数 | 标记窗口 | 面板窗口 |
|---|---|---|
| 尺寸 | 美术尺寸（`MARKER_ARTWORK`）：圆点 28×28；胶囊 56×28；图标 40×40；随 `markerScale` 缩放 0.8–1.5。**窗口尺寸 = max(美术尺寸, 平台下限)**，win32 下限 32×39（§9.1.1），darwin 无下限 | 宽 320–640，高 420–900，默认 380×560 |
| `frame` / `transparent` | `false` / `true` | `false` / `true` |
| `backgroundColor` | `#00000000` | 主题底色（避免首帧闪白） |
| `skipTaskbar` | `true` | `true` |
| `focusable` | `false`（不抢焦点） | `true` |
| `alwaysOnTop` | `true`（macOS 用 `setAlwaysOnTop(true, 'screen-saver')`；Windows 层面参数无效，用顶层置顶） | 可配置，默认 `true` |
| `hasShadow` / `roundedCorners` | `false` / 系统默认 | 由 CSS 画圆角与阴影 |
| macOS 额外项 | `acceptFirstMouse: true`、`type: 'panel'`、`visibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` | 同左（`type` 视情况） |
| 其他 | `resizable: false`、`maximizable: false`、`fullscreenable: false` | `resizable: false`，`movable: false`（位置由程序计算） |

**关键取舍**：标记窗口**不能**用 `setIgnoreMouseEvents`——那是点击穿透，会让标记彻底点不到。

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
- 最小可见性保证：面板展开位置根据标记所在边自动避让（如标记贴右边缘则面板向左展开），并在计算后 clamp 到 `workArea` 内。

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

### 9.9 面板尺寸记忆与"伪 resize"（M01）

面板窗口 `resizable: false`——Windows 上无边框透明窗口只有在 `thickFrame: true`（即带系统边框）时才有可拖拽的 resize 边框，那正是我们要避免的（§9.1.1）。因此：

- 渲染层右下角画一个 grip，`pointerdown` 后自己算目标尺寸（**从手势起点量**，不读 `innerWidth`——那是本次手势的输出，回读会自我漂移），节流 32ms 上报 `window:resize-panel`。
- 主进程用 `clampPanelSize()` 夹到 320–640 × 420–900，再用 `snapToWorkArea(..., 阈值 0)` 把位置 clamp 回工作区（此处不需要吸附语义，只是"别跑出屏幕"），最后 `setBounds`。左上角保持不动。
- 尺寸在停手 250ms 后防抖写入设置（`panelWidth` / `panelHeight`）；**位置不存**——每次展开都由 `placePanel()` 依标记重新推导，存了反而会和标记位置打架。
- 设置里的尺寸在下次创建窗口时生效。

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
2. **面板是否默认置顶**：默认置顶会遮挡其他窗口，但符合"随手记"的直觉；我建议默认置顶且可关闭。
3. ~~标记默认形态~~ → **已实现**：圆点 28×28，`markerBadge` 默认 `open`、`markerRing` 默认开；形态/缩放/透明度/配色均可在设置里改（§9.8）。
4. **是否允许面板出现在任务栏**：我建议两个窗口都不进任务栏，只留托盘。
5. ~~默认快捷键~~ → **已实现（M02 S3）**：唤起/隐藏 `Ctrl/Cmd+Shift+Space`、快速新增 `Ctrl/Cmd+Shift+N`，注册与拒绝都写日志；M09 才做可配置与冲突检测。
6. **数据目录默认位置**：默认放应用数据目录（`%APPDATA%\YiChen ToDo` / `~/Library/Application Support/YiChen ToDo`），还是首次启动让用户自选（便于放进同步文件夹）？我建议默认放系统目录 + 设置页可改。
7. ~~M01「全桌面拖拽」的实现手段偏离~~ → **已决（2026-10-19 用户确认）**：FEATURES.md 原文写"系统原生拖拽，不用 JS 逐帧计算坐标"，但 Windows 原生拖拽（`HTCAPTION`）会让窗口再也收不到鼠标事件，直接毁掉同为 P0 的"点击展开"与 P1 的"右键菜单"。M01 采用 JS 拖拽（主进程 16ms 采样真实光标，§9.2 / §9.2.1），**产品行为不变**（全桌面平滑拖拽、Δ 0 DIP），仅实现手段偏离。已确认接受，实现以 §9.2 为准，FEATURES.md 的对应措辞同步更新。

M0 脚手架与冒烟验证已完成；M01（隐形标记）已交付；当前处于 M02（任务核心，切片 S7 已过门，见 [M02-PLAN.md](M02-PLAN.md)）。
