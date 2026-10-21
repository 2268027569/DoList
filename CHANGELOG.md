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

#### M01 收尾：面板展开方向、跟随拖拽、透明度与固定置顶（2026-10-20）

- **面板朝哪开由标记停靠的那条边决定**[anchoring.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/utils/anchoring.ts)：贴顶向下、贴底向上、贴左向右、贴右向左；只有标记离开所有边时才退回旧的「避开光标所在半屏」规则。原实现只看半屏、不看边，把标记推到屏幕顶部时面板仍竖着开在左边或右边，而不是从标记底下长出来
- 判定只看几何、**不读存储的锚点**（`dockedEdge()` 用与吸附同一个 24px 阈值）：拖拽过程中每一帧都能重新推出方向，不必等松手再修一次。两处 clamp 让位照旧——面板永远落在 `workArea` 内，所以贴着下沿的标记会让面板即使该居中也被推回去（冒烟因此同时接受 `centred` 与 `clamped`）
- **拖动标记时已展开的面板跟着走**：标记每次 `setBounds`（每一帧拖拽与松手吸附）都通知订阅者，面板用新矩形**重新推导**位置而不是按位移平移——标记中途越过一条边时，面板当场翻到另一侧，而不是吊在错的那一边。订阅点是 `windows/marker.ts` 的 `onMarkerMoved()`，回调给的是矩形不是位移，好让每个订阅者自己决定怎么用；面板隐藏时直接不参与
- 跟随只写内存里的窗口位置，**不落盘**：位置本来就每次由标记推导（§9.9），存了反而和标记位置打架
- **面板固定置顶**：`alwaysOnTop: true` 写死在窗口参数里，并**删掉**了 `window:set-always-on-top` 通道、`panelAlwaysOnTop` 设置项与它的 i18n 文案。面板靠标记与快捷键到达，能被别的窗口盖住就不叫「随时可达」；留一个开关等于留一条"它在我看不见的地方"的路径
- **面板透明度**（`panelOpacity`，0.5–1，默认 1）：面板头部一个滑杆，M10 的设置窗口将来读写同一个字段。写在头部的理由是它必须"一边拖一边看见效果"——面板自己淡下去就是预览
- 只降**表面**透明度、不动正文：`panel.css` 用 `color-mix(in srgb, var(--bg-surface) calc(var(--panel-opacity, 1) * 100%), transparent)` 混出卡片底色。改用 `opacity` 会连文字一起淡，对比度就守不住；用 `color-mix` 还顺手做到主题无关——不必为每套主题再抄一份背景色，也不在 JS 里算颜色
- 取值在**首绘前**随 boot 参数到达，窗口不会先不透明画一帧再淡下去；`--panel-opacity` 刻意不进展开动画的过渡属性，否则拖动滑杆时动画会追着跑。写入防抖 200ms：滑杆连续上报，而一次上报=一次 SQLite 写+一次贴边隐藏重算，所以只在停手后落盘——**应用**仍是每帧都做，看得见效果才是这个控件的意义
- 测试：`anchoring.test.ts` 覆盖四个方向各一例、`free` 两边各一例、越过阈值前后侧不同、两处 clamp、多显示器原点偏移，以及 `dockedEdge()` 四个边与阈值的两个方向，共 20 例；单测总数 222 例
- 冒烟：标记套件原来的「与标记相邻」断言换成**方向断言**（`checkPanelSide` 按停靠边核对间隙该出现在哪一侧），并新增「面板跟随拖拽」phase——拖标记、读应用自己上报的 `panel-followed`（停手 150ms 后记一条，否则每帧一次文件写会混进那些用于量帧时间的断言），断言上报的矩形与拖拽终点一致、面板仍在工作区内、且方向仍然成立。运行时实测走的是**贴底**分支：标记被拖到任务栏边缘，面板随即翻到它上方。标记套件 21 项断言，任务套件新增 phase 10（滑杆 → 断言 `--panel-opacity` 与卡片**计算样式**都变了 → 断言落库值），19+4 项共 56 项

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

#### S6 子任务与重复

- 任务可以拆成一层子任务了：详情里多出「子任务」区（清单 + 增删 + `n/m` 汇总），父任务行在列表上带 `n/m` 计数 chip。输入框放在清单**下方**——放在上面时每加一条都会把光标所在的框往下推，连续录入时面板会在用户手底下滚动。汇总由 `subtaskCounts` 一次 `GROUP BY parent_id` 取回，并随每行一起返回（tags 与 subtasks 都在 `listTasks` 里补齐）：两样都是每行都要画的，分成两次读等于每次击键都多付一次往返（D4 的一次写入一次重取）
- [recurrence.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/shared/utils/recurrence.ts)：`rrule` 之上的一层薄封装。规则一律存 RFC 5545 property list（D2），两种模式是两套锚点——`fixed` 锚在原来的到期上（每周一的任务还是每周一，迟到的只**跳过**已错过的实例，不排队补上），`after_completion` 重锚在完成那天但保留任务自己的钟点（早 9 点的任务晚上 8 点完成，下一次仍是早 9 点）；日期型的实例一律落回本地零点，免得夏令时把「某一天」挪成前一天的 23 点。12 例单测覆盖工作日跳周末、每月 31 号跳过 2 月、2/29 每四年、`COUNT`/`UNTIL` 用尽返回「没有下一次」、非法规则不抛异常
- 两个安静出错的坑各加了一道防线：① `RRule` 的构造器是从它拿到的 `dtstart` 推导钟点（`timeset` / `byhour` / `byminute`），先构造再替换 `dtstart` 会留下默认钟点，因此 `build()` **先设 start 再构造**；② `rrule` 不坚持 `FREQ`，`COUNT=5` 单独一个会静默变成年度规则，所以先守着 `FREQ=` 再解析。于是写入口的 `isValidRule` 一拦，就不存在「存进去却永不重复」的任务
- 详情里多出「重复」区：每天 / 工作日 / 每周 / 每月 / 每年五个预设 + 自定义 RRULE 输入框（`FREQ=WEEKLY;INTERVAL=2` 这类），再点一次已选中的预设即关闭重复；有规则时才出现 `fixed` / `after_completion` 两个模式开关。自定义输入被拒绝时**保留原文**——改的是错字，不该让人重打一遍。预设表是纯数据 [repeat-presets.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/repeat-presets.ts)，面板**不** import `rrule`：解析器是主进程的东西，拉进面板与标记的 bundle 正是这层分离要避免的
- **勾选完成即生成下一次实例**（D10）：`updateTaskFromPatch` 在同一个写动作里建出新行，因此一次用户动作的 `change.ids` 会**出现两行**（旧实例 + 新实例），撤销栈与标记重算都按整个效果记。新实例只继承「这件事是什么」——标题、清单、父任务、备注、优先级、标签、预估、提前提醒、规则；不继承子任务（清单是这一次要做的）、实际耗时与完成时间，且由仓储写成 `todo`——它的意义就是还有活要干
- 没有新迁移：`repeat_rule` / `repeat_mode` 在 `0001_init.sql` 建表时就有，M02 只需 `remind_lead_min` 一个新列（S1 已加）。重复**只做「完成即生成下一次」**，不做「提前 N 天展开多条未来实例」——那要有独立实例表，属于 M04 提醒模块的活
- 冒烟扩到 42 项断言，勾选那条重复任务是在**重启之后**做的：录一条子任务（断言 `parentId` 指向父行、光标留在输入框）→ 点「每天」（断言库里存上 `FREQ=DAILY`）→ `Esc` 后从 DOM 读父行的 `0/1` chip → 重启后打开这条任务勾选完成 → 断言一次写入报出两行、顶层从 2 行变 3 行、新行是 `todo` / `FREQ=DAILY` / 到期为后天本地零点 / 无子任务 → `Esc` 后断言列表把新实例画在已完成那行的位置上（列表只在自己上屏时才上报，详情打开时它根本没挂载）。顺手修掉冒烟自己的一个读错：`readTasks()` 原来把父子两组合在一起按 `sort_order` 排序，而它是**组内**序号，加了子任务之后就会读错行；现在默认只取顶层

