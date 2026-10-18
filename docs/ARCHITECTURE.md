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

1. **两个渲染入口**（`panel/index.html`、`marker/index.html`），不做单入口路由。标记页零依赖 React，只加载几十 KB 的 DOM + CSS，保证常驻内存与 CPU 最低。

   M0 实测产物：`marker.js 5.26 kB + marker.css 7.78 kB`（另需共享 i18n chunk 85.26 kB）、`panel.js 587.45 kB + panel.css 19.74 kB`、`main 377.85 kB`、`preload 3.36 kB`；ICU 打包（78.13 kB）由 i18next-icu 动态 import 承担，只有面板按需加载。

   **M01 待优化**：常驻的标记窗口目前也加载 85.26 kB 的 i18next 共享 chunk，只为一条 `marker.tooltip` 文案；标记入口应改为只取 `marker` 命名空间的静态文案，把共享 chunk 从常驻路径上摘掉。
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
| `better-sqlite3` | 本地数据库 | 原生模块：需针对 Electron ABI 重建，并 `asarUnpack` |
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

```ts
// src/shared/contracts/task.ts
export const createTaskInput = z.object({
  title: z.string().trim().min(1).max(500),
  listId: z.string().uuid().optional(),
  priority: z.number().int().min(0).max(3).default(0),
  dueAt: z.number().int().nullable().optional(),
  tags: z.array(z.string().uuid()).max(20).default([]),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;
```

- 每个 handler 的第一行是 `schema.parse(payload)`，**主进程不信渲染层的任何输入**。
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

- **入口**：主进程与两个渲染入口各自初始化一次 i18next（`marker` 不引入 `react-i18next`，只用核心 API + `i18next-icu`）。
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
| 尺寸 | 圆点 28×28；胶囊 56×28；图标 40×40（可缩放 0.8–1.5） | 宽 360–420，高自适应上限 560 |
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
| **非聚焦透明窗口能收到指针事件**——`focusable: false` + `skipTaskbar: true` + `transparent: true` 下 `pointerdown / pointermove / pointerup` 全部到达渲染层，拖拽与单击展开均可用 | `drag-start`(ticks 12–19) → `drag-end` → `expand` → `panel-expanded` 全链路贯通；`--focusable` 对照跑同样 7/7 通过 |
| **系统光标坐标与 Electron DIP 一致**——按所在显示器 `scaleFactor` 换算后，窗口落点与 `screen.getCursorScreenPoint()` 的偏差为 **0 DIP** | 期望值由"OS 实报光标 − 抓取偏移"推出，实测差值 ≤ 6 DIP 判据下取到 0 |
| **Windows 会强制放大透明无边框顶层窗口**——请求 28×28 一律得到 **32×39 DIP**；换成不透明窗口则为 32×31（`thickFrame: false` 无效，已放弃该尝试） | 临时探针逐一试了 10 组参数组合，只有 `transparent: true` 稳定得到 32×39 |
| **`element.setPointerCapture` 是必需的**——窗口只有 32×39，一旦去掉捕获，指针离开窗口后 Chromium 立刻停止投递 `pointermove`，拖拽**根本无法成立**（`drag-start` 不再出现） | 去掉捕获的对照跑：光标轨迹干净但 3 次尝试全部"no drag events" |
| **Chromium 在"捕获态拖拽 + 窗口移动"时会 warp 系统光标**——窗口每移动一次，系统光标会被再定位一次；当本进程的采样循环与它错拍时，逐帧误差会叠加，光标轨迹出现肉眼可见的乱走 | 同一份代码，静止窗口跑 2 次光标轨迹与脚本路径**逐点完全一致**；移动窗口时则随机出现跳变（如 `1649,765 → 1837,755`）。详见 §9.2 待决项 |

**因此窗口尺寸的处理方式**：`MARKER_ARTWORK_SIZE = 28` 只是美术尺寸；窗口尺寸走 `markerWindowSize()`（win32 = 32×39，darwin = 28×28），创建后回读 `getBounds()` 并按**实际**尺寸重算锚点位置，保证圆点在窗口内居中、锚点数学始终自洽。

