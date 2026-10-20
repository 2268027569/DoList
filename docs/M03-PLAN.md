# M03 视图与组织 · 实施计划

> **English abstract.** Module-level implementation plan for milestone M03 (Views & Organization) of YiChen ToDo.
> It records what already exists, the decisions that need sign-off, what the data layer and the panel need, the
> slice order, and how each slice is verified. Durable decisions are folded into [ARCHITECTURE.md](ARCHITECTURE.md)
> as they are implemented; this file stays the schedule and the record of what was verified.

- **状态**：S1 已交付（门全过：typecheck / lint / test 223 例 / i18n:check / build / `smoke:tasks` 69 项 / `smoke:marker` 21 项）
- **进度**：S1 智能清单侧栏与归档（已完成）→ **S2 自定义清单（下一步）** → S3 搜索与空状态 → S4 标签与筛选 → S5 分组排序
- **前置**：M02 已收尾（S0–S8 全过门）。面板当前的「视图」只有收件箱 / 今天两项，由头部两个 tab 承载。

---

## 1. 起点：已经有什么

| 能力 | 现状 | 出处 |
|---|---|---|
| 视图是过滤条件 | `filterFor(view)` 返回 `TaskQueryInput`；store 只存一个 `view` 字段 | M02 §6 / S8 |
| 查询能力 | `status`（含数组）、`listId`、`parentId`、`text`、`dueFrom`/`dueTo`（半开区间）、`sort`、`limit`/`offset`、`includeDeleted` | [task.ts](../src/shared/types/task.ts) `TaskFilter` |
| 排序白名单 | `manual` / `due` / `priority` / `created` / `title` | [task-query.ts](../src/shared/utils/task-query.ts) `ORDER_BY` |
| 状态枚举 | `todo` / `doing` / `done` / `cancelled` | `TASK_STATUSES` |
| 已完成行的样式 | 勾选圆钮（实心 + 勾）、标题划线 + 变灰、`row.markDone` / `row.markUndone` 文案 | [task-row.tsx](../src/renderer/panel/src/task-row.tsx) |
| 完成/恢复写入口 | `toggleTask(id, done)` → `task:update`，靠 `event:task-changed` 重取 | [store.ts](../src/renderer/panel/src/store.ts) |
| 软删级联与恢复 | 已实现（M02 S7 的撤销栈用它） | `repositories/tasks.ts` |
| 面板宽度 | 默认 380 DIP，`clampPanelSize` 限 320–640 | [panel-geometry.ts](../src/shared/utils/panel-geometry.ts) |

**结论**：M03 的智能清单几乎不需要动数据层——**每个清单都是同一个查询换一组过滤条件**，这与既有的「视图是过滤条件，不是另一份数据」是同一条判断（ARCHITECTURE §5.1）。行 UI 也已经能画已完成行，所以「归档」缺的只是入口。

## 2. 本轮范围（S1）与决策

用户的诉求是「已完成的待办事项看不到」。S1 用 M03 的智能清单侧栏来承载它。

### D1 侧栏形态：48 DIP 的窄图标条

M02 D6 已经判定「380 宽的面板里并排两栏会挤到不可读」（详情因此做成全屏替换式）。同一条理由排除了 140–180 DIP 的宽侧栏。剩下两个可行形态：

| 方案 | 代价 | 判断 |
|---|---|---|
| **窄图标条 48 DIP（选它）** | 列表从 356 → 约 308 DIP 可用宽 | 常驻可见，零额外点击；宽度代价换 6 个清单入口 |
| 覆盖式抽屉（默认收起，点按钮滑出） | 多一次点击才能切清单，且选完要再关闭 | 可发现性差，且抽屉滑出会挡住列表 |

图标**自绘内联 SVG**（20×20，stroke 风格）：项目已否决 UI 组件库，M12 也把「图标自绘」列为素材合规要求。
侧栏**不显示计数**：6 个清单各查一次等于每次打开面板多 6 次往返；当前视图的计数头部已有。

### D2 本轮做 6 个清单，「全部」推迟

`inbox` / `today` / `tomorrow` / `upcoming` / `completed` / `cancelled`。

`cancelled` 这个 id 与 `TASK_STATUSES` 同名——视图名和状态名用两个词，用户会以为它们是两件事。

**不做 `all`**：现在还没有自定义清单，`listId: null` 的「收件箱」与「全部」是**同一个查询**——两个入口点了给同样结果，正是项目里那条「点了没反应的项比短菜单更糟」的同类问题。等 S2 自定义清单落地、「全部」= 跨清单时再进来。

### D3 各清单的过滤条件

