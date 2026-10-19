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

### M02 任务核心（进行中）

- M02 模块级实施计划：[docs/M02-PLAN.md](docs/M02-PLAN.md)（数据层、IPC 契约、面板界面、8 个切片与验证方式；RRULE 采用 `rrule`、详情为全屏替换式、P1 与 M01 右键菜单本轮一并完成）
- 测试地基：新增 `src/main/db/test-db.ts` 的 `withTempDatabase()`，仓储层与迁移链改为在 Vitest 直连临时 SQLite 上验证；首个真库用例（`markerCounts`）覆盖空库、逾期边界、今日窗口、软删过滤与本地午夜分界，共 4 例
- 冒烟可重复：`paths.databaseFile()` 支持 `YICHEN_SMOKE_DB`（仅在 `YICHEN_SMOKE=1` 下生效），冒烟脚本据此把数据库指向自己那份临时文件，每次运行都从空 schema 开始、不污染也不依赖真实用户数据
- 更正一处先前的错误判断：`better-sqlite3` v13 是 Node-API（`node-addon-api`）模块，ABI 无关，Electron 与开发机的 Node 加载同一份 prebuild；ARCHITECTURE §4 / §11 / §12 的对应措辞已更正

#### S1 数据层

- 迁移 `0002_task_fields.sql`：给 `tasks` 加 `remind_lead_min`（提前 N 分钟提醒，NULL = 不提醒）。只存用户意图，提醒实例留给 M04 的调度器展开
- `shared/types/task.ts`：任务实体、草稿 / 补丁、过滤对象与重排分组类型，主进程、preload 与面板共用
- `shared/utils/id.ts`：UUID v7 生成器（48 位毫秒前缀），索引局部性与同步合并顺序都靠它，随机 v4 给不了
- `shared/utils/task-query.ts`：过滤对象 → SQL 片段 + 绑定参数；排序走白名单（非法值回落到手动顺序）、LIKE 通配符转义、行窗口上限 500
- `repositories/tasks.ts`：`createTask` / `updateTask` / `getTask` / `queryTasks` / `reorderTasks` / `softDelete` / `restore`，并保留既有 `markerCounts`；不变量（子任务只一层、软删级联子任务、恢复只带出同一墓碑时间戳、`completed_at` 跟随勾选、一次写入一个事务）落在仓储层而非只写在文档里
- `repositories/tags.ts`：标签按名去重创建，`tagsOfTasks` 一次查询取回一组任务的标签名
- `repositories/attachments.ts`：只存文件路径引用，不复制文件
- 测试：`tasks.test.ts` 扩到 27 例、新增 `tags.test.ts`（6 例）与 `attachments.test.ts`（5 例），全部在真 SQLite 临时库上跑；`id.test.ts` 与 `task-query.test.ts` 覆盖纯逻辑，共 107 例

#### S2 IPC

- `shared/contracts/task.ts`：任务域的 zod 契约（创建 / 补丁 / 查询 / 重排 / id 列表），`undefined` = 不动该字段、`null` = 清空该列，使「每次改动即时保存」只带一个字段即可
- 通道与事件：`task:query` / `task:create` / `task:update` / `task:delete` / `task:restore` / `task:reorder` 与 `event:task-changed`；preload 白名单同步暴露 `api.task.*` 与 `api.on.taskChanged`
- `main/services/tasks.ts`：任务域服务层，**不 import electron**，因此每条规则都能在真库上单测；每次写入同时返回「改了什么」的描述
- `main/services/task-events.ts`：`notifyTasksChanged()` 是唯一通知点——推标记角标 / 进度环，并把「已变更」描述广播给**面板窗口**（不发给标记窗口，它不订阅且应当保持空闲）
- `main/ipc/handlers/task.ts`：任务通道以列表形式注册，注册器仍是唯一入口（校验 + 异常兜底 + 值返回错误模型）；`ipc/validate.ts` 抽出共用的 `invalid()`，注册器与新 handler 的拒绝形状与日志保持一致
- 测试：契约边界 20 例（空 / 超长标题、优先级越界、非整数时间戳、空状态集、未知排序、窗口上限）+ 服务层真库 15 例（标签随行返回、软删计数含子任务、恢复、重排回显 scope、两层子任务被拒），共 142 例
- 收窄：附件通道（S7）与 `event:quick-add-focus`（S3）本片未加，避免暴露无人应答的通道；S2 计划里的「建 → 事件 → 角标 +1」冒烟断言移至 S3——面板此刻还没有可输入的真实列表，而冒烟态角标是固定的桩值