**冒烟脚本的工程细节**（脚本自身踩过的坑）：期望位置必须用 **OS 实报光标**而不是脚本设定值来算（否则会把 warp 误判成应用缺陷）；每次拖拽前校验光标是否真的走完了脚本路径，未走完则重试；点击阶段要等 > 350ms 避开渲染层的 300ms 点击抑制；冒烟模式下标记窗口从默认锚点起步，避免上一轮持久化的位置把标记推出工作区。

### 9.2 拖拽与点击为什么不用 `-webkit-app-region: drag`

标记要同时支持"拖动"和"单击展开"，而 `-webkit-app-region: drag` 的区域内**点击事件会被系统吞掉**（Electron 已知行为）。因此标记采用 JS 拖拽：

1. `mousedown` 后仅注册监听，不立即移动窗口；
2. 移动超过阈值（默认 4px）才进入拖拽态，用 `requestAnimationFrame` 循环读 `screen.getCursorScreenPoint()` → `win.setPosition()`；
3. 抬起时：位移 < 阈值且时长 < 300ms 判定为**单击**（展开面板），否则判定为拖拽结束并触发吸附；
4. 拖拽期间不写任何 DOM 之外的状态，结束才落盘，避免频繁 IO；
5. `drag` 只在用户按住期间跑 rAF，空闲零开销。
6. **抓取点**：渲染层在 `pointerdown` 记录屏幕坐标并随 `marker:drag-start` 上报，主进程用它算偏移（`offset = grab − windowBounds`），而不是用"识别出拖拽那一刻"的光标位置——否则标记会在起步瞬间跳过一个 4px 阈值。

#### 9.2.1 待决项：捕获态下移动窗口会 warp 系统光标（M01）

Chromium 在"指针捕获 + 窗口移动"时会重新定位系统光标（§9.1.1 已实测）。按设计 `offset = grab − windowBounds`，窗口始终贴在光标下方，这个 warp 在稳态下应当是**空操作**；但它与本进程 16ms 采样错拍时会产生逐帧误差并叠加，表现为拖拽过程中光标（进而标记）抖动、长时间拖拽后光标偏离物理鼠标位置。

已知约束与候选方向（M01 定稿，冒烟脚本可复现）：

- `setPointerCapture` 不能去掉（去掉就没有 `pointermove`），所以只能在"如何算窗口位置"上做文章。
- 渲染层 `pointermove` 的 `screenX/screenY` 与窗口相对坐标**不受** warp 影响（warp 保持窗口内相对位置），因此"以渲染层上报的增量驱动窗口"是一条可用路线；代价是渲染层节流时精度下降，与 §9.2 第 2 条"主进程读真实光标"的初衷相反，需要用实测对比决定取舍。
- 兜底方案：拖拽期间限制单帧位移上限（例如 200 DIP/帧），把叠加误差截断成肉眼不可见的抖动。

### 9.3 吸附与位置持久化

- 吸附：拖拽结束时用 `screen.getDisplayNearestPoint()` 取所在显示器与 `workArea`（已扣除任务栏/Dock），距边缘 < 24px 即吸附到该边。
- 持久化用**锚点**而不是绝对坐标：记录 `{ displayId, edge, offsetFromEdge, ratioAlongEdge }`。显示器分辨率或任务栏高度变化时，按比例与边缘锚点还原，比存绝对 x/y 稳得多。
- 显示器变化监听：`display-added` / `display-removed` / `display-metrics-changed` → 若标记落在所有 `workArea` 之外，移回主屏右下角并提示一次。
- 最小可见性保证：面板展开位置根据标记所在边自动避让（如标记贴右边缘则面板向左展开），并在计算后 clamp 到 `workArea` 内。

### 9.4 贴边自动隐藏（P1，先留好接口）

- 仅在"已吸附"状态下启用；隐藏后保留 4–6px 可见条（可调）。
- 探测：`screen.getCursorScreenPoint()` 定时读取，间隔 80–120ms（默认 100ms），**只在隐藏状态启动、浮出后立即停止**；其它状态零定时器。
- 浮出：光标进入触发距离（默认 24px）→ 移出；离开超过退出距离（默认 48px，做滞回避免抖动）→ 重新隐藏。
- 全局总开关：用户可设"永久显示"，此时不装任何定时器。

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

