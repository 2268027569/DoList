# M02 任务核心 · 实施计划

> **English abstract.** Module-level implementation plan for milestone M02 (Task Core) of YiChen ToDo. It records
> what already exists, the decisions that need sign-off, the data-layer and IPC additions, the panel work, the slice
> order, and how each slice is verified. Durable decisions (channels, schema, sorting, recurrence) are folded into
> [ARCHITECTURE.md](ARCHITECTURE.md) as they are implemented; this file stays the schedule and the record of what was
> verified.

- **状态**：已确认（2026-10-19）——D2 用 `rrule` 库、D6 全屏替换式、S7/S8 本轮一并做完
- **进度**：S0 ✅ 测试地基 → S1 ✅ 数据层 → S2 ✅ IPC → S3 ✅ 列表与快速新增 → S4 ✅ 详情与字段编辑 → S5 ✅ 排序与拖拽 → **S6 ✅ 子任务与重复（2026-10-19）** → 下一片 S7 撤销 / 批量 / 附件
  - S1 落地：迁移 `0002_task_fields.sql`（加 `remind_lead_min`）、`shared/types/task.ts`、`shared/utils/id.ts`（UUID v7）、`shared/utils/task-query.ts`（过滤 → SQL + 排序白名单）、`repositories/tasks.ts`（增删改查 / 软删级联 / 恢复 / 重排）、`repositories/tags.ts`、`repositories/attachments.ts`；不变量见 ARCHITECTURE §5.1，真库用例 30 例
  - S2 落地：`shared/contracts/task.ts`（zod 契约）、`channels.ts` 的 6 条任务通道 + `event:task-changed`、`main/services/tasks.ts`（域服务，不 import electron）、`main/services/task-events.ts`（`notifyTasksChanged` 单一通知点）、`main/ipc/handlers/task.ts`（按列表注册）、`ipc/validate.ts`（共用 `invalid()`）、preload 白名单 `api.task.*` / `api.on.taskChanged`；契约 20 例 + 服务层真库 15 例
  - S3 落地：`shared/utils/task-due-label.ts`（截止 chip 纯逻辑，9 例单测）、`shared/i18n/format.ts` 补 `formatDayOffset`、`event:quick-add-focus` 通道 + preload 订阅 + 主进程 `expandPanelForQuickAdd()`、全局快捷键 `Ctrl+Shift+N`、面板 `store.ts` 任务分片 + `quick-add.tsx` / `task-row.tsx` / `task-list.tsx`（App.tsx 由 M0 演示壳改为收件箱）、中英双语 `tasks.json` 新键、`scripts/smoke-tasks.mjs`（12 项断言）
  - S1 的两处收窄：`repositories/lists.ts` 与 `taskTree()` 未建——`list_id = NULL` 就是收件箱、`queryTasks({ parentId })` 已覆盖一层子任务读取，等 M03 有真实消费者再补，避免留空壳
  - S2 的两处收窄：附件通道推到 S7（契约表里本就有）、`event:quick-add-focus` 推到 S3；计划里 S2 的「建 → 事件 → 角标 +1」冒烟断言移到 S3（面板尚无真实列表可输入，且冒烟态角标是桩值）
  - S3 的三处收窄：列表选中集与详情目标（S4 才有人用）、标签 chip 与子任务 `n/m`（S6 的行结构）、拖拽排序（S5）都还没进 `store.ts`；任务行只画「复选圆钮 / 标题 / 截止 chip / 优先级标」，够 S3 的验收，不预埋空壳
  - S3 补回的断言：`smoke-tasks` 覆盖「空库首绘 → 快捷键开面板并把光标交给输入框 → 投递标题 + 回车建任务 → `task-changed`（含主进程实算角标 0→1）→ 面板重取重绘 → 直读 SQLite 校验落库与默认值」，并把第二条任务与「回车后焦点仍在」一并验证
  - S4 落地：`shared/utils/task-dates.ts`（截止值与存储实例互转、今天/明天、开关时刻；日期非法即拒绝而非进位，8 组 16 例单测）、`task:get` 单行读取通道（契约 + handler + preload）、面板 `store.ts` 详情分片（`openTaskDetail` / `closeTaskDetail` / `refreshOpenTask` / `saveOpenTask` / `deleteOpenTask`）、`task-detail.tsx`（全屏替换列表：标题 / 备注 / 截止含时刻开关与今天·明天·清除 / 提前提醒 / 优先级 / 状态 / 标签增删 / 软删按钮 / `Esc` 返回）、`task-row.tsx` 标题改为进入详情的按钮、App 按 `openTask` 在列表与详情间切换并按 id 加 key、中英 `tasks.json` 新键
  - S4 的两处设计取舍：详情读的是**单行**而非收件箱分页——在详情里把任务标成已完成会掉出收件箱过滤，用列表那条查询会把正在编辑的屏幕清空；自由文本与日期控件只在**失焦/回车**时提交（每次重取都回写输入框会打断正在输入的内容），开关类控件即时提交
  - S4 的冒烟改造：原本靠**向面板窗口直投按键**驱动，而这条路走不通——Chromium 把焦点移动当成自己的职责，只在窗口真持有前台时才认，脚本运行从来拿不到前台，于是 Tab 不改变焦点，脚本却仍按固定次数按下去，随后的回车落在还留着焦点的控件上（实测把两条任务标成了完成）。改为冒烟时开一个调试端口（`YICHEN_SMOKE` 才开），脚本通过 DevTools 协议附着面板页面：控件按 `data-field` 名**直接设焦点**、按键直接送进渲染进程，不经过 OS 输入队列、不受输入法影响、也不需要前台；`smoke-tasks` 断言 22 项，含「改截止/优先级 → `Esc` 回列表且 chip 已变 → 重启后直读库仍一致」
  - S5 落地：`shared/utils/sort-order.ts`（`moveWithin` 越界夹取 / 无变化即原数组返回、`landingIndex` 按行中点定落点、`dropEdge` 画落点线，8 组单测）、`store.ts` 加 `moveTask`（走既有 `task:reorder`，写入后仍靠 `event:task-changed` 重取，不本地改序）、`task-list.tsx` 用 **pointer 拖拽**（抓手 `pointerdown` 时量一次各行的 band，`setPointerCapture` 收后续事件，拖动中只给被拖那一行写 `translateY`）、`task-row.tsx` 加抓手与 `Alt+↑/↓`、列表按 `useCallback` + `memo` 收敛拖动时的重渲染、中英 `tasks.json` 加 `row.dragHandle`
  - S5 的三处判断：① 不用 HTML5 `draggable`——幽灵图是整行的位图、落在透明无边框窗口上观感差，落点判断仍要自己写，且会吞掉行内控件需要的点击；改用 M01 已验证的 pointer 方案，风险表那一行随之作废。② `reorderTasks` 允许 `ids` 是**子集**（面板只发它画出来的那些行），仓储层把未点名的行按原序排到末尾，`sort_order` 因此在整组内始终是干净的 `0…n-1`；只写被点名的行会让它们占住中间的位置、两行拿到同一个 `sort_order`，日后同时显示完成与未完成的视图就会画出不确定的顺序。③ 移动后由列表把焦点放回被移动的那一行——React 在顺序变化时会卸载并重挂该行，元素一卸载焦点就没了，不放回去第二次 `Alt+↓` 就落空
  - S5 的两处收窄：**跨清单拖拽推迟**到 M03——清单（`list_id` 的赋值口与清单视图）在 M02 里还不存在，现在写这条路径只会是没人能走通、也没人能验证的空壳；撤销（S7）与 `sort_order` 的关系也留到 S7 一起处理。`Alt+↑/↓` 每次只挪一格（不跨组），够键盘与自动化用
  - S6 落地：`shared/utils/recurrence.ts`（`rrule` 之上的一层薄封装：`nextOccurrence` 两种模式、`isValidRule` 写入口校验；10 组 12 例单测，覆盖每天 / 工作日 / 每周 / 每月 31 号 / 2·29 跳四年 / DST 钟点 / 迟到只跳不补 / `COUNT`·`UNTIL` 用尽 / 非法规则不抛）、`shared/utils/task-tree.ts`（`n/m` 汇总与"全做完"，4 例单测）、`repositories/tasks.ts` 的 `subtaskCounts`（一次 `GROUP BY parent_id` 取一串父行的汇总）、`services/tasks.ts` 的 `listTasks` 同时带上 tags 与 subtasks（每行都要画，分成两次读等于每次输入都多付一次往返）、`updateTaskFromPatch` 换成返回 `{ task, next, change }` 并在勾选完成时建下一次、`contracts/task.ts` 把 `repeatRule` 收到 `min(1).max(1000).refine(isValidRule)`、`preload` 的查询返回类型改 `TaskListItem`、面板 `store.ts` 加子任务分片（`refreshSubtasks` / `addSubtask` / `removeSubtask`）、`repeat-presets.ts`（纯数据，面板不 import `rrule`）、`task-detail.tsx` 加「重复」与「子任务」两区、`task-row.tsx` 加 `n/m` chip、中英 `tasks.json` 13 个新键、`smoke-tasks.mjs` 加两张清单（phase 4d 与 phase 6）
  - S6 的三处判断：① 规则解析必须**先设 `dtstart` 再构造 `RRule`**——构造器是从它拿到的 start 推导钟点（`timeset` / `byhour` / `byminute`），先构造再把 `dtstart` 替换回去，规则会一直按默认 start 的钟点触发；② `rrule` 不坚持 `FREQ`，`COUNT=5` 单独一个会静默变成年度规则，因此 `build()` 先守着 `FREQ=` 再解析；③ 子任务输入框放在清单**下方**——放上面的话，加一条就会把光标所在的那个框往下推，连续录入时面板会在用户手底下滚动
  - S6 的两处收窄：**没有新迁移**——`repeat_rule` / `repeat_mode` 在 0001 建表时就有（M02 只需 `remind_lead_min` 一个新列，S1 已加）；**重复只支持"完成即生成下一次"**，不做"提前 N 天展开多条未来实例"——那需要 `reminders` 那样的独立实例表，属于 M04 提醒模块的活；子任务进度汇总按行带出（`subtasks: { total, done }`），不做无限层级
