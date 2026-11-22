# 设计验收评审结论（Design Verdict）— 云驭协同 v0.5.1 Web 协同看板

> 评审角色：design reviewer（产品/交互设计视角，非实现）
> 评审模型：GLM-5.3 · 评审日期：2026-11-22
> 评审范围：web/ 全部前端资产（9 视图）、docs/acceptance 实测记录、AGENTS.md 不变量 6、ARCHITECTURE.md Web 层描述、README.md 功能承诺
> 评审方式：静态全量代码走读 + 实机取证（临时启动 `node bin/yunyu.mjs demo --port 4399`，验证后已停止进程，未修改任何源码）

---

## 1. 验收结论

**有条件通过** —— 9 视图信息架构、暗黑主题与实时协同闭环（SSE 实时流、@提及精准唤醒、Issue 六态流转、协作图谱时间轴回放、非破坏性双语译文注解层）设计质量扎实且实机可达；但「一键切换英文」的不变量 6 承诺在多数视图存在大面积硬编码中文失效面，且「销毁成员节点 / 合并 MR」等不可逆操作无二次确认，两条 P0 修复后方符合企业级平台的设计验收门槛。

---

## 2. 证据清单

### 2.1 静态代码证据

| 证据 | 位置 |
| :--- | :--- |
| 9 视图导航注册（board / kanban / knowledge / world / plugins / graph / members / gitlab / contract） | web/index.html:29-64 |
| 顶栏语言切换按钮 + 实时状态胶囊 | web/index.html:22-25；web/app.js:20-21 |
| i18n 双语词典（zh-CN / en-US）与 `t()` 回退链 | web/i18n.js:1-200（回退逻辑 :198-200） |
| 语言切换后的重渲染编排 | web/app.js:397-411 |
| SSE 订阅与全量刷新去抖 | web/app.js:356-394（插件事件 280ms 去抖 :369-379） |
| SSE 输入态保护（刷新不冲掉正在编辑的表单） | web/app.js:225-232、:281-295 |
| 留言板 @提及 chips + Ctrl+Enter 发送 + 频道选择 | web/views/board.js:104-115；web/app.js:869-871 |
| 非破坏性译文注解层（原文/译文一键切换） | web/views/board.js:5-11、:51-59 |
| Issue 六态看板（列切换 / 快速新建 / 筛选 / 排序 / 依赖阻塞徽章 / 验收清单进度） | web/views/kanban.js:62-173 |
| Issue 详情抽屉（Spec / 验收清单 / DAG 依赖 / 在线 Git Diff / 验收-打回流） | web/views/kanban.js:279-389 |
| Git Diff 加载态 | web/views/kanban.js:383-387 |
| 预算熔断可视化（状态徽章 + 进度条 + 上限配置表单） | web/views/contract.js:22-40；web/styles.css:971-987 |
| 协作图谱时间轴回放（步进 / 播放 / 倍速 / 图例 / 发言节点脉冲） | web/index.html:99-131；web/graph.js:25-118 |
| 插件视图全量双语分支 + 加载态 + 空态 + 成功 Toast | web/views/plugins.js:436、全文件 isEn 分支 |
| GitLab 断连态（i18n 已覆盖） | web/views/gitlab.js:13-16 |
| 暗黑主题设计令牌（单一 :root 变量体系） | web/styles.css:1-20 |
| 桌面/移动响应式断点（1120 / 900 / 720px） | web/styles.css:784、:1450、:1459 |
| 语法门禁（本会话实跑 `npm run check`） | 92 JS/MJS 文件全部通过 |

### 2.2 实机动态证据（本会话 2026-11-22 14:06）

- `GET /` → HTTP 200，HTML 17,815 字节，`tab-btn` 计数 = 9（9 视图确认）。
- `GET /api/health` → `{"ok":true,"version":"0.5.1","swarmCount":1,...}`。
- `GET /api/events` → 首帧 `event: connected\ndata:{"ok":true,...}`（SSE 实时通道确认；与 docs/acceptance/README.md:13 第 3 关证据一致）。
- 服务已验证并终止（端口 4399 进程已 kill，复查端口已 STOPPED）。

### 2.3 既有实测记录引用

- UI 可达与 SSE 实时流：docs/acceptance/README.md:12-13（run-record.json 第 2/3 关）。
- Issue 六态流转 + 预算熔断后端行为：docs/acceptance/README.md:15（`budgetStatus:"exceeded"`，但见问题 D4 的 UI 可感知性缺口）。

---

## 3. 问题清单

> 分级定义：P0 = 违反契约承诺或存在不可逆风险，阻断企业级验收；P1 = 核心体验缺口，应在下一迭代修复；P2 = 体验优化项。