- electron-builder 关键配置：`appId: com.yichen.todolist`、`productName: YiChen ToDo`、`asar: true` + `asarUnpack` 原生模块、`files` 白名单（排除源码与 devDeps 残留）、`npmRebuild: true`（better-sqlite3 对齐 Electron ABI）。
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
| 集成 | 迁移链（空库 → 最新版）、备份与恢复、导入导出往返一致性 | Vitest + 临时目录真实 SQLite |
| E2E | 标记拖拽/吸附、展开收起动画、任务 CRUD、通知触发、快捷键 | Playwright for Electron |
| 手动验收 | 多显示器、DPI 125%/150%、休眠唤醒、断电恢复、RTL 布局 | 验收清单（docs 内维护） |

CI 门槛：`lint` + `typecheck` + `test` + `i18n:check` + 主题令牌静态检查（禁止组件层硬编码颜色）。

---

## 13. 风险与备选方案

| 风险 | 影响 | 应对 |
|---|---|---|
| ~~非聚焦透明窗口在 Windows/macOS 上的鼠标事件行为不一致~~ → **已在 M0 实测排除（Windows）** | ~~标记点不到或拖不动~~ | 结论见 §9.1.1：事件全通、坐标一致；macOS 待 M01 用同一脚本复测 |
| 捕获态拖拽时 Chromium 会 warp 系统光标（§9.1.1 实测） | 拖拽抖动、长拖拽后光标偏离物理鼠标 | 见 §9.2.1 候选方向；M01 定稿并有冒烟脚本可复现 |
| Windows 上置顶窗口压不过全屏独占应用（游戏/演示） | 标记被遮挡 | 记为已知限制，不做注入式覆盖（不越界） |
| better-sqlite3 原生模块编译/ABI 问题 | 数据库直接不可用 | **M0 已验证**：开发态（`electron-builder install-app-deps` 重建）与打包态（`npm run pack` → `release/win-unpacked`，`asarUnpack` 生效，启动日志 `database ready`）均可打开 WAL 库；备选：Electron 内置 `node:sqlite`（实验性）或 `sql.js`（内存库 + 手动落盘，性能下降） |
| 两台设备时钟偏差导致同步误判 | 冲突合并顺序错 | `(updated_at, device_id)` LWW + 偏移检测 + 保留双份；文档明示局限 |
| 签名证书与公证周期 | 阻塞 v1.0 发布 | 尽早申请（Windows 证书审批可能数日；macOS 需 Apple Developer 账号） |
| 透明窗口在部分显卡驱动下的渲染瑕疵 | 视觉毛刺 | 提供"关闭透明/毛玻璃"开关作为兜底 |
| ~~两个渲染入口的构建配置复杂化~~ → **M0 已验证** | ~~脚手架阶段踩坑~~ | 双入口 + 生产 CSP 注入已跑通，见 §2 实测产物 |

---

## 14. 待你确认的开放问题

1. **葡萄牙语基准**：`pt` 统一（巴西为主）还是区分 `pt-BR` / `pt-PT`？（我建议首发只做 `pt`，巴西葡萄牙语为基准）
2. **面板是否默认置顶**：默认置顶会遮挡其他窗口，但符合"随手记"的直觉；我建议默认置顶且可关闭。
3. **标记默认形态**：我建议圆点 28×28，悬停时显示进度环。
4. **是否允许面板出现在任务栏**：我建议两个窗口都不进任务栏，只留托盘。
5. **默认快捷键**：我建议唤起/隐藏 `Ctrl/Cmd+Shift+Space`、快速新增 `Ctrl/Cmd+Shift+N`（避开系统占用）。
6. **数据目录默认位置**：默认放应用数据目录（`%APPDATA%\YiChen ToDo` / `~/Library/Application Support/YiChen ToDo`），还是首次启动让用户自选（便于放进同步文件夹）？我建议默认放系统目录 + 设置页可改。

确认后，M0 进入脚手架落地（`git init` 已完成，下一步是 electron-vite 初始化 + 双入口验证）。