- **范围**：[FEATURES.md](FEATURES.md) 的 M02（**不含**自然语言解析，属 P1 且依赖 M06 的语种词表）
- **前置**：M01 已完成（标记窗口、拖拽、吸附、贴边隐藏、面板形态、状态推送）
- **约定**：中文文档；英文提交信息与代码注释；每个切片独立提交、独立验证

---

## 1. 目标与边界

M02 是「看得见的功能」的第一个模块：**数据模型 + 读写通道 + 面板里的列表与详情**。它决定后面 M03（视图）、M04（提醒）、M10（同步）能不能只做「读」和「组合」。

| 本轮做 | 本轮不做 |
|---|---|
| 任务的增删改（软删 + 恢复）、批量操作、撤销 | 自然语言解析（P1，依赖 M06 词表） |
| 基础字段：标题 / 备注 / 截止（含时刻）/ 优先级 / 状态 / 标签 / 所属清单 | 智能清单、分组、筛选、搜索（M03） |
| 扩展字段：预估 / 实际耗时、创建与完成时间 | 提醒实例与系统通知（M04） |
| 子任务（一层）+ 完成进度汇总 | 日历 / 看板（P2） |
| 重复任务（RRULE 预设 + 自定义，两种模式） | 富文本粘贴拆任务、粘贴 URL 抓标题（P2，需联网） |
| 快速新增、详情面板、拖拽排序（组内 + 跨清单） | 附件（P1，见 S7，可裁） |
| 撤销（Ctrl+Z） | 回收站的独立界面（M03 的归档视图承载） |