### P0

**D1 · 双语切换大面积失效（违反不变量 6「一键切换英文」承诺）**
- 位置：i18n 仅覆盖「壳层」（顶栏、导航、图例、六态列名），以下区域在 en-US 模式下仍为中文：
  - 招募 Agent 模态整卡（web/index.html:186-315）与新建蜂群模态（web/index.html:323-342）——静态 HTML，语言切换重渲染清单（web/app.js:397-411）完全不覆盖模态正文；
  - Issue 抽屉全量文案与动作按钮（web/views/kanban.js:286-389，如「批准 Spec → 待开始」「打回返工」「无前置阻塞」等约 30 处）及筛选器（web/views/kanban.js:70-107）；
  - 知识库分类/空态/占位符（web/views/knowledge.js:7-13、:30-31、:87）；
  - 成员名册 kv 标签与动作按钮（web/views/members.js:94-117，「销毁节点」「重置会话」等）；
  - GitLab 视图徽章与合并按钮（web/views/gitlab.js:23-53、:107）；
  - 契约视图预算/表格/审计文案（web/views/contract.js:26-119）；
  - 世界模型视图全部区块标题、按钮与空态（web/world-wiki.js:268-527）；
  - 留言板译文注解条硬编码「不篡改不可变原帖」（web/views/board.js:54）与空态（web/views/board.js:101）。
- 影响：英文用户切换后约六至七成界面文案不切换；「全中文默认 + 一键英文」的双语承诺仅在插件视图（plugins.js 自成体系的 isEn 三元分支）完整成立。
- 建议：将全部视图文案收敛进 web/i18n.js 词典（同时把 plugins.js 的行内 isEn 三元模式迁移至词典，消除当前两套并存的 i18n 架构）；模态等静态 HTML 改为 JS 渲染或按 `data-i18n` 属性批量注入。

**D2 · 不可逆操作无二次确认**
- 位置：销毁成员节点（web/views/members.js:117 按钮 → web/app.js:827-835 直接 `DELETE ...?force=true`）；GitLab「批准并合并 MR」（web/views/gitlab.js:107 → web/app.js:837-844 直接 merge）。
- 影响：企业级 PM 平台惯例中删除成员/合并代码均为不可逆高危动作，误点即触发，且当前按钮与其他普通操作同级混排、无视觉危险层级区分。
- 建议：引入统一确认对话框组件（含影响面摘要，如「将销毁 @x 及其 worktree 分支」），危险按钮全局使用 `.btn danger` 层级。

### P1

**D3 · `human_required` 事件未订阅，人工升级无站内可感知通道**
- 位置：后端已发事件（src/core/orchestrator.mjs:734、:871），前端 connectSse 监听清单缺失该事件（web/app.js:361-382 仅监听 message/status/translation/task/knowledge/wiki/world_model/audit/plugins_changed/hook_run/swarm_created/agent_log）。
- 影响：数字分身「hybrid/auto_reply 托管策略」的 IM 升级、`waiting_human` 状态只能靠 status 全量刷新间接反映，没有主动告警/红点/Toast；「审批门禁」这一核心差异化体验在 Web 端缺位，也构成通知中心缺口的根因。
- 建议：订阅 human_required 并触发顶栏通知中心/Toast；后续与 D4/D8 合并为统一站内通知中心。

**D4 · 预算熔断告警可感知性弱 + 信息架构错位**
- 位置：预算 UI 埋在「契约与工作树」视图（web/views/contract.js:22-40）；SSE 无 budget 专属事件类型（src/core 各 emit 类型中无 budget）；顶栏无全局预算徽章；toast 无。
- 影响：第 5 关实测已出现 `budgetStatus:"exceeded"`（docs/acceptance/README.md:15），但用户停留在看板/图谱视图时对熔断零感知——预算是蜂群级财务治理，放在所有权契约 Tab 语义错位。
- 建议：预算胶囊提升至顶栏（实时在线胶囊旁），熔断/预警触发全局 Toast 与通知中心条目；考虑独立「治理」分组或并入世界模型视图 KPI 区。

**D5 · UI 偏好零持久化**
- 位置：web/ 全目录无任何 localStorage/sessionStorage 引用（grep 证实）；state.lang 默认 zh-CN（web/lib/state.js:4）。
- 影响：刷新后语言、当前 Tab、筛选器、图谱回放位置全部丢失；对英文用户叠加 D1 后形成「每次刷新回到中文看板」的双重伤害。
- 建议：至少持久化 lang 与 activeTab（localStorage 一键，零依赖不变量不受影响）。