```
inbox      { parentId: null, status: ['todo', 'doing'] }
today      inbox + dueTo: 今天末尾
tomorrow   inbox + dueFrom: 明天零点, dueTo: 明天末尾
upcoming   inbox + dueFrom: 明天零点, dueTo: 第 7 天末尾     // 「未来 7 天」
completed  { parentId: null, status: ['done'], sort: 'completed' }
cancelled  { parentId: null, status: ['cancelled'] }
```

- 「今天」沿用既有语义：**逾期含在内**（半开区间 `[−∞, 今天末尾)`），无截止日期的留在收件箱。
- 「明天」用**闭区间**（`dueFrom` 明天零点 + `dueTo` 明天末尾），所以只含明天到期的；逾期的不混进来。
- 「即将到期」= 明天零点起 7 天，**不含今天**（今天有自己的清单）。

### D4 已完成需要一个新排序键

已完成的顺序不该是 `sort_order`（那是拖动排出来的"该做的事"的顺序），而是**完成时间倒序**——最近完成的在最上面。`completed_at` 列已存在（`0001_init.sql`），但 `TASK_SORTS` 没有这个键，所以 S1 要加一行：`completed: 't.completed_at DESC, t.sort_order ASC'`（为 `completed_at` 为空的历史行留一个回退序）。

### D5 恢复语义：勾掉即回到 `todo`

在「已完成」里点勾钮 = 取消完成 → `status: 'todo'`。**不记录"完成前是什么状态"**：从 `doing` 完成的再恢复成 `doing` 需要在行里多存一个字段、并在所有写入口维护它，为一个可以手动改回去的差别付这个代价不值。
「已取消」里**不给勾钮**（把已取消的标回"完成"没有意义），要改状态走详情面板。行样式上 `cancelled` 也要划线 + 变灰（现在只有 `done` 有这个分支）。

### D6 快速新增的默认日期按视图给

沿用 S8 定下的规则：**视图没有确定日期就不给**，否则刚建的行会立刻掉出当前过滤。

| 视图 | 新建任务的 `dueAt` |
|---|---|
| 收件箱 | 无 |
| 今天 | 当天零点（已实现） |
| 明天 | 明天零点 |
| 即将到期 | 明天零点（落在窗口内） |
| 已完成 / 已取消 | **不提供输入框**——在"已完成"清单里加一条"待办"是荒谬的，空态说明去哪儿建 |

### D7 不做的事（本轮）

- 自定义清单（S2）、标签系统（S4）、筛选与保存视图（S4）、分组排序（S5）、搜索（S3）、日历 / 看板（P2）
- 侧栏的拖拽排序、清单计数、折叠动画
- 已完成 / 已取消的批量操作与分页（数据量上来再说，M03 记录风险即可）

## 3. 数据层改动（S1）

只有一处：`TASK_SORTS` 加 `'completed'`，`ORDER_BY` 加对应一行。**新增默认值、无迁移、无新表**。

## 4. IPC / 契约改动（S1）

无。`event:panel-view` 的载荷已经是 `{ view: PanelView }`，只是 `PanelView` 的取值范围从 2 个变成 6 个。

## 5. 渲染层改动（S1）

| 文件 | 改动 |
|---|---|
| `shared/types/app.ts` | `PanelView` 扩到 6 个值；`ARCHIVE_VIEWS` / `isArchiveView()` 导出「归档」这一概念，供头部、列表与行三处共用同一个判断 |
| `panel/src/store.ts` | `filterFor()` 分派 6 个视图；`addTask` 按视图给默认日期（D6）；已完成 / 已取消视图不接受新增（`isArchiveView` 拦在写入口，不只挂在 UI 上） |
| `panel/src/views.ts`（新建） | 视图顺序 + 每个视图的两个文案键（名称、空态）。一张表给三个读者——侧栏、头部、列表空态——它们必须一致；键带命名空间，因为三个读者的默认命名空间并不相同 |
| `panel/src/view-sidebar.tsx`（新建） | 48 DIP 窄条，6 个自绘 SVG 图标 + 当前项高亮 + `aria-current="page"`；`data-field="view-<id>"` 供冒烟定位 |
| `panel/src/view-icon.tsx`（新建） | 6 个内联 SVG，零依赖，`currentColor` 跟随按钮状态 |
| `panel/src/App.tsx` | 头部两个 tab 退役 → 侧栏承载切换；头部改为「当前清单名（大字号）+ 计数 + 外观按钮」；主体改为「侧栏 + 列表」横向布局；归档视图不画快速新增 |
| `panel/src/task-list.tsx` | 空态按 6 个视图分文案；`tasks-rendered` 上报已含 `view` |
| `panel/src/task-row.tsx` | `cancelled` 走划线 + 变灰（`done` 与 `cancelled` 合成一个"这件事不用做了"的样式分支）；已完成 / 已取消视图里隐藏拖拽抓手，已取消视图再隐藏勾钮（排序、批量在这里没有意义）；勾钮加 `data-field="row-toggle"` |
| `locales/en|zh-Hans/tasks.json` | 5 个新清单名、5 条空态、`view.count` 计数文案；退役 `summary.pending`（头部不再说"今天"，它现在说的是**当前视图**） |