#### S7 撤销与批量与附件

- 面板可以一次处理多行了：行首多出一个选择框（悬停或键盘聚焦才显形，选中后常亮），勾上两行以上就在列表上方浮出操作条（完成 / 提升到高优先级 / 删除 / 取消选择），命令成功即清空选择、操作条随之消失
- 批量契约（`task:bulk`）是**判别联合**，如实只做三条命令（`complete` / `priority` / `delete`）：一条会覆盖整批同一值的文本命令（改日期 / 加标签 / 移清单）既难以撤销回各自的原值，也不符合"一个操作条只有几个按钮"的形态；`delete` 与单行走**同一条软删级联**路径，不另开新路
- **一次批量命令 = 一次写入 = 一次通知 = 一条撤销条目**：`bulkTasks` 内部循环调用单行的 `applyPatch` 后**统一**压一条撤销条目，所以选择集多大都只让标记重算一次、只让面板重取一次——把整批当成"一个动作"是它该有的语义，也是它的性能所在
- 撤销栈 [undo.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/services/undo.ts) 存的是**"要放回的行"的快照**，不是逆操作：条目是一组 `{ id, before, tags }`——`before` 为 `null` 表示这行是新建的（撤销即软删它），否则按快照整行回写（仓储新增 `restoreTask`，带上它在改动前的标签集）。逆操作要么写成一堆分支、要么会漏掉"勾选生成下一次"里新生成的那一行；快照列表让两种情形各归一条清晰路径。一次用户动作一条条目（批量命令一条、勾选生成下一次的旧+新两行一条），栈上限 30、进程退出即失效；`popUndo` 是**消费式**弹出（不压回），否则连按 `Ctrl+Z` 会撤销自己的撤销、栈永不空
- 仓储的写方法改为带回快照：`softDelete → { affected, tombstoned }`（快照取**删除前**的行，`deleted_at === null`）、`restore → { affected, restored }`（快照是**在回收站时**的行，带墓碑时间戳）、`reorderTasks → { affected, moved }`（只含真正移动的行，被排到末尾的未点名行也算）。这些填的是撤销栈的原料，不是给调用方看的日志
- 面板按 `Ctrl+Z` 撤销，列表与详情都生效；文本输入框内**不拦**（`input` / `textarea` / `contenteditable`），让浏览器保留输入框自身的撤销。空栈时无动作、也没有"删除后可撤销"的提示条——撤销靠快捷键与文档，不做 toast
- 详情里多出「附件」区：添加 / 打开 / 移除。**只存路径引用，不复制文件**——`attachments` 行只记 `path`，展示用的 `name`（basename）与 `size` 由主进程每次 `statSync` 现读，文件被删或改名时这一行仍在、`size` 显示为空。渲染层**永远不发路径**，只能点按钮让主进程弹 `dialog` 选择器；`shell.openPath` 也只在 IPC handler 里——服务层 [attachments.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/services/attachments.ts) 因此不 import electron、可单测
- 测试：撤销栈 13 例（撤销创建 / 撤销带标签的补丁 / 撤销删除连子任务一起带回 / 整批一条 / 勾选生成下一次连新行一起收回 / 撤销排序不动标签 / 空栈返回 `null` / 不自我撤销）+ 附件服务 5 例（真临时文件读取 `name` 与 `size` / 文件消失仍记行且 `size` 为 `null` / 多文件保序 / 移除行不删文件 / 按 id 单读），单测总数 215 例
- 冒烟扩到 48 项断言（phase 7/8）：勾选收件箱当前两行 → 断言操作条 `data-count="2"` → 点「高优先级」→ 断言一次 `updated` 报出两个 id、两行 `priority=3`、操作条消失 → 在行内按一次 `Ctrl+Z` → 断言一次 `undone` 报出两个 id、两行优先级回到命令**前**的值。命令前先读一遍原值，因为撤销要放回的是原值而不是默认值（勾选过的那条任务重复生成的新实例会继承优先级）；`Ctrl+Z` 也证实能被 DevTools 协议送进渲染进程——面板把监听挂在 `window` 上、修饰位由协议给出。顺手修掉冒烟自己的又一个读错：`readTasks()` 不带收件箱过滤，勾完成的任务仍在表里，第一版把已完成那行也当成可选行、去点一个屏幕上不存在的选择框；新增 `inboxRows()` 按 `todo`/`doing` 过滤，与面板的 `INBOX_FILTER` 对齐

#### S8 应用菜单与今日视图

- 应用菜单只有**一处定义**：[app-menu.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/main/platform/app-menu.ts) 既给托盘图标挂上下文菜单，也给标记的右键弹出——两个入口、一份列表。菜单的文案取自主进程的 i18n 实例，动作（展开面板 / 退出）也全在主进程，于是菜单整个住在主进程；标记渲染层只发一次"我被右键了"（`marker:context-menu`），既不拼文案也无从伪造动作
- 菜单刻意只有三项：**新建任务 / 今天 / 退出**。`打开设置` 属 M10、`暂停提醒` 属 M04，此刻点了不会有任何反应——一个点了没反应的菜单项比一个短菜单更糟，等它们有真实落点再进来
- 面板多出「今天」视图，但它**不是第二份列表**，而是同一个查询换过滤条件：`filterFor(view)` 返回 `dueTo: 本地当天末尾`（半开区间，逾期含在内），视图状态只有 `view` 一个字段。因此菜单那项与头部 tab 走的是**同一个字段**，两条路径不可能得到两种状态；切换视图时先清空列表再重取，旧行不会挂在新标题下面
- 菜单的「今天」与面板 tab 落在同一处：主进程新增 `expandPanelForToday()`，展开面板后发 `event:panel-view { view: 'today' }`。这是一条**请求**而不是命令——视图状态属于渲染层，主进程只是替用户点了那个 tab
- 在「今天」里新增的任务按**当天零点**落库（日期型、不含时刻）：否则刚建的这条会立刻掉出今天的过滤，用户会以为没建上
- 冒烟替身：原生菜单无法被脚本点击，于是冒烟态（`YICHEN_SMOKE_MENU_PICK=n`）跳过弹出、直接执行第 n 项，并上报 `app-menu`（labels 列表）与 `app-menu-picked`（下标与文案）。这不降低断言强度——脚本断言的是"这个动作真的让面板走了与标记单击**相同**的展开路径"（又一条 `panel-expanded`），剩下的未被覆盖的只有 Electron 自己的菜单控件
- 标记冒烟扩到 18 项断言（新增右键 phase）：`-RightClick` 开关让 PowerShell 助手用 `mouse_event` 发真实右键 → 断言 `context-menu` 事件、菜单文案非空且不是裸键（测的是菜单而不是那台机器的语言）、选中项下标与文案一致、面板真的展开
- 任务冒烟扩到 52 项断言（新增 phase 9）：点「今天」tab → 断言列表报出 `view === 'today'` 且当前为空 → 快速新增一条 → 直读库断言 `dueAt` 为本地当天零点、`dueHasTime = 0` → 断言今天视图画出这一行 → 切回「收件箱」断言 `view` 与三行都在

### M03 视图与组织（进行中）

- M03 模块级实施计划：[docs/M03-PLAN.md](docs/M03-PLAN.md)（侧栏形态、6 个清单的过滤条件、归档语义、5 个切片与验证方式；D1–D7 的决策连同"为什么不做"一并记录）