**D6 · SSE 无连接状态与重连反馈**
- 位置：`live-pill` 仅反映蜂群 done/live（web/app.js:54-57）；EventSource 的 onerror/onopen 未处理；断线后浏览器自动重连期间 UI 无任何提示，用户无法区分「无新消息」与「连接已断」。
- 建议：连接状态接入 live-pill 三态（在线/重连中/离线），断线 Toast + 恢复后增量刷新提示。

**D7 · 空态与首启动引导不完备**
- 位置：Pipelines 面板空数据时整块无空态（web/views/gitlab.js:121-133）；看板「无蜂群」与「筛选无结果」共用同一句空态文案且未 i18n（web/views/board.js:101）；swarmCount=0 时（验收第 2 关后曾出现）没有「创建第一个蜂群」的引导性空态，9 视图多数直接白屏等待。
- 建议：区分「无数据空态（含引导动作）」与「筛选空态（含清空按钮）」两种模式；无蜂群时全视图给统一引导。

### P2

**D8 · 无站内通知中心**
- 站内告警完全依赖单条 toast（4.2s 自动消失，web/lib/state.js:74-89）；跨渠道通知依赖外部 IM，Web 端无收件箱。企业 PM 标配（通知中心/红点/已读）缺失。与 D3/D4 合并建设为宜。

**D9 · Issue 看板无拖拽换列**
- 位置：web/views/kanban.js:157-161 仅 ←/→ 单步按钮。
- 影响：对标 Trello/Jira/GitLab Board 的拖拽心智模型缺位；触屏端 ←/→ 微按钮命中率低（390x844 移动验收通过不等于可用性好）。建议 HTML5 drag & drop + 触屏长按拖拽，落到 `PUT /tasks/:id` 同一端点。

**D10 · 企业级 PM 视图能力缺口（对标看板/甘特/燃尽/审批流/通知中心）**
- 现有：六态看板 ✅、审批流（Spec 冻结→验收→打回）✅、图谱回放 ✅；缺：甘特/时间线视图（无排期与依赖可视化，DAG 依赖仅抽屉内徽章）、燃尽图与吞吐统计、跨蜂群组合仪表盘（顶栏下拉仅切换单群、无 portfolio 视角）、成员级 token/成本归因（预算仅蜂群级汇总，web/views/contract.js:31-33）。与 docs/review/04-enterprise-pm-benchmark.md 的对标结论互为印证，设计侧补齐视图层缺口。
- 备注：已有 backlog E 系列（E-01 RBAC 等）覆盖权限底座；甘特/燃尽/组合视图/通知中心建议作为 UX 系列新增，若与既有条目语义重复可合并。

**D11 · 键盘可达性与动效偏好未适配**
- 位置：`role="tab"` 存在但无 aria-selected 与方向键导航（web/index.html:30-63）；输入框 focus 仅 `outline:none` 无替代焦点样式（web/styles.css:272-275、:509-512），键盘用户焦点不可见；卡片高亮/发言脉冲动画未适配 `prefers-reduced-motion`。
- 建议：tablist 键盘导航 + `:focus-visible` 样式 + reduced-motion 媒体查询兜底。

**D12 · 首屏无统一加载态规范**
- 位置：index.html 各视图容器初始为空（web/index.html:74 等），首个 fetch 完成前用户看到空白；仅插件视图（plugins.js:436）与抽屉 Diff（kanban.js:385）有加载态。
- 建议：统一 skeleton/加载条规范，boot 失败时给全屏错误态（当前仅 toast，web/app.js:1010-1013）。

### 正面清单（设计亮点，验收加分项）

1. 「不篡改原帖」的译文注解切换（board.js:51-59）把不变量 2 直接翻译成了可感知交互，是罕见的契约级 UX。
2. SSE 刷新的输入态保护（app.js:225-232）避免了实时刷新冲掉用户正在填写的表单——实时看板的经典痛点被正确处理。
3. 协作图谱时间轴回放（步进/倍速/图例）是差异化资产，超越一般 PM 工具的事件回放能力。
4. 插件视图的加载/空态/Toast/双语完备度可作为其余 8 个视图的内部标杆。
5. 暗黑主题 token 化（styles.css:1-20）与零溢出双端布局（README:46 实测）质量稳定。

---

## 4. 建议待办项（backlog 草案，前缀 UX- 与既有 D/C/S/E/X/F/G/Q/P 系列无冲突）

> 可并入 docs/review/backlog.json；字段与既有条目对齐（id / title / priority / phase / acceptance）。