---

## 2. 现状盘点

**已有（可直接用）**

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 完整表结构 | [0001_init.sql](file:///c:/Users/Administrator/Desktop/toDoList/src/main/db/migrations/0001_init.sql) | `tasks` / `lists` / `tags` / `task_tags` / `attachments` 已建好，**M02 只需一个新列** |
| 迁移器与连接 | [migrate.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/db/migrate.ts)、[connection.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/db/connection.ts) | 二者都不 import `electron`，可在 Vitest 里直接开临时库（当且仅当 D1 通过） |
| 单一 IPC 注册器 | [register.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/ipc/register.ts) | 值返回错误模型 + zod 校验；M02 拆出 `handlers/task.ts` |
| 状态推送链路 | [marker-state.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/services/marker-state.ts)、[broadcast.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/services/broadcast.ts) | 任务写入后调一次，角标 / 进度环自动跟上 |
| 日期与格式化 | [day.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/utils/day.ts)、[format.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/i18n/format.ts) | `localDayBounds`、`formatRelative`、`weekStartDay` 已是 M02 需要的 |
| `tasks` 文案命名空间 | [locales/en/tasks.json](file:///c:/Users/Administrator/Desktop/toDoList/locales/en/tasks.json) | 已有 `inbox.title` / `inbox.empty` / `quickAdd.placeholder` / `summary.pending`（ICU 复数） |
| 冒烟底座 | [smoke.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/platform/smoke.ts)、[smoke-marker-input.mjs](file:///c:/Users/Administrator/Desktop/toDoList/scripts/smoke-marker-input.mjs) | `YICHEN_SMOKE=1` + `status.json` 事件流 + 真实系统输入 |

**缺口**

- 没有任务仓储层（`repositories/tasks.ts` 目前只有 `markerCounts`）
- 没有任务相关 IPC 通道、zod schema、`event:task-changed`、preload 白名单方法
- 没有任务数据的前端状态与界面（[App.tsx](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/App.tsx) 还是 M0 的设置演示壳）
- 没有全局快速新增快捷键（[shortcuts.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/platform/shortcuts.ts) 注释里已预留）
- `remind_lead_min` 列缺失（FEATURES 的「提醒时间」基础字段）
- 没有仓储层的测试地基（临时库 + 迁移 + 断言的 helper），也没有可重复的冒烟数据库（冒烟脚本目前用的是真实 `userData` 库）

---

## 3. 关键决策

三条需要拍板的（D2 / D6 / S7–S8 范围）已于 2026-10-19 确认，均按推荐选项执行；其余决策我按推荐执行并在实现时记录。

| # | 决策 | 选项 | 推荐 | 理由与影响 |
|---|---|---|---|---|
| D1 | 仓储层测试怎么跑 | A. Vitest 直连临时 SQLite<br>B. 纯逻辑单测 + Electron 内集成验证 | **A（已实测）** | 我原以为 `better-sqlite3` 是 V8-API 模块、Node 下会 ABI 不匹配——**实测不成立**：v13 用 `node-addon-api`（Node-API），prebuild 按 `平台-架构` 而非 ABI 命名，Node v24 与 Electron 加载同一份 `prebuilds/win32-x64.node`。故仓储层直接走 Vitest + 临时库，无需第二份构建 |
| D2 | RRULE 用库还是自研（**已确认：A**） | A. `rrule`（纯 JS，随主进程打包，~50 kB）<br>B. 自研子集（每天/工作日/每周/每月/每年，~200 行） | **A** | 「自定义」等于任意 RRULE：`BYDAY` / `INTERVAL` / `COUNT` / `UNTIL` / 月末 31 号 / 闰年 2/29 / DST 都是踩坑点，自研要重造轮子且难覆盖。规则是纯函数，放 `shared/utils/recurrence.ts` 包一层，含 `after_completion` 语义，仍可单测。回退：B（若包在 electron-vite 下有 ESM/CJS 问题） |
| D3 | 排序模型 | A. 组内整数重排（一个事务覆盖受影响范围）<br>B. 分数/字典序 rank（少写行，但要处理精度耗尽） | **A** | 这是个人级待办（量级数百），重排一次是本机 SQLite 上的一次小事务，亚毫秒级；B 的精度与重整逻辑是长期负担。**仅在插入到中间时重排**，追加到末尾不重排；跨清单拖拽同理 |
| D4 | 主进程如何通知渲染层 | A. 推送「已变更」描述 + 渲染层重取当前查询<br>B. 推送完整任务列表镜像 | **A** | 主进程是唯一数据源，B 等于把状态维护在两侧、迟早不一致。查询走索引且带 LIMIT，重取成本远低于同步 bug 的代价 |
| D5 | 提醒字段归属 | A. `tasks.remind_lead_min`（相对 `due_at` 的提前量）<br>B. 在 M02 就生成 `reminders` 实例 | **A** | §5.3 已定「实例由调度器生成、落在 `reminders`」，那是 M04 的事。M02 只存「用户意图」，M04 展开；也避免 M02 先写一行 M04 会重算的数据 |
| D6 | 详情面板布局（**已确认：A**） | A. 全屏替换式（列表 ↔ 详情，带返回）<br>B. 侧栏 / 抽屉（列表与详情并排） | **A** | 面板宽度 320–640 DIP（默认 380），并排放两个可读区域会挤压到不可用；全屏替换在窄容器里更稳 |
| D7 | 撤销的实现 | A. 主进程内存逆操作栈（上限 30 条，退出即失效）<br>B. 落库的操作日志表 | **A** | 覆盖删除 / 完成 / 优先级 / 日期 / 移动 / 标题改写（存变更前的值）；软删让「撤销删除」只是一次 `deleted_at = NULL`。重启后不能撤销，可接受且无需新表 |
| D8 | E2E 用什么 | A. 扩展现有冒烟脚本（真实键盘 + 事件流断言）<br>B. 引入 Playwright for Electron | **A（本轮）** | 冒烟底座已能开真应用、驱动真实输入、读事件；Playwright 是新增依赖与一套新维护面，等 M03 界面变复杂时再评估 |
| D9 | 面板失焦收起 vs 编辑中 | A. 即时保存（每次改动立刻入库）<br>B. 草稿 + 保存按钮 | **A** | §9.6 的失焦收起是 M01 已定的行为；若用草稿，用户切窗口就丢内容。即时保存同时消掉了「保存」这个按钮和脏状态 |

---

## 4. 数据层改动

**迁移 `0002_task_fields.sql`**（唯一新增列，追加式，不改 0001）

```sql
ALTER TABLE tasks ADD COLUMN remind_lead_min INTEGER;  -- 提前 N 分钟提醒；NULL = 不提醒
```

**仓储层**（`src/main/db/repositories/`）

| 文件 | 内容 |
|---|---|
| `tasks.ts` | 扩展：`createTask` / `updateTask(patch)` / `softDelete(ids, cascade)` / `restore(ids)` / `queryTasks(filter)` / `reorderTasks(scope, ids)` / `taskTree(parentId)`；保留既有 `markerCounts` |
| `tags.ts` | `findOrCreateTag(name)` / `attachTags` / `detachTags` / `tagsOfTasks(ids)`（`name` 已是 UNIQUE，用 upsert） |
| `attachments.ts` | `addAttachment` / `removeAttachment` / `attachmentsOfTask`（只存路径引用，不复制文件） |
| `lists.ts` | 仅 `defaultListId` 之类的最小读取，供 M03 接管前使用（M03 才做清单 CRUD） |

**不变量（写进仓储层，不只写在文档里）**

- 子任务**只允许一层**：`parent_id` 指向的任务本身不得再有 `parent_id`
- 完成父任务**不级联**子任务；父行只显示 `已完成/总数`
- 软删父任务时子任务一并软删（同一事务），恢复同理
- 所有写操作走同一事务，并统一返回受影响行（供撤销与事件描述使用）
- 时间一律 UTC 毫秒；「今天」的判定交给 `localDayBounds`

**这个模块不写 `sync_journal`**：文件夹同步（M10）用**迁移里的 SQL 触发器**兜底，避免在 M02 的每条写路径上插埋点。

---

## 5. IPC 契约（`shared/contracts/task.ts` + channels + preload）

| 通道 | 载荷 | 说明 |
|---|---|---|
| `task:query` | 过滤对象（`listId` / `status` / `parentId` / `text` / `dueFrom` / `dueTo` / `limit` / `offset` / `sort`） | M03 的智能清单就是在它上面预置过滤，不在 M02 内定名 |
| `task:create` | `{ title, listId?, parentId?, priority?, dueAt?, dueHasTime?, remindLeadMin?, notes?, tags?[] }` | 标题 `trim().min(1).max(500)` |
| `task:update` | `{ id, patch }`，patch 为字段子集 | 即时保存走它 |
| `task:delete` / `task:restore` | `{ ids[] }` | 软删 = 进回收站 |
| `task:reorder` | `{ scope, ids[] }`（scope = 某父任务下 / 某清单 / 收件箱） | 目标顺序，D3 的重排 |
| `task:bulk` | `{ ids[], op }`（完成 / 改优先级 / 改日期 / 加标签 / 移清单 / 删除） | P1 |
| `task:undo` | — | 撤销栈弹栈（D7） |
| `attachment:add` / `:remove` / `:open` | `{ taskId }` / `{ id }` | 主进程用 `dialog` 与 `shell.openPath`，渲染层不碰 `fs` |
| `event:task-changed` | `{ kind, ids[], scope? }` | 单向广播，渲染层据此重取（D4） |
| `event:quick-add-focus` | — | 全局快捷键展开面板后聚焦输入框（S3 落地时定名，只发给面板窗口） |

- 每个 handler 第一行 `schema.safeParse`，失败返回 `VALIDATION_FAILED`（沿用现有注册器模型）
- `register.ts` 只保留注册骨架，任务域拆到 `ipc/handlers/task.ts`，与 §2 的目录规划一致
- **一次写入 = 一次通知**：仓储写完后统一调 `notifyTasksChanged({ kind, ids, scope })`，函数内部只做三件事——推标记状态、广播 `event:task-changed`、压撤销栈

---

## 6. 渲染层（面板）

| 区域 | 内容 | 依据 |
|---|---|---|
| 快速新增 | 单行输入，`Enter` 建任务并保持焦点继续输入；由 `Ctrl+Shift+N` 从任意位置唤起（快捷键文案已在 `tasks.json` 的 `inbox.empty` 里预告） | FEATURES M02 P0 |
| 列表 | 复选圆钮（完成）/ 标题 / 截止 chip / 优先级标 / 标签 chip；子任务缩进一层，父行显示 `n/m`（**S6 已交付 `n/m` chip**）；空状态用已有 `inbox.empty` | — |
| 详情 | 全屏替换式（D6）：标题、备注、截止（含「仅日期 / 含时刻」开关 + 今天 / 明天 / 清除）、提前提醒分钟、优先级、状态、标签增删、软删按钮；`Esc` 返回。**S4 已交付这些**；**S6 已交付**「重复」（5 个预设 + 自定义 RRULE 输入 + `fixed` / `after_completion` 两种模式）与「子任务」两区（清单 + `n/m` + 增删）；所属清单等 M03 有清单可用时补，预估/实际耗时与附件区等 S7 | — |
| 排序 | 列表内拖拽（**S5 已交付**，用 M01 验证过的 pointer 方案而非 HTML5 `draggable`）+ 键盘替代 `Alt+↑/↓`（无鼠标可用，也让自动化可测）；跨清单拖拽等 M03 有清单视图后补 | FEATURES M02 P0 |
| 批量 | 选择模式 + 底部操作条（改优先级 / 改日期 / 加标签 / 移清单 / 完成 / 删除） | P1 |
| 撤销 | 回收站条样式 toast + `Ctrl+Z` | P1 |
| 状态 | 新增 `store.ts` 的任务分片：查询结果 + 选中集 + 详情目标；**不缓存派生数据**，重取即刷新 | D4 |

样式一律走既有三层令牌（`--bg-*` / `--text-*` / `--accent` / `--status-*`），`check-tokens.mjs` 已在 CI 拦硬编码色值。

---

## 7. 纯逻辑与单测清单（不依赖数据库，D1 不影响这部分）

| 文件 | 覆盖 |
|---|---|
| `shared/utils/task-query.ts` | 过滤对象 → SQL 片段 + 绑定参数（含 `deleted_at` 兜底、LIMIT 上限、排序白名单） |
| `shared/utils/sort-order.ts` | **S5 已实现**：`moveWithin`（把一项移到另一位置，越界夹取，无变化时原数组返回）、`landingIndex`（按行中点把指针位置换算成落点序号）、`dropEdge`（落点线画在目标行的哪一边），8 组 12 例单测。**未做**：分数 rank、跨清单后继——D3 选了组内整数重排，用不上 |
| `shared/utils/recurrence.ts` | **S6 已实现**：`nextOccurrence`（`fixed` 锚在原到期、上界取 `max(due, now)` 所以迟到的只跳不补；`after_completion` 重锚在完成日但保留任务自己的钟点；日期型的落到本地零点）、`isValidRule`（写入口校验，非法规则一律拒绝）、`build`（先设 `dtstart` 再构造 `RRule`，并守着 `FREQ=`）。12 例单测 |
| `shared/utils/task-tree.ts` | **S6 已实现**：`progressText`（`n/m`，空清单返回 `null`）、`allSubtasksDone`，4 例单测。**未做**：`taskTree()` 建树——一层子任务用 `queryTasks({ parentId })` 就够，「一层限制」的校验在仓储层（`assertTopLevelParent`） |
| `shared/utils/task-dates.ts` | **S4 已实现**：存储实例 ↔ 日期/时刻控件值互转（非法日期拒绝而非进位）、今天/明天 = 本地零点、开关「含时刻」｜**未做**：本周末 / 下周 / 自定义偏移——等 S5 之后的日期选择器有真实落点再补 |
| `main/services/undo.ts` | 逆操作栈（上限、覆盖的操作集、栈空返回 `ok(null)`） |
| `shared/contracts/task.ts` | zod 边界：空标题、超长、优先级越界、非法 `dueAt`、两层子任务被拒 |

---

## 8. 实施切片（每片独立提交、独立验证）

| 切片 | 产出 | 验证 |
|---|---|---|
| **S0 测试地基** | ① 临时库 helper `src/main/db/test-db.ts`（临时目录 → 迁移到最新 schema → 跑断言 → 关库并清理）② 用既有 `markerCounts` 写第一个真库用例，证明地基可用 ③ `databaseFile()` 支持冒烟专用库（`YICHEN_SMOKE_DB`，仅 `YICHEN_SMOKE=1` 生效），让冒烟可重复 ④ 结论回写文档 | `npm run test` 真库用例通过；同一冒烟断言集能连跑两次 |
| **S1 数据层** | 迁移 0002 + 任务/标签/附件仓储 + 不变量 | 仓储测试（按 D1 结论）或 Electron 内集成；纯逻辑单测 |
| **S2 IPC** | `contracts/task.ts`、通道、`handlers/task.ts`、preload 白名单、`notifyTasksChanged` | schema 单测；冒烟断言「建 → 事件 → 标记角标 +1」 |
| **S3 列表与快速新增** | 面板真实列表 + 快速新增 + 全局快捷键 + 空状态 | 冒烟：键盘输入标题回车 → 断言任务出现且刷新后仍在（重启后仍在 = 落库） |
| **S4 详情与字段编辑 ✅** | 全屏详情、全部基础字段、即时保存（D9）、`Esc` 返回 | 冒烟：改优先级/截止 → 断言列表 chip 变化且重启后一致（24/24 实测通过） |
| **S5 排序与拖拽 ✅** | 组内 DnD（pointer）+ `Alt+↑/↓`；跨清单推迟到 M03 | 冒烟：`Alt+↓` → 断言列表重画成新顺序且焦点仍在被移动的行 → `Alt+↑` 复位 → 抓抓手拖到下一行下方 → 断言落库顺序；重启后顺序不变（`sort_order` 子集重排 + 焦点保持 + 合成拖拽共 29/29 实测通过） |
| **S6 子任务与重复 ✅** | 一层子任务 + `n/m`；重复预设 + 自定义；完成后生成下一次到期 | RRULE 单测（12 例）+ 服务层真库用例（勾选生成下一次、`after_completion` 重锚、`COUNT` 用尽不生成、新实例无子任务）；冒烟：在详情里录一条子任务（断言 `parentId` 指向父行且光标留在输入框）→ 点「每天」断言库里存上 `FREQ=DAILY` → `Esc` 后从 DOM 读父行的 `0/1` chip → **重启后**打开这条重复任务勾选完成 → 断言一次写入报出两行、顶层从 2 行变 3 行、新行是 `todo` / `FREQ=DAILY` / 到期为后天本地零点 / 无子任务 → `Esc` 后断言列表把新实例画在已完成那行的位置上（`Esc` 之后才读列表：详情打开时屏幕上就没有列表） |
| **S7 P1 收尾** | 撤销 + 批量 + 附件 | 冒烟：删除 → `Ctrl+Z` → 断言回来；批量改优先级 |
| **S8（可选，M01 收尾）** | 右键菜单（快速新增 / 今天 / 设置 / 暂停提醒 / 退出）——S3 之后「快速新增」已有落点 | 冒烟：右键 → 断言菜单与首项行为 |

S0–S6 已全部过门，主干可交付「能记事、能改、能排序、能拆清单、能重复」——M02 的 P0 已全部落地；S7/S8 已按拍板范围一并做。

---

## 9. 验证与验收

- **质量门**（每片必过）：`typecheck`（node/web）、`lint`（含令牌检查）、`test`、`i18n:check`、`build`
- **仓储层走真库单测**：D1 实测确认 `better-sqlite3` 是 Node-API 模块（ABI 无关），仓储层与迁移链可以直接在 Vitest 里用临时库验证，不必只靠 E2E
- **冒烟**：新增 `npm run smoke:tasks`，沿用「真实系统输入 + `status.json` 事件流」的既有模式；断言点写到事件里，失败信息给出期望值
- **可重复性**：冒烟用独立数据库文件，跑前删库 → 同一断言集可反复跑
- **冒烟里的输入只有快捷键走 OS**：S3 曾用 `WM_CHAR` 把标题直投面板窗口以绕开输入法的组合态；S4 起改为通过 DevTools 协议把按键直接送进渲染进程，输入法与输入队列都不再参与，只有打开面板的全局快捷键仍必须来自真实输入（`RegisterHotKey` 只对输入队列产生的事件生效）
- **冒烟里的控件定位走 DevTools 协议**（S4 起）：脚本按 `data-field` 名直接设焦点，不再靠数 Tab 次数。数次数的那版是坏的：Chromium 只在窗口持有前台时才认 Tab 这类焦点移动，脚本拿不到前台，于是 Tab 不改变焦点而按次数照按，随后的回车就落到别的控件上
- **冒烟里的拖拽是合成鼠标事件**（S5 起）：`Input.dispatchMouseEvent` 的 press/move/release 会被 Chromium 转成 pointer 事件，于是面板自己的 pointer 处理链（含 `setPointerCapture`）真的跑一遍——不需要真鼠标，也不需要前台；坐标取自页面自己的矩形，因此脚本不必知道窗口在屏幕上的位置
- **冒烟里的列表只在自己上屏时才报**（S6 发现）：`tasks-rendered` 由列表组件上报，而详情打开时 App 画的是详情、列表根本没挂载，所以勾完任务要先 `Esc` 回列表才能读到它画了什么；同理 `readTasks()` 默认只取顶层（`parent_id IS NULL`）——`sort_order` 是**组内**序号，把父子两组合在一起按它排序会让两组互相插序，第一版就是因此在加了子任务之后读错行
- **手动验收**（我会自己操控电脑跑一遍）：中文输入法下回车建任务、DPI 150%、约 500 条任务的滚动流畅度、多显示器上面板贴边
- **性能取舍**：本轮**不做列表虚拟化**——先用真实数据量测一次；只有当渲染明显掉帧才引入（避免为不存在的问题写复杂代码），结论写回 §9.7 性能预算

---

## 10. 风险与回退

| 风险 | 影响 | 回退 |
|---|---|---|
| ~~HTML5 拖拽在无边框窗口表现异常~~ | 排序不可用 | **S5 未采用 HTML5 拖拽**，直接用 M01 已验证的 pointer 方案（`setPointerCapture` + 自己做落点预览），此风险排除 |
| ~~`rrule` 在 electron-vite 下 ESM/CJS 不兼容~~ | ~~重复功能延期~~ | **S6 已接入**：`rrule` 打进主进程 bundle，`typecheck` / `build` / 真库单测 / 冒烟全过，此风险排除（回退方案 B——自研子集只支持 5 个预设——未用上） |
| 用户手打的自定义规则被静默接受（`rrule` 对 `FREQ=` 空值等是宽容的） | 任务存进去却永不重复 | **S6 已规避**：写入口 `isValidRule` 守着 `FREQ=` 并把两段解析都包在 try/catch 里，非法规则回 `VALIDATION_FAILED`；面板保留原文不清空，改的是错字而不是重打一遍 |
| 面板失焦即收起与编辑冲突 | 内容丢失 | D9 即时保存已规避；若仍有边缘情况，再评估「详情打开时不因失焦收起」 |
| 任务量增长后查询变慢 | 列表卡顿 | 先靠索引 + LIMIT + 实测定位；虚拟化留到有数据支撑时再做 |

---

## 11. 明确不做（本轮）

- 自然语言解析、粘贴 URL 抓标题（P2，需联网，与本地优先定位冲突，需单独评估）
- 智能清单 / 分组 / 筛选 / 搜索 / 归档界面（M03）
- 提醒实例与系统通知（M04）——M02 只存 `remind_lead_min`
- 清单 CRUD 与标签管理界面（M03；M02 只用到 `list_id` 赋值与标签挂载）
- `sync_journal` 写入（M10，用触发器实现）
- 回收站独立界面（M03 的归档视图承载）