#### S3 列表与快速新增

- 面板换成真正的收件箱：M0 的设置演示壳退役，[App.tsx](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/App.tsx) 头部显示标题与「今天还有 # 项待办」，下面是快速新增与可滚动的任务列表
- [store.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/store.ts)：任务分片只存来自查询的结果，**不存派生数据**；`addTask` / `toggleTask` 写完不本地插入，只等 `event:task-changed` 重取（D4 的「一次写入 = 一次重取」）
- 任务行 [task-row.tsx](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/task-row.tsx)：复选圆钮（`role="checkbox"` + `aria-checked`，带「标记为已完成 / 未完成」的无障碍名）、标题、截止 chip、优先级标；chip 的配色走运行时令牌名（模板类名 Tailwind 认不出来），因此用内联 `style` 而不是硬编码色值
- 快速新增 [quick-add.tsx](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/quick-add.tsx)：`Enter` 建任务并**保持焦点**继续输入；空标题不建也不吃掉已输入的空白；写失败把文本退回而不是丢掉
- 截止 chip 的判定抽成纯逻辑 [task-due-label.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/utils/task-due-label.ts)（逾期 / 今天 / 更晚），按「天起点」而不是毫秒差算天数，免掉「39 小时被算成 2 天」；9 例单测覆盖仅日期不判逾期、带时刻按瞬时判定、跨天回落日期、`zh-Hans` 输出
- 唤起路径：新增 `event:quick-add-focus` 通道与 preload 白名单订阅，主进程 `expandPanelForQuickAdd()` 展开面板并把光标交给输入框；全局快捷键注册 `Ctrl/Cmd+Shift+N`（与既有的 `Ctrl/Cmd+Shift+Space` 并存）
- 新增冒烟 `npm run smoke:tasks`（12 项断言）：空库首绘 → 真实全局快捷键开面板 → 光标落到输入框 → 投递标题 + 回车 → `task-changed`（含主进程实算角标 `0 → 1`，不再是桩值）→ 面板重取重绘 → 直读 SQLite 校验落库与默认值（`todo` / 无清单 / 顶级）；再建第二条验证回车后焦点仍在
- 冒烟把标题以 `WM_CHAR` **直投面板窗口**而不是走 `SendInput`：机器上的 TSF 系输入法会把注入字符组合成中文，断言会变成在测那台机器的输入法。代价是不能用「注入点击」把面板抬到前台——注入点击借来的前台会被注入它的控制台抢回，面板据此判定失焦并收起，于是这条路径改为完全不碰光标

#### S4 详情与字段编辑

- 详情视图 [task-detail.tsx](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/task-detail.tsx)：**全屏替换列表**（D6）——面板只有 320–640 DIP 宽，并排放两个可读区域等于两个都不可读。字段齐了：标题、备注、截止（日期 + 「含时刻」开关 + 今天 / 明天 / 清除）、提前提醒分钟、优先级、状态、标签增删、软删按钮，`Esc` 返回
- 即时保存（D9）：没有保存按钮、没有脏状态，也正因如此「失焦收起面板」是安全的——用户离开前改动已经入库。自由文本与两个日期控件在**失焦或回车**时提交，开关类控件按下即提交；若每次重取都回写输入框，正在输入的内容会被打断，因此文本与日期在组件内留一份草稿，只有它和行数据不同才写
- 标题空着不算任务：字段失焦时回落成行里原本的标题，而不是把空标题发出去；标签同名不重复添加
- [task-dates.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/utils/task-dates.ts)：存储的 UTC 毫秒 ↔ 日期 / 时刻控件的本地值互转。今天 / 明天按**本地日期分量**构造（不对毫秒加 24 小时，夏令时那天不是 24 小时）；`2026-02-30` 这类不存在的日子直接拒绝，而不是静默进位成 3 月 2 日，用户不会存下一个自己没输过的日期；16 例单测覆盖闰年 2/29、跨月跨年、时区开关与非法输入
- 新增 `task:get` 单行读取通道（契约 + handler + preload）。详情读的是**单行**而不是收件箱那条分页查询：在详情里把任务标成已完成会掉出 `todo/doing` 过滤，复用列表查询会把正在编辑的屏幕清空
- 面板 store 增加详情分片（`openTaskDetail` / `closeTaskDetail` / `refreshOpenTask` / `saveOpenTask` / `deleteOpenTask`），仍守 D4：写入不本地改镜像，等 `event:task-changed` 后由 `refreshOpenTask` 重取；App 同时订阅列表与详情的重取，因为「在详情里标完成」只有详情自己看得见
- 任务行标题改为进入详情的按钮（无障碍名就是任务本身，不必给每一行读一遍「详情」）
- 冒烟改造：修掉一个真的坏了的机制。此前脚本把按键**直投面板窗口**，这在文字上能用，但**焦点移动不行**——Chromium 只在窗口持有前台时才认 Tab 这类导航，而脚本运行拿不到前台：Tab 不改变焦点，脚本却仍按固定次数按下去，随后的回车落在别的控件上，实测把两条任务标成了完成（于是它们掉出收件箱过滤，重启后读到 0 行）。现在冒烟态开一个调试端口，脚本通过 DevTools 协议附着面板页面：控件按 `data-field` 名**直接设焦点**，按键直接送进渲染进程，不经过 OS 输入队列、不受输入法影响、也不需要前台。全流程只剩一次真实 OS 输入：打开面板的全局快捷键（注册热键只认输入队列产生的事件）。PowerShell 助手随之从「和弦 + 直投文本」缩到只发和弦
- 冒烟扩展到 24 项断言：既有的建任务链路之外，新增「按名聚焦第一行 → 回车进详情（断言光标已在标题）→ 聚焦「明天」回车 → 直读库校验为本地零点且仅有日期 → 聚焦「高优先级」回车 → 直读库校验为 3 → `Esc` 回列表 → 断言列表画出的 chip 已变」，最后**用同一份数据库重启应用**，断言读回来的还是改过的优先级与截止