**为什么头部 tab 要退役而不是和侧栏并存**：两个控件落在同一个 `view` 字段上，并存就是同一个状态的两个入口——用户无法判断哪个是"当前"，而且点 tab 与点侧栏项会各自动一次。菜单里的「今天」（M02 S8）仍然只发 `event:panel-view`，落到侧栏选中项上，不改。

## 6. 切片与验证

| 片 | 内容 | 验证 |
|---|---|---|
| **S1** ✅ | 侧栏 + 6 清单 + 已完成 / 已取消归档（含恢复）+ 空态 + 默认日期 | `smoke:tasks` 新增 phase 11（69 项全过）：断言侧栏 `aria-current` 与列表的 `view` 一致 → 在收件箱勾掉一行 → 「已完成」画出的行集合 = 库里 `done` 集合、且归档视图无快速新增 → 在该行点勾 → 断言库里回到 `todo` 且归档少一行 → 把一行经详情标为已取消 → 「已取消」只画 `cancelled`、且既无勾钮也无输入框 → 「明天」新增一条 → 断言 `dueAt` = 明天本地零点、`dueHasTime = 0`、且它立刻被画出来 → 「即将到期」画出的集合 = 手算的 `[明天零点, 第 8 天零点)` 窗口 → 切回收件箱断言 `view`、行数与输入框都回来了 |
| S2 | 自定义清单：建 / 改 / 删 / 排序 / 归档 + 把行拖到清单（补 M02 S5 遗留的跨清单拖拽）+「全部」 | 冒烟：建清单 → 拖一行进去 → 断言 `list_id` 与清单视图行数；重启后一致 |
| S3 | 搜索（`text` 字段已就绪）+ 空状态与首次引导 | 冒烟：输入关键词 → 断言只出匹配行；清空 → 断言回到原视图 |
| S4 | 标签系统（多标签 + 颜色 + 筛选）+ 保存视图 | 冒烟：贴标签 → 按标签筛 → 断言行集合 |
| S5 | 分组排序（按清单 / 优先级 / 截止日 / 标签分组；手动 / 时间 / 优先级 / 标题排序） | 冒烟：切换排序键 → 断言行顺序与库里一致 |

每片独立提交、独立过门（typecheck / lint / test / i18n / build + 两套冒烟）。

**S1 的一处实现偏差**：「选择框与拖拽抓手一并隐藏」这条只做了一半——归档视图里**保留**了行首的选择框。理由是批量命令里的「完成」与「删除」对归档行是有意义的（已取消的行标为完成、清掉旧记录），把入口藏起来而命令仍然可用只会更奇怪。真正没有意义的两样已经去掉：**拖拽抓手**（`sort_order` 是"该做的事"的顺序，归档按完成时间排）与**已取消视图的勾钮**（标回"完成"不是那条路的语义）。归档视图的批量与分页本身仍按 D7 推迟。

## 7. 风险

| 风险 | 处理 |
|---|---|
| 窄侧栏挤到列表不可读 | 48 DIP 已是最小常驻代价；若实测仍挤，改默认面板宽度到 420（不动已存的用户尺寸） |
| 「已完成」数据量大后一次全取 | 列表已有 `limit` / `offset`，S1 先不分页；数据量到千级再引入虚拟滚动（M13 记风险） |
| 6 个视图的过滤条件写错（尤其"明天"的闭区间） | 冒烟逐视图断言行集合，不只断言 `view` 字段 |
| 侧栏与菜单两条路径的状态不一致 | 两条路径都落在同一个 `view` 字段（M02 §6 已定），S1 不改这条 |

## 8. 评审记录

S1 开工前列的三条待评审项，业主已选推荐项，均已按此实现：

1. **D1 侧栏形态**：48 DIP 窄图标条（选定）vs 覆盖式抽屉
2. **D2 视图集合**：本轮 6 个、`全部`推迟（选定）；`全部` 进 S2
3. **D5 恢复语义**：勾掉回 `todo`（选定）vs 记录完成前的状态