```json
[
  {
    "id": "UX-01",
    "title": "i18n 词典补齐至 9 视图全量并统一实现模式（含两个模态表单）",
    "priority": "P0",
    "phase": "A",
    "acceptance": "en-US 模式下遍历 9 视图 + 2 模态 DOM 快照，硬编码中文残留字符串为 0；plugins.js 的 isEn 行内分支迁移至 web/i18n.js 词典；qa:ui 双端无回归"
  },
  {
    "id": "UX-02",
    "title": "破坏性操作统一确认对话框（销毁成员 / 合并 MR / 审计建缺陷单）",
    "priority": "P0",
    "phase": "A",
    "acceptance": "销毁成员与合并 MR 必须经确认弹窗（含影响面摘要：worktree 分支名 / MR 标题）才发出请求；Esc/取消路径不发任何 API 调用；回归测试覆盖确认路径与取消路径"
  },
  {
    "id": "UX-03",
    "title": "订阅 human_required 事件 + 站内通知中心（含预算熔断、审计 FAIL、等待人工聚合）",
    "priority": "P1",
    "phase": "B",
    "acceptance": "数字分身触发人工升级时 3 秒内出现站内通知条目与顶栏红点；预算 status 变为 warning/exceeded 时顶栏胶囊变色且通知中心留痕；通知支持已读/清空；不依赖外部 IM 通道"
  },
  {
    "id": "UX-04",
    "title": "预算治理迁出契约视图：顶栏全局预算胶囊 + 预算专属 SSE 事件",
    "priority": "P1",
    "phase": "B",
    "acceptance": "预算胶囊常驻顶栏（ok/warning/exceeded 三态 + 峰值百分比），点击跳转预算治理区块；后端新增 budget 状态变化事件并由前端订阅；契约视图不再承担预算展示职责"
  },
  {
    "id": "UX-05",
    "title": "UI 偏好持久化（语言 / 当前 Tab / 筛选器）",
    "priority": "P1",
    "phase": "A",
    "acceptance": "切换至 en-US + graph 视图后刷新页面，语言与 Tab 保持；localStorage 仅存非敏感 UI 键；npm run audit 依赖拓扑零新增"
  },
  {
    "id": "UX-06",
    "title": "SSE 连接状态三态指示与断线重连反馈",
    "priority": "P1",
    "phase": "B",
    "acceptance": "模拟杀掉 /api/events 后 live-pill 转入「重连中」并在恢复时自动回到在线；断线期间产生的事件在重连后补拉不丢失；无重复渲染闪烁"
  },
  {
    "id": "UX-07",
    "title": "Issue 看板拖拽换列（桌面 HTML5 DnD + 触屏长按）",
    "priority": "P2",
    "phase": "C",
    "acceptance": "拖拽卡片至目标列松手即调用既有 PUT /tasks/:id 端点；触屏 390x844 可完成拖拽；拖拽与 ←/→ 按钮共存不冲突"
  },
  {
    "id": "UX-08",
    "title": "企业级 PM 视图：甘特/时间线 + 燃尽图 + 跨蜂群组合仪表盘",
    "priority": "P2",
    "phase": "C",
    "acceptance": "甘特视图渲染 Issue DAG 依赖与时间区间；燃尽图基于六态流转历史统计；组合视图聚合多蜂群 Issue/预算/健康度；纯零依赖 SVG 实现，qa:ui 双端零溢出"
  },
  {
    "id": "UX-09",
    "title": "空态/加载态/错误态三态统一规范与首启动引导",
    "priority": "P2",
    "phase": "B",
    "acceptance": "9 视图区分「无数据（含引导动作）」与「筛选无果（含清空）」空态；Pipelines 面板补空态；swarmCount=0 时给出创建蜂群引导流；boot 失败呈全屏错误态而非仅 toast"
  },
  {
    "id": "UX-10",
    "title": "键盘可达性：焦点样式 / tablist 方向键导航 / prefers-reduced-motion",
    "priority": "P2",
    "phase": "C",
    "acceptance": "纯键盘完成 9 视图切换、开 Issue 抽屉、发送留言的完整路径；:focus-visible 焦点环可见；系统开启减弱动效时高亮/脉冲动画降级为静态样式"
  }
]
```

---

## 5. 评审签名

- 评审模型：GLM-5.3（设计角色 design reviewer）
- 评审性质：只读静态走读 + 实机取证；未修改 src/、web/、tests/ 任何文件；未执行 git commit/push
- 交叉引用：docs/acceptance/README.md（自动化实测 9 通过 / 2 环境性跳过）、docs/review/backlog.json（既有 45 条，UX- 前缀无冲突）、docs/review/04-enterprise-pm-benchmark.md（企业级对标）