#### S5 排序与拖拽

- 列表可以改顺序了：抓行尾的抓手拖动，或按 `Alt+↑/↓` 把当前行挪一格。两条路走同一次写入（`task:reorder`），写完之后仍不本地改序——列表等 `event:task-changed` 重取，所以屏上的顺序还是主进程说的那个（D3、D4）
- 拖拽用 pointer 而不是 HTML5 `draggable`：`draggable` 的幽灵图是整行的位图，落在透明无边框窗口上观感差，落点判断照样得自己写，而且它要求行本身可拖动，就会吞掉行内标题按钮与复选圆钮需要的点击。改用 M01 已经量过的 `setPointerCapture`：抓手按下时把每行的 band 量一次（量早了被拖的行还没让位，量晚了它已经被平移走），指针移动时按行中点算出落点，松开才写库
- 拖动中只给被拖的那一行写 `translateY`，落点线是目标行的 `inset shadow`——两者都是合成属性，不为预览新增元素。列表的四个处理器全部 `useCallback`，行组件 `memo` 化，于是一次拖拽里除了被拖的行和画着落点线的那一行，其余行都不重渲染
- 移动后由列表把焦点放回被移动的那一行：React 在顺序变化时会卸载并重挂该行，元素一卸载焦点就没了，不放回去第二次 `Alt+↓` 会落空
- [sort-order.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/utils/sort-order.ts)：位置运算抽成纯函数（`moveWithin` 越界夹取、无变化时**按引用**返回同一个数组；`landingIndex` 按行中点定落点；`dropEdge` 决定落点线画在哪一边），拖拽与 `Alt+↑/↓` 共用，8 组 12 例单测
- `reorderTasks` 现在接受**只点名一部分行**的调用：面板发的是它画出来的那些行，组里没点名的（例如收件箱过滤掉的已完成任务）按原序排到末尾。只写被点名的行会让它们占住中间的位置、两行拿到同一个 `sort_order`，日后同时显示完成与未完成的视图就会画出不确定的顺序；现在组内 `sort_order` 始终是干净的 `0…n-1`。位置没变的行不再写 `updated_at`，部分重排不会把用户没碰过的行标成已修改（M08 靠这个时间戳判冲突）
- 跨清单拖拽**推迟到 M03**：清单在 M02 里还不存在（没有清单视图，`list_id` 也还没有赋值口），现在写这条路径只会是没人能走通、也没人能验证的空壳
- 冒烟扩到 29 项断言，并且第一次让脚本**合成拖拽**：`Alt+↓` → 断言列表重画成新顺序且焦点仍停在被移动的行 → `Alt+↑` 复位 → 用 `Input.dispatchMouseEvent` 的 press/move/release 把第一行的抓手拖到下一行下方 → 断言落库顺序，最后重启断言顺序照旧。合成鼠标事件会被 Chromium 转成 pointer 事件，于是面板自己的 pointer 处理链真的跑一遍，不需要真鼠标也不需要前台；坐标取自页面自己的矩形，脚本不必知道窗口在屏幕上的位置

[Unreleased]: https://github.com/2268027569/DoList/commits/main