#### S1 智能清单侧栏与归档

- 面板的视图从 2 个扩到 6 个：**收件箱 / 今天 / 明天 / 即将到期 / 已完成 / 已取消**，由侧栏承载切换。**头部那两个 tab 退役**——两个控件写同一个 `view` 字段，用户分不清哪个才是"当前"，而且点谁都要再动一次；菜单里的「今天」照旧只发 `event:panel-view`，落到侧栏选中项上
- 侧栏是一条 **48 DIP 的窄图标条**：图标是自绘内联 SVG（项目不引 UI 库，M12 把图标自绘列为素材合规要求），用 `currentColor` 跟随按钮状态，不为"选中色"再引一个令牌；当前项带 `aria-current="page"`，图标本身 `aria-hidden`、accessible name 取自同一句清单名。**不显示计数**——六个清单一轮就是六次查询，而当前这个的数字头部已经说了。头部改为「当前清单名（大字号）+ 计数 + 外观按钮」，`summary.pending` 随之退役（它说的是"今天"，而头部现在说的是**当前视图**）
- 六个视图仍是**同一个查询换过滤条件**，没有第二份数据：`明天` 用闭区间单日（逾期不混进来，那是今天的事），`即将到期` 是明天零点起 7 天（今天有自己的清单，重复它等于同一个列表出现两次）；两个归档是同一条查询换状态
- **已完成归档**：新增排序键 `completed: 't.completed_at DESC, t.sort_order ASC'`。已完成的顺序不该是 `sort_order`（那是拖动排出来的"该做的事"的顺序），而是完成时间倒序；`completed_at` 列建表时就有，所以**无迁移、无新表**。在「已完成」里点勾 = 回到 `todo`——**不记录完成前是什么状态**：那要每行多存一个字段、并在所有写入口维护它，为一个能手动改回去的差别不值。「已取消」里不给勾钮（标回"完成"不是那条路的语义），改状态走详情面板
- 归档视图**不提供快速新增**（在"已完成"里加一条"待办"是荒谬的），其余视图按自己的规则给默认日期，否则刚建的行会立刻掉出当前过滤：收件箱无、今天当天零点、明天与即将到期都是明天零点。`addTask` 在写入口也拦一道（`isArchiveView`），不只把输入框藏起来
- 行样式：`done` 与 `cancelled` 合成一个"这件事不用做了"的分支（划线 + 变灰），此前只有 `done` 有；归档视图去掉拖拽抓手（`sort_order` 是"该做的事"的顺序，归档按完成时间排），已取消视图再去掉勾钮
- 一处实现偏差（已记入 M03-PLAN §6）：归档视图**保留**了行首的选择框——批量命令里的「完成」与「删除」对归档行是有意义的，藏起入口而命令仍可用只会更奇怪
- 视图表 [views.ts](file:///c:/Users/Administrator/Desktop/toDoList/src/renderer/panel/src/views.ts) 是三个读者（侧栏、头部、列表空态）共用的一张表，`Record<PanelView, …>` 保证新视图不给文案就编译不过
- 测试：`task-query.test.ts` 加一例钉住 `completed` 排序键走 `completed_at DESC`；i18n 单测跟着换成新的计数键，共 223 例
- 冒烟：`smoke:tasks` 扩到 **69 项断言**（新增 phase 11），逐视图**断言行集合**而不只断言 `view` 字段——在收件箱勾掉一行 → 「已完成」画出的集合 = 库里 `done` 集合且无输入框 → 点该行勾钮 → 断言库里回到 `todo`、归档少一行 → 经详情把一行标为已取消 → 「已取消」只画 `cancelled` 且无勾钮无输入框 → 「明天」新增一条 → 断言 `dueAt` 是明天本地零点且 `dueHasTime = 0`、并立刻被画出来 → 「即将到期」的集合 = 手算的 `[明天零点, 第 8 天零点)` 窗口 → 切回收件箱断言视图、行数与输入框都回来；`smoke:marker` 21 项不受影响（菜单仍走同一条 `event:panel-view`）

#### 附件复制式存储与详情页视觉重做（2026-10-20）

- **附件从「存引用」改为「存副本」**（更正 M02 S7 的决策）：点「添加文件」后主进程把选中的文件**复制**进 `<userData>/attachments/`，库里 `path` 存副本路径。原设计只存用户文件的路径引用，理由是"不重复用户已有的文件、不把字节交给文件夹同步"——但引用在用户整理文件夹时就会断，而且 M10 的文件夹同步只搬 app 自己的目录，引用根本带不走，「附件跟着任务走」只有副本能兑现。同一份文件在磁盘上有两份，是明确接受的代价（ARCHITECTURE §5.1 已改写）
- 副本名是 `newId()` + 源文件扩展名：同一轮里挑了两个 `spec.pdf` 不会互相覆盖，系统仍按正确类型打开。行里展示的 `name` 存**源文件的 basename**（用户认得出的是自己选的那个文件名），`size` 存**复制时的实测值**而不是每次 `statSync` 现读——行描述的是将要打开的那个副本，而副本由 app 自己产生、不会自己变。顺带纠正 ARCHITECTURE §5.1 里"`name` / `size` 每次 `statSync` 现读"的旧说法
- 复制失败的文件**跳过而不是记录**：指向一个从未写出的路径的行，从生成那一刻就是坏附件；目录按需创建
- **删除附件行连带删除那份副本**，但只删 `attachments/` 目录**直属**下的路径（`dirname(resolve(path)) === resolve(dir)`）：行可能来自旧 profile 的恢复或是手写的，点一下"移除"不该删掉用户自己的文档。源文件始终只读不动
- **缩略图走单独一条通道** `attachment:thumbnail`（id → data URL | null），不与 `attachment:list` 混在一起：预览是两者中唯一的大负载，非图片行根本不需要它。主进程先问平台自己的缩略图器（`nativeImage.createThumbnailFromPath`——Windows shell provider / macOS Quick Look，正好只有这两个平台，因此不引入任何图像解码依赖），平台拒绝时退回自己 `createFromPath` 解码并缩到 128px（不缩的话一个 data URL 会在 IPC 上过好几 MB），两条路都拿不到就回 `null`，面板据此画文件行而不是空卡片。"什么算图片"由 `shared/utils/attachment.ts` 的 `isImageName` 一处判定，主进程与渲染层共用同一个答案
- 渲染层拿到预览后存进 store 的 `thumbnails: Record<id, string>`（缺失即"没有预览"），随附件一起刷新；图片按**缩略图卡片**画（点开交给系统看图器看原图），非图片按**文件行**画（扩展名徽标 + 名称 + 大小），两种都点同一个开文件动作
- **详情页视觉重做**：十一个等权重的 `Field` 块改为一列圆角卡片，每组一个标题（原来的排布让眼睛看不出一个字段在哪结束）；标题升级为读稿尺寸（`text-lg`、无边框，聚焦才有下划线），日期 / 时刻 / 复选框 / 一个"含时刻"开关 + 今天 / 明天 / 清除三个预设排成一行，优先级与状态的选择钮带上色点（顺序靠 words 认不出来，色点和列表里的优先级 chip 是同一套令牌），标签、子任务、附件各自成组
- **不再有可见滚动条**：详情页的滚动容器加 `.detail-scroll`（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），长表单仍然可滚——滚轮、方向键、Tab 照常——但系统那条亮色轨道不再穿过深色卡片。这是原截图里最刺眼的一处：深色主题下 OS 画的滚动条是纯白的
- **原生控件的配色跟随主题**：`panel.css` 加 `color-scheme: light / dark` 跟着 `data-mode` 走，日期 / 时间 / 数字选择器与它们的弹出面板不再是白底黑字。这是令牌够不到的地方——它染的是**面板自己画的**东西，而这些不归面板画（ARCHITECTURE §7）
- 其余滚动条（列表）改为主题化：8px 细条、轨道透明、滑块取自 `--border-strong`，悬停升到 `--text-muted`。只动颜色与宽度，不引入动画，§7 的"只动 transform / opacity"约束不受影响
- 测试：`attachments.test.ts` 重写为 7 例——复制落盘并逐字节一致、源名 / 副本路径 / 副本大小三者的关系、不可复制时跳过而非记录、一轮多文件按挑选顺序、同名文件两次挂载互不覆盖、移除时副本随之消失而源文件仍在、只删目录直属路径；单测总数 225 例
- 冒烟：`smoke:tasks` 扩到 **76 项断言**（新增 phase 4e）。原生选择器无法被脚本点击，因此新增替身 `YICHEN_SMOKE_ATTACH`（用平台路径分隔符分隔的多个路径，主进程启动时读一次）：运行前在冒烟目录里现场生成一个**真 PNG**（自写 chunk + CRC，因为"名字像图片"的文件过不了平台解码器）与一个 txt → 断言两行都画出来**且只有图片拿到预览** → 断言副本落在 profile 的 `attachments/` 下且与源文件逐字节一致、行的名字是源名、大小是副本大小 → 从页面上读卡片自己的 `src` 断言是 PNG data URL → 断言开启控件指向的是副本路径 → 移除图片后断言行与副本同时消失、源文件仍在、剩下的 txt 画成文件行

#### 详情改为面板旁的独立窗口 + 行内编辑按钮与竖条多选（2026-10-20）

- **详情不再是面板里的一页，而是面板旁边的一扇窗**（更正 M02 D6）：原来是「全屏替换式」——点开一行，列表就被表单顶掉，看完一个任务要按 Esc 才回得去。面板只有 320–640 DIP 宽，表单和列表在一扇窗里确实挤不下；但把列表整个换掉之后，用户想对照着改、想看完这个接着改下一个，每次都要来回切。现在两扇窗并排：列表**始终可见、始终可点**，点另一行只是把旁边那扇窗指向另一个任务
- 新增第四个渲染入口 `renderer/detail/`（`panel | marker | reminder | detail`），窗口形态照抄提醒弹窗：无边框、透明、置顶、不进任务栏、`skipTaskbar`；尺寸与面板相同（同一套 `clampPanelSize` / 冒烟固定为 `PANEL_SIZE`），两个窗口读起来像一组。全局只有一个详情窗：再点一行是**换指向**（用新的 `?task=` 重新加载）而不是叠第二扇
- 摆位是纯函数 `placeTaskDetail(panelBounds, size, workArea)`：先用 `placePanel` 算出首选位置，若与面板相交就翻到**另一条轴**的另一侧（首选在面板右侧被挡住就试下方），两边都放不下的窄屏上退回首选并按工作区夹取。窗口先定尺寸与位置再 `show()`，缓入只动 `opacity` / `transform`（220ms，`prefers-reduced-motion` 压到 1ms），与 §7 的纪律一致
- **面板在详情打开期间不收起**：详情要拿焦点（用户点的是「编辑」，光标该落在表单里），而面板的失焦收起会把列表一起带走——这正是并排想避免的事。因此 `windows/panel.ts` 新增 `setPanelHeld(true/false)`：持住期间 `scheduleCollapse` 直接放弃，释放时**重新问一次**面板当前的焦点状态而不是照着上一个人松手的时刻决定。详情关闭时先 `focusPanel()` 把键盘还给列表，再释放保持，所以按 Esc 之后列表在原地、可继续用键盘
- 面板真的离开屏幕（用户点了别处）时 `onPanelHidden` 让详情一起关掉：留着一扇正在编辑、却没有列表可回的窗，比关掉更糟
- **每行都有编辑按钮**：行尾抓手旁加铅笔（hover 浮现，`aria-label` 取 `row.edit`），与点标题是同一扇门——标题适合"读着读着想改"，铅笔适合"我在找改的地方"。归档视图也保留它：改已完成任务的备注、标签或把它放回去，正是归档的用途
- **行首方框改成竖条**：那个 hover 才出现的复选框和完成圆钮长得太像，用户分不清哪个是"选中"哪个是"完成"。多选控件现在是行首一条 3px 竖条（未选中时 hover 出一条淡轨，选中后变成整条 accent 并带对勾），与圆形的完成钮在**形状**上就分得开；动作条、批量命令与撤销条目完全不变
- 冒烟：`attachDetail()` 按入口名（URL 以 `/detail/index.html` 结尾）附着并按 `detail-card` / `detail-title` 等待表单画出；phase 4 断言「列表在详情打开时仍然可操作」与「两个窗口矩形不相交」；phase 4b 断言 Esc 之后列表仍在。`pressKeyToClose` 专用于"按下去就把那扇窗关掉"的 Esc——keyup 已无处投递，等它会把这个运行挂死
- 文档：[ARCHITECTURE.md](docs/ARCHITECTURE.md) §2 / §9.1 / §9.1.2 与目录树同步第四个入口；[FEATURES.md](docs/FEATURES.md) M02 D6 与功能表改写

#### 详情窗口视觉整改（2026-10-20）

- **去掉标题下的荧光绿粗下划线**：详情标题原来是带 accent 底边的输入框，在深色窗里像一条荧光笔，而且它所在的位置正是用户首先看的地方。标题现在按"内容而偶尔可编辑"处理——常态就是文字，指针或光标进来才浮现一层浅底与一圈内描边
- **十一个描边框改成分组 + 标签**：原来每个字段都套一个边框，一列十一框既没有主次也没有留白。现在全窗只有两级结构——**分组标题**（时间 / 归类 / 子任务 / 附件，10px 大字距）与**字段标签**（11px），控件本身只在悬停与聚焦时才有边。输入框统一成"填色块 + 聚焦才出边"（`detail-field`），底色与 chip 相同，于是表单读起来是一列**答案**而不是一列**框**
- **日期与时刻回到同一行**：它们回答的是同一个问题（什么时候），原来会各自占满一整行、勾上"含时刻"再多出第三行。现在日期 `flex-1`、时刻固定 88px，`含时刻`在行末——它开关的就是这一行。顺带修掉一个真实缺陷：`INPUT` 里残留的 `w-full` 与 `w-[88px]` 同时生效（Tailwind 输出顺序决定，不认 class 书写顺序），把日期挤成了一个只剩日历图标的小方块
- **chip 排布收进一行**：重复的 6 个预设与提醒的 5 个档位各占一行，不再各带一个落单的尾巴；只开输入的那一个（自定义）改成虚线边，一眼分得清"选一个"与"展开输入"
- **标题栏**：`×` 从左上移到右上（窗口关闭键的常规位置），左边是窗口身份"任务详情"，右边常驻"改动自动保存"——它把"没有保存按钮"从疑问变成了说明。写盘被拒时同一位置换成红色提示，不新增一行
- **删除任务**留在最后、压到 11px 并隔一条分隔线：这一屏里不该有任何东西比正在编辑的字段更容易误触
- 其余：备注框随内容长高（`field-sizing-content`，上限 192px）；子任务与附件行 hover 才浮出删除；附件图片改成方形预览卡，非图片行用扩展名徽章；`Choice` 变体 `dashed` 仅供"自定义"
- 质量门：typecheck / lint / lint:tokens / i18n:check（103 键）/ 单测 287 / build / `smoke:tasks` 92 项全绿。视觉验收走 CDP 截图（`Page.captureScreenshot` + `Emulation.setDeviceMetricsOverride` 拉高视口），不依赖打包与人工点击

#### 详情窗三处修正：chip 单选辨识、提醒折叠、上下停靠并排（2026-10-21）

- **未选中的 chip 不再铺底色**：上一版把未选中态做成 `--bg-surface-muted` 填色块，六个重复预设同时带着色块，用户读成"六个都选上了"（"自定义 / 每天 / 每月点击后没有切换显示而是多选"）。现在未选中是透明底、无可见边框，悬停只把文字提亮、**不铺底**——否则鼠标停在另一项上时，那一项和已选中的一项各有一块底色，又成了"两个都选中"。选中项是整行里**唯一**带 accent 边与底的 pill。`dashed` 变体仍只留给"自定义"这类打开输入的项，且展开时只变亮不变 accent（`open` 与 `active` 分开，打开输入不被画成"已选中"）
- **点另一个 chip 时选中标记不移动（真因）**：`services/task-events.ts` 的 `notifyTasksChanged` 原来只把 `event:task-changed` 发给面板窗口，详情窗虽然订阅了同一个事件却永远收不到——它是独立渲染入口、自己存了一份行，于是表单一直停在打开那一刻的值：写入成功、列表也更新了，详情里绿色描边仍留在原来的优先级 / 状态 / 重复档位上（用户说的"样式切换"就是这件事）。现在同时发给详情窗（新增 `windows/detail.ts` 的 `getDetailWindow`），详情按它重读那一行。标记窗口仍不订阅、不发
- **提醒设置默认收起**：`remindLeadMin === null` 时只画一个「开启提醒」按钮，点开才出现五个档位与自定义分钟输入，另加一个「关闭提醒」chip 写回 `null` 并收起。`remindOpen` 是本地状态：**打开本身不写库**——替用户默认一个提前量会凭空武装一条他没要求的提醒；选中档位才是那一次写。新增 i18n 键 `detail.remindEnable` / `detail.remindOff`
- **上下停靠时详情改为并排**：面板贴顶向下、贴底向上，详情再沿同一根垂直轴排下去，面板一高就落到屏幕另一头，两扇窗只剩对角关系（用户截图里的错位）。`placeTaskDetail` 现在对 `top` / `bottom` 停靠走 `placeBeside`：在面板左 / 右挑空间更大的一侧，`y` 与面板共享上沿（top）或下沿（bottom）；两侧都放不下才回退到原来的首选 + 翻面
- 测试与冒烟：`anchoring.test.ts` 新增"顶部停靠共享上沿 / 底部停靠共享下沿 / 竖排面板选空间大的一侧"3 例（共 41 例，单测总数 290）；`smoke:tasks` 新增一条**看界面本身**的断言——写完优先级后读 `detail-priority-high` 的 `aria-pressed`，确认选中标记确实移到了它身上（此前只断言了数据库与列表，正是这个缺口让上述缺陷活了下来），并保留 phase 12 先按「开启提醒」的步骤；共 93/93 通过；`smoke:marker` 21/21 通过

#### 重复与提醒都改为"开关 + 展开"（2026-10-21 晚）

- **一次性任务不再被画成六个未选中的重复预设**：重复区与提前提醒区一样，标签行右侧放一个 `Switch`（`role="switch"` + `aria-checked`）；关着时下面什么都不画，打开后才出现预设、自定义规则 / 分钟与「按原计划 / 完成后计时」。**打开本身不写库**——替用户默认一条重复规则会凭空生成后续实例，默认一个提前量会凭空武装提醒；选中某个值才是那一次写。关掉开关（或再点一次当前预设、清空自定义规则）写回 `null` 并收起。`repeatOn` / `remindOpen` 与行里的值同源初始化
- 上一轮为提醒做的「开启提醒 / 关闭提醒」两个按钮被开关取代，对应的 `detail.remindEnable` / `detail.remindOff` 键一并删除（语言包 103 键保持一致）
- `Field` 增加 `action` 槽位承载标签行右侧的开关；`Choice` 的注释同步为"未选中无底无框、悬停只提亮"（此前文档还写着填色块）
- 冒烟：phase 4d 先断言一次性任务**没有**重复预设，按 `detail-repeat-toggle` 后再等 `detail-repeat-daily` 出现；phase 12 改用 `detail-remind-toggle`；共 94/94 通过；单测 290 例、`smoke:marker` 21/21 通过

#### 详情窗打开 / 换指向的性能（2026-10-21 晚）

- **"点任务半天才弹出来"的主因是整页重载**：再点一行时 `showDetailWindow` 原用 `loadRenderer(..., { task })` 让同一扇窗带着新的 `?task=` **重新加载**——换一行数据要把 i18n 引导、React 挂载、整份样式表和一整套模块图重做一遍（dev 下还走 Vite 的按需编译），点击之间露出一张空白卡片。现在改为向已加载的窗口发 `event:detail-open { taskId }`，渲染层只把 `shownTaskId` 换掉并重读一行。只有首个页面**还在加载**（`webContents.isLoading()`）时才退回重载，因为那时监听器还没注册、事件会被丢掉
- **首开仍要建窗 + 加载页面**，实测 dev 下 `ready-to-show` 约 330–440ms（日志新增 `detail window ready { ms }`，可直接对着看）。开窗后的三次读改成"先画行、其余并发"：`task.get` 一到就 `set({ task })` 画表单，检查清单与附件在折叠线以下、彼此独立，改 `Promise.all` 并发；缩略图先给出附件行、预览到了再补一次 `set`，不再让整份附件列表等缩略图
- **换指向的竞态**：`open` / `refreshSubtasks` / `refreshAttachments` 在 await 之后比对 `get().taskId === id` 才落状态，快速连点两行时旧读取不会覆盖新任务
- 质量门：typecheck、lint、i18n 103 键、单测 290 例、build、`smoke:tasks` 94/94、`smoke:marker` 21/21

#### 详情窗预热：第一次点击也不再等页面加载（2026-10-21 深夜）

- **换指向已经很快，首开还是慢**：上一节把"再点一行"变成 IPC 换指向，但**第一次**打开仍是点击那一刻才建窗并加载页面——实测 dev 下 734ms（`detail window ready { ms }`）。页面加载（渲染进程、i18n 引导、React 挂载、样式表，dev 下还有 Vite 模块图）与"打开哪个任务"无关，所以把它从点击里挪走：`windows/detail.ts` 在空闲时**预先建一扇 `show:false` 的详情窗并加载详情页**，第一次点击只接管它、发 `event:detail-open`、`show()` + `focus()`
- 预热时机有两个：**启动后 1.2 秒**（`STARTUP_WARM_DELAY_MS`，避开标记 / 托盘 / 快捷键同时到达的那一刻，那是唯一能让首次点击命中的时机）与**面板每次显示后 260ms**（`WARM_DELAY_MS`，等展开动画跑完再看列表的空档；面板是详情的地基，显示即"用户正在挑行"）
- 面板收起时 `discardWarm()` 销毁预热窗——没有列表可倚靠的详情窗只占内存；此后再展开会重新预热。已有一扇打开的详情时不再预热（页面已经加载过）。冒烟模式跳过预热：预热会让两扇窗共享详情 URL，冒烟按 URL 认窗就不再唯一
- 窗口的生命周期环比出 `attachLifecycle()`：预热窗在接管前不持有任务，没有行要忘、也没有面板的"持住"要释放，`closed` 的清理只在被接管后挂上（`takeWarm()` 与 `createWindow()` 各调一次）
- 未就绪的预热窗照样能用：面板刚显示、预热刚建的那几毫秒里点击，会等这一扇的 `ready-to-show`（与冷开同一段等待，只是窗口早建了几毫秒）；日志的 `warm` 字段如实记录这次是否命中了预热
- 质量门：typecheck、lint、i18n 103 键、单测 290 例、build、`smoke:tasks` 94/94、`smoke:marker` 21/21（首跑因桌面占用失败，重跑通过，见既有记录）

#### 主题切换终于有了入口：面板右上角的 ◐（2026-10-21）

- **问题**：主题的数据链路其实早就通了——`themeMode`（浅色 / 深色 / 跟随系统）与 `themeId`（极简白 / 石墨黑）在设置行里、写入会广播 `theme:changed`、两套令牌四张表都在 `tokens.css` 里——但**没有任何界面读这两个字段**：◐ 弹层里只有一根不透明度滑杆，设置中心 M10 还没做。于是用户只能被 `themeMode: system` 牵着走，找不到切换入口
- ◐ 弹层现在三组：**外观模式**（浅色 / 深色 / 跟随系统）、**主题**（极简白 / 石墨黑）、**不透明度**。选中的 pill 是整行唯一带 accent 边与底的（与详情页 Choice 同一条规则），未选中透明底、无可见边框
- 外观模式读的是设置行里的**偏好**（含 `system`），不是已经解析过的 `boot.mode`：跟随系统时 `boot.mode` 永远是 light 或 dark，只有设置行还记得"我当初选的是跟随系统"
- 换主题时**预热中的详情窗**也要重画：它比点击更早加载页面，此前不订阅 `theme:changed`，会带着预热那一刻的令牌出现在另一套配色里。`renderer/detail/src/main.tsx` 补上 `applyBootParams`
- 冒烟 phase 10 新增 4 项：切到深色后根属性与**面板实际背景色**都变（只改 `data-mode` 不改调色板会被抓出来）、切主题换令牌集、最后回到开跑时的外观；共 98/98；单测 290 例、`smoke:marker` 21/21
- 质量门：typecheck、lint、i18n 103 键、build 全部通过

### 修复

- **提醒在建行那一刻就被丢掉**（M04 P0）：一条截止 18:50、提前 5 分钟的提醒若在 18:47 被设好，它要开口的那一刻（18:45）已经过去，而原规则「只武装未来时刻」把它直接丢弃——`reminders` 里一行都没有，于是这条提醒永远不会到，任务行看起来却完全正常。现在改为读同一条 6 小时宽容规则：已经路过、但不超过 6 小时的那一刻**照常落库**，落在它自己的过去时刻上，调度器给 delay 为 0 的定时器，下一刻就开口；超过 6 小时的仍不武装（那属于「错过」，不是「刚刚」）。规则写在 `shared/utils/reminder.ts` 的 `armableFireAt`，被服务层与调度器读同一份。
- 同一处补上一道**启动重建**：实例是派生数据而只有写动作会重算它，所以「写完任务、还没写实例」之间进程若死掉，会留下一个永远不响的提醒。启动时 `reconcileReminders` 问出「当前时刻还没有任何实例替它站着的开放任务」并逐个重算，已有实例的行不会被碰——等待中的归调度器，已说过的不再说。

### M04 提醒与通知（P0 切片，2026-10-20）

- 提醒此前**一行代码都没有**：详情页的「提前提醒」只写 `tasks.remind_lead_min`，`reminders` 表建了却从没有写过，`src/` 里也没有任何 `new Notification`。P0 切片把它接通，交付形态是**「两者都要」**
- `reminders` 表终于有了消费者：它存的是**生成的实例**，不是用户的意图——意图是任务行上的 `remind_lead_min`，实例是 `fire_at = due_at - lead`（`shared/utils/reminder.ts` 的 `fireAtFor`）。两边任一为空就没有实例：提醒是**相对截止时间**定义的，没有截止就没有可回数的时刻，**不补一个默认时间**
- 写入即重算：`services/tasks.ts` 的 `syncReminder` 每次写任务时替换该任务的**等待**实例（只碰 `pending` 行，已触发过的是"说过什么"的流水，不得改写）；已完成 / 已取消 / 在回收站的任务没有等待实例；`deleteTasks` 在同一次写入里清掉被墓碑的那批任务（含级联子任务）的等待实例；撤销一个新建走同一条路径。重复任务每展开一次就生成独立实例，因此新 occurrence 自带自己的提醒
- **刚落库的实例必须仍在未来**：`fire_at <= now` 不落库。提醒的意义是在截止**之前**开口，武装一个刚路过的时刻等于设完就立刻宣布逾期
- `services/scheduler.ts` 按文档形态落地：**单一时间源、非轮询**——读出最近的 `fire_at`，排**一个** `setTimeout`，触发后重排。一个三天后才响的提醒让应用可以真的闲着，这正是标记窗口能是 23 kB DOM 页的前提。`setTimeout` 的毫秒数是 32 位有符号，超过约 24.8 天会溢出成立即触发，所以单次等待被切成 `MAX_TIMER_MS` 的片段
- **它不 import electron**：交付意味着一条系统通知和一张内置卡片，但调度器只知道**实例**与它对应的任务，`deliver` 是启动时注入的回调。时钟（`now`）与定时器（`arm`）也都能注入，所以时序规则可以对着一份真库、一只手工拨动的时钟单测，**断言算术与事件顺序，而不是机器跑了多久**
- **数据库就是记忆**：已交付的实例移到 `fired` 并留在那里（在 OS 被要求画任何东西**之前**就写下去），重启不会重播。开机时把 `fire_at < now - 6h` 的 `pending` 行置为 `dismissed` 而不是补发：晚几小时说还有意义，晚几天说没有——任务本身已显示逾期，一串关于上周的通知只会训练用户忽略全部提醒
- 再排一次的时机是 `services/task-events.ts` 的 `notifyTasksChanged`——每一次写入的唯一必经点。调度器因此不必被任务服务知道，而一次写入既能武装也能取消，`MIN(fire_at)` 一处覆盖两种
- **两段式交付与去重**（`platform/notifications.ts`）：① 系统原生通知（Windows toast / macOS 通知中心），点击即应答并把面板打开到那个任务；② 数分钟后仍无人应答，再浮出**应用内置置顶卡片**（`renderer/panel/src/reminder-card.tsx`，带「完成 / 知道了」，前者就是列表勾选那一次写入）。**两者绝不同时说话**——一个提醒是一个实例一行数据，那行就是全部协调：点击 toast 把实例置为 `dismissed`，卡片定时器开卡前重读该行、发现它不是 `fired` 就什么都不做；反向亦同，应答卡片时顺带关掉仍在的 toast（Windows 上横幅不点会一直留着，留着就是对一件刚处理过的事做第二次播报）。`Notification.isSupported()` 为假的平台上卡片仍按同一只定时器到达，而不是被跳过；交付时任务行已不在（在别处被删）则实例直接置为 `dismissed`——没有名字可叫的播报比沉默更糟
- **卡片不抢焦点**：`expandPanelForReminder` 与点击展开走同一条摆放路径（锚点矩形，`ARCHITECTURE §9.4`），但省掉 `focus()` / `moveTop()`。卡片正是用来兜底一个没人应答的通知，把光标从用户正在打字的地方夺走就是两段式想避免的那种打扰；不抢焦点也意味着正常的失焦收起定时器不会启动——没拿走什么，就不必还回去
- **提前提醒档位**：5 / 10 / 30 分钟、1 小时、1 天（`REMIND_LEAD_PRESETS`）画成 chip，按 `leadBucketOf` 说"分钟 / 小时 / 天"，不会把 1440 端给用户看；原来的数字输入框保留在 chip 下方并补了单位，`data-field="detail-remind"` 未改动。点已选中的 chip 即清除，与重复规则的档位同一手势
- IPC（`ARCHITECTURE §6.4`）：提醒域只有 **`reminder:dismiss` 一个渲染层→主进程通道**（schema `reminderDismissInput`），其余全是主进程→面板的事件——`event:reminder-due`（卡片到期，载荷 `ReminderDuePayload`：instance id / taskId / title / dueAt）与 `event:task-focus`（toast 被点击要打开的任务）。渲染层既不查询也不排期提醒：主进程说什么时候到，渲染层只负责画出来，以及回答"用户看过了"——这是主进程无法自己观测的**唯一**一件事
- i18n：新增 `detail.remindMinutes / remindHours / remindDays / remindUnit`、`reminder.title / due / done / dismiss`（`tasks`）与 `notify.reminderTitle`（`common`），`en` 与 `zh-Hans` 同步；不是做成"每个档位一句文案"，而是每个**量级**一句、数字由 `{n}` 填
- 测试：单测 225 → **265 例**。新增 `shared/utils/reminder.test.ts`（`fireAtFor` 从截止往回数、两侧任一为空即为 `null`、提前量为 0 落在截止当刻；档位升序；`leadBucketOf` 的分桶）、`repositories/reminders.test.ts`（只有未来才武装、替换而非堆叠、`null` 清除、已触发的不被改写、`MIN(fire_at)` 跨任务取最早、`dueBy` 的边界含当刻与排序、批量清除、状态流转、`dismissPendingBefore` 的 cutoff）、`services/scheduler.test.ts`（**手工时钟 + 手工定时器**：三个提醒只排一个定时器且指向最早的、无提前量不排、到点交付并自动重排到下一个、每个实例只交付一次、一次交付全部到点且按时间序、写入移动时刻后重排到新时刻、清掉最后一个提醒后不再排、停机后不再交付、逾期超 6 小时不交付且被标 `dismissed`、删除后到点不交付）
- 冒烟：`smoke:tasks` 76 → **86 项**（新增 phase 12）。提醒是**在截止之前**武装的，所以脚本没法坐着等那一刻到来——新增替身 `YICHEN_SMOKE_REMIND_OFFSET_MS` 把调度器的时钟推快三天（时序算术不变，delay 仍是 `fire_at - now`，只是它已经为 0），同时把兜底卡片的定时器在冒烟下缩到 1.5 秒。phase 12 断言行集合与状态：无截止的任务**不武装** → 用日期控件把截止改到后天（`setDateField` 走 input 自身的 prototype setter，否则 React 看不见变化）→ 有截止无提前量仍**不武装** → 点 30 分钟 chip 武装**恰好一个**实例且 `fire_at` 等于后天零点减 30 分钟 → 断言实例落成 `fired` → 断言卡片**真的画在 DOM 上**（读 `[data-field="reminder-card"]` 的 `data-task-id` / `data-reminder-id`）且卡片上有任务名 → 按「知道了」后断言行成 `dismissed`、卡片从 DOM 消失 → 整轮状态文件里该实例只被播报过一次、只被应答过一次（去重是**量出来的**，不是假定的）
- 文档同步：[ARCHITECTURE.md](docs/ARCHITECTURE.md) §5.3 从"为什么需要这张表"扩成实际落地的纪律，并新增 §5.3.1（调度器形态与可单测性）、§5.3.2（两段式交付与去重）、§6.4 补提醒通道；[FEATURES.md](docs/FEATURES.md) M04 补进度与「内置兜底卡片」一行

#### M04 兜底载体改为独立弹窗 + 缓入与完成特效（2026-10-20）

- 上一节把第二段交付做成了**面板里内嵌的一张卡片**（`expandPanelForReminder` 把面板展开、顶上浮出卡片）。这版把它换成**一个独立的置顶弹窗窗口**——因为那条播报存在的理由恰恰是"用户正在做别的事"，为播报而展开面板，等于把这条提醒本要避免的打扰做到了自己身上
- 新增**第三个渲染入口** `renderer/reminder/`（`index.html` + `main.tsx` + `reminder-popup.tsx` + `particles.ts` + `reminder.css`），`electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 相应加一项；`load-renderer.ts` 的 `RendererEntry` 扩成 `'panel' | 'marker' | 'reminder'`，并新增可选附加查询串参数——弹窗把载荷（`?reminder=<json>`）随窗口一起带上，**首帧就是正确的那条提醒**，不必先画空卡片等 IPC 回话。编解码（`encodeReminderPopupPayload` / `parseReminderPopupPayload`，zod 校验）放在 `shared/contracts/reminder.ts`，主进程与渲染层共用同一份解析
- 新增 `windows/reminder.ts`：`configureReminderWindows(boot)`（启动时缓存 boot 并订阅标记移动）、`showReminderWindow(payload)`、`closeReminderWindow(id)`、`closeAllReminderWindows()`。窗口 `transparent + frameless + alwaysOnTop + skipTaskbar + hasShadow:false + resizable:false`，尺寸固定 **340×124**（`REMINDER_POPUP_SIZE`）；**每个实例一个窗口**，多个同时到点竖直堆叠；订阅 `onMarkerMoved`，标记拖动时每个弹窗用新矩形**重新推导**位置（与面板同一条路径，不按位移平移）
- 摆放是纯函数 **`placeReminderPopup(markerBounds, workArea, index, size)`**（`shared/utils/anchoring.ts`）：`index 0` 就等于 `placePanel` 的结果（同一套停靠边规则、同一个 8px 间隙），之后每个再按停靠边决定的方向递进 `height + gap`——贴底向上、其余向下——末尾一律 `snapToWorkArea(..., 0)` 夹回工作区，所以**堆不下时贴着边堆**而不是堆到屏幕外。刻意不用「把假标记往下挪」的取巧法：挪多了 `dockedEdge` 会从 `top` 变成 `free` 而换掉展开方向
- **弹窗不抢焦点**：用 `showInactive()`（而不是 `show()` / `focus()`）。它正是用来兜底一个没人应答的通知，把光标从用户正在打字的地方夺走就违背了初衷。窗口**尺寸与位置先定好再显示**，缓入动画只在渲染层动 `opacity` 与 `transform`（`reminder.css`：进入 300ms / 退出 180ms，`translateY(-8px) scale(0.97)` → 原位），因此没有一帧碰到窗口尺寸——与面板同一条 §7 / §9.1 的纪律；`prefers-reduced-motion` 下过渡压到 1ms
- **「完成」带一次彩色粒子爆发**（`renderer/reminder/src/particles.ts`，Canvas2D）：约 1.2 秒，110 颗粒子、重力下落、随进度淡出，颜色取自 `tokens.css` 新增的 `--burst-1..6` 令牌（渲染层不写死颜色，令牌检查照常通过）；**特效演完才发应答**，写入不与动画抢时间。`prefers-reduced-motion` 下整段跳过，但**应答照发**——特效是装饰，不是流程里的一步。冒烟里这条路径会额外上报 `reminder-popup-burst`，让"爆发真的跑了"可被断言而不必看图
- 去重仍写在数据行上，只是协调点从"卡片定时器重读该行"换成"重读内存条目"：`answerReminder(id, by)` 现在**无条件**调用 `closeReminderWindow(id)`（就算实例早已应答也一样——那还是同一个实例，为一件已处理的事留一扇窗就是过时的播报），`by` 的取值从 `'card' | 'toast'` 改成 `'popup' | 'toast'`；`closeAllReminderSurfaces()` 退出时连带 `closeAllReminderWindows()`
- IPC：新增 `reminder:done`（`IPC.reminder.done`，schema `reminderDoneInput` = `{ id, taskId }`）。它是**一次用户动作的一条命令**——handler `ipc/handlers/reminder.ts` 在同一次调用里 `updateTaskFromPatch(taskId, { status: 'done' })` 并 `notifyTasksChanged(change)`，再 `answerReminder(id, 'popup')`，和面板自己的勾选走同一条服务层路径；拆成两个通道会让渲染层有机会只做成一件。`preload` 相应加 `api.reminder.done(id, taskId)`，并删掉 `api.on.reminderDue`（面板不再需要它），只留 `api.on.taskFocus`
- 面板层退役：删 `renderer/panel/src/reminder-card.tsx`；`App.tsx` 去掉卡片渲染与 `reminderDue` 订阅；`store.ts` 去掉 `dueReminder` / `showReminder` / `answerReminder` 与 `ReminderDuePayload` 的 import；`windows/panel.ts` 删掉 `expandPanelForReminder`；`shared/contracts/channels.ts` 删掉 `event:reminder-due`。toast 被点击的行为**不变**（应答 + `expandPanelForTask`）——它要的正是面板
- 测试：单测 276 → **282 例**，`anchoring.test.ts` 新增 `placeReminderPopup` 六例（首个等于面板位置、贴顶向下堆、贴底向上堆、侧边同列向下堆、堆到越界时贴边、多显示器非零原点）；`theme:check` 与 `i18n:check` 全绿（复用已有 key，无新增文案）
- 冒烟：`smoke:tasks` 86 → **89 项**，phase 12 后半段重写。附着方式从"只挑面板 target"改成**按入口名**（`/panel/index.html` / `/reminder/index.html`）——弹窗是第二个 CDP target，读它必须开自己的 socket（`attachEntry` / `waitForReminderPopup`，后者额外等 `[data-field="reminder-card"]` 真画出来，因为窗口出现和卡片画出不是同一个时刻）。新增断言：弹窗画在自己的窗口里且 `data-reminder-id` 与事件一致 → **期间没有任何 `panel-expanded`**（"不展开面板"是量出来的）→ 计算样式只动 `opacity` / `transform` 且有正时长 → 文案把 `{time}` 换成了真日期（ICU 注册漏了会在这里现形）→ 「知道了」应答、任务仍非 `done`、窗口消失 → 换一档提前量重新武装后按「完成」：任务变 `done`、`reminder-popup-burst` 与应答同属一个实例、窗口消失 → 两个实例各自"播报一次、应答一次" → 最后两行都非 `pending`。冒烟与 dev 的 Electron 残留仍是假失败的头号原因，跑前先确认没有残留进程
- 文档同步：[ARCHITECTURE.md](docs/ARCHITECTURE.md) §2 三个渲染入口与产物清单、§5.3.2 交付面改写、§6.4 两条通道、§9.1 窗口参数表新增"提醒弹窗"一列；[FEATURES.md](docs/FEATURES.md) M04 表中「内置兜底卡片」改为「独立提醒弹窗」并更新进度段与质量门数字

### M07 系统毛玻璃（2026-10-21）

- 面板、详情、提醒弹窗三个窗口改用**系统级磨砂**：Windows 用 `backgroundMaterial: 'acrylic'`（Win11 22H2 / build 22621 起），macOS 用 `vibrancy: 'under-window'` + `visualEffectState: 'active'`。这不是 CSS `backdrop-filter`——窗口本身是透明的，页面后面没有可模糊的东西，只有让系统在窗口**底下**画材质才成立
- 有材质的窗口**不能是 `transparent: true`**：分层窗口带不了 DWM 材质，硬要只会得到一块黑矩形。所以玻璃路径是 `transparent: false` + `backgroundColor: '#00000000'` + `roundedCorners: true`（圆角由窗口给），`hasShadow` 也从 `false` 改为 `true`——材质窗口是普通形状窗口，DWM 可以像别的窗口那样给它投影，而原来的 8px CSS 外边距与 `--panel-shadow` 正是替代品
- 支持能力与窗口参数都收在 `main/platform/window-material.ts`（`windowGlassSupported` / `windowMaterialOptions`），三个窗口共用一份，低版本 Windows 与 Linux 自动退回原来的透明窗口，行为不变
- 渲染层按 `data-material="glass|flat"` 分流（boot 参数 `glass=1` → `applyBootParams` 写根属性，主进程按 OS 构建号决定，不设开关）：玻璃时 `.window-frame` 的 8px 内边距归零（卡片填满窗口，也让系统的圆角生效），卡片的底色从"满不透明度"降到 **50% × 面板不透明度**，让材质透出来；卡片自身圆角在玻璃下归零——14px 的卡片曲线套在约 10px 的窗口曲线里，每个角都会留下一块没被盖住的材质楔形。不透明度滑杆仍然有效，只是它的上限变成"半透"，不再能调到全不透明
- **`applyNativeTheme`**：材质的明暗由系统暗色标志决定，Electron 从 `nativeTheme` 取。启动前与 `themeMode` 每次变化时把 `nativeTheme.themeSource` 设成应用的外观模式（`system` 原样传下去），否则在浅色桌面上选深色主题会得到"深色卡片压在浅色玻璃上"的一片灰
- 单测 290 → **292 例**（`boot.test.ts` 补 `glass` 参数的解析与 `bootQuery` 往返）；`lint` / `typecheck` / `i18n:check` / `build` / `smoke:tasks` / `smoke:marker` 全绿
- 已知取舍：系统材质在窗口的最终矩形上绘制，**没有可动画的尺寸**，所以展开 / 收起的 200/180ms 动画仍然只动卡片（内容与 50% 填充），材质那一层是直接就位的；换成逐帧 `setBounds` 会违反 §9.5 的低功耗纪律

### M03 当天完成留在列表 + 行号 + 面板比分牌时钟（2026-10-21）

- 面板头部改为三列网格（`minmax(0,1fr) auto minmax(0,1fr)`），**时钟居中在顶部**（`data-field="panel-clock"`），左右分别是视图名与「计数 + 设置」。时钟做成**比分牌卡片**：顶部 accent 细条、两格数字井、accent 冒号、竖分隔与秒列、字母间距的日期行；数字由 `Intl.DateTimeFormat` 的 parts 组成（24 小时制没有 AM/PM 就不占那一格），秒按秒边界对齐、直接写 DOM，只有跨分钟才触发一次 React 渲染。`<time>` 带 `dateTime` 与完整日期 `title`
- 冒烟改为测量时钟卡片相对面板的几何：`offsetX` 在 ±1px 内、`offsetY` 落在 0–40px，文本一并断言（时 / 分 / 秒 / 日期行）
- 每行开头新增**位置序号**（`data-field="row-index"`，`aria-hidden`）：六个视图每行都有，随视图 / 排序 / 拖动变化；它是位置而不是数据，不落库
- 四个开放视图（收件箱 / 今天 / 明天 / 即将到期）**保留当天已完成的任务**：标题划线、排在未完成行之后（新排序键 `sort: 'active'`：`done` 置底、按 `completed_at` 倒序）；隔天完成的才只留在「已完成」。查询新增 `completedFrom` / `completedTo`，条件是 `(t.status <> 'done' OR t.completed_at >= ?)`——开放行没有 `completed_at`，裸比较会把整张清单清空
- 已完成的行在开放视图里**不可拖动、不可多选**（顺序与批量命令只关于还要做的事），完成圆钮保留以便撤销误勾；`moveTask` 只在开放行之间计算位置
- 冒烟 `smoke:tasks` **98 → 100 项**：`tasks-rendered` 证据新增每行 `status`，phase 5 改为断言"新实例插在未完成区、被勾掉的那行沉底且 status 为 done"，并新增 DOM 断言（行号 `1,2,3`、头部时钟的数字与日期、以及时钟相对面板的居中几何）
- 单测 292 → **294 例**（`task-query.test.ts` 补 `active` 排序与 `completedFrom/To` 的 `<> 'done'` 条件）

[Unreleased]: https://github.com/2268027569/DoList/commits/main
