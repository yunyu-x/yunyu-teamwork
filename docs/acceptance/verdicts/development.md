# 云驭协同 v0.5.1 · 开发验收评审

- 评审角色：development reviewer（只读评审，非实现）
- 评审日期：2026-11-22
- 评审范围：REST API 契约、自动化实测脚本、任务/预算/存储/所有权/HTTP 服务核心实现
- 评审约束：未修改 `src/`、`web/`、`tests/`、`scripts/`，未执行 Git 提交或推送

## 1. 验收结论

**有条件通过（仅限第 0–8 关离线自动化冒烟范围）**：现有记录能够证明主链路可运行，`npm run check` 与工程审计也均通过；但任务门禁和并发预算熔断存在已复现的语义缺口，实测脚本亦有假阳性空间，且 3 项既有 P0 尚未闭环，因此本结论不代表生产发布验收通过。

生产发布前至少应完成：既有 `C-01`、`C-02`、`S-02`，以及本报告新增 `DEV-01` 至 `DEV-05`。第 9 关真实 GitLab、第 10 关 Docker 仍需在具备环境后补测，不能以 Mock 或静态资产审计替代。

## 2. 证据清单

### 2.1 命令与实测记录

| 证据 | 结果摘要 |
| :--- | :--- |
| `npm run check` | 退出码 0；`[check-syntax] OK: 92 JS/MJS files passed node --check.` |
| `node bin/yunyu.mjs audit --json` | 退出码 0；`score=100`、`passed=true`、`worldHealthScore=100`、扫描 67 文件、`findings=[]`，审计时间 `2026-11-22T14:05:07.074Z` |
| `docs/acceptance/run-record.json:1-11` | v0.5.1，Windows x64 / Node v22.16.0；汇总 `9 pass / 0 fail / 2 skip` |
| `docs/acceptance/run-record.json:442-573` | 第 3–8 关均记录为 pass；其中第 4 关 Worktree 样本实际是 `pm/main`，第 7 关 `worldFiles=null`、`auditScore=90` |
| `docs/acceptance/run-record.json:574-593` | 第 9 关真实 GitLab 与第 10 关 Docker 均为 skip，未形成真实环境验收证据 |
| `docs/acceptance/README.md:6-26` | 人可读记录与 JSON 汇总一致，并明确真实 GitLab/Docker 留待人工补测 |

本次未重复执行会改写 `run-record.json` 与 `README.md` 的实测脚本，也未额外运行 `npm test`、`npm run qa:ui`；因此不对这些未执行门禁作新增通过声明。审计 100 分仅代表其现有规则未发现告警，不覆盖下述业务状态机与并发语义。

### 2.2 无文件写入的内存探针

1. **任务门禁探针**：直接实例化 `TaskTracker`，实测得到：
   - 空 `spec` 调用 `approveSpec` 后仍返回 `status="ready"`、`specStatus="approved"`；
   - `backlog` 任务可直接 `acceptTask` 到 `done`，且未勾选的验收项被自动改为 `checked=true`；
   - 创建任务传入 `status="not-a-status"` 未报错，而是静默落为 `backlog`。
2. **并发预算探针**：内存模式创建 `maxTurns=1` 蜂群，两个 `simulated` 成员由同一 `@all` 并发唤醒，实测输出 `executions=2`、`turnsUsed=2`、`status="exceeded"`。即熔断是在超支后呈现状态，未阻止第二轮执行。

探针位置对应 `src/core/tasks.mjs:293-390`、`src/core/tasks.mjs:467-539`、`src/core/orchestrator.mjs:741-826`。

### 2.3 PROTOCOL 与路由核对

**已核对结论：文档第 5 节列出的方法和路径均能找到实现，未发现“文档写了但路由完全不存在”的情况；主要漂移是核心端点缺失、字段/状态码未定义，以及鉴权措辞不精确。**

| 契约项 | 实现证据 | 核对结果 |
| :--- | :--- | :--- |
| `GET /api/health`、`GET /api/metrics` | `src/server/routes.mjs:150-182`；限流豁免见 `src/server/app.mjs:105-115` | 方法、路径、字段和 200 响应一致；health 确有限流豁免 |
| Swarms、消息、翻译、图谱、成员、所有权、Worktree merge | `docs/PROTOCOL.md:115-122`；`src/server/routes.mjs:276-399`、`704-715`、`717-828`、`930-958` | 文档列出的路径与方法一致；消息实现额外支持 `seqs`，文档未列出 |
| Plugins、Connectors、Skills、Hooks、外部 MCP Clients、spawn-agent | `docs/PROTOCOL.md:123-129`；`src/server/plugin-routes.mjs:70-433` | 文档列出的路径与方法一致；文档未定义安装模式、请求字段、响应包装及 400/401/403/404/409 |
| GitLab Webhook | `docs/PROTOCOL.md:130`；`src/server/routes.mjs:323-332`、`1192-1234` | 路径一致；成功 200、忽略 202、验签失败 401 等状态未写入契约 |
| Tasks / Budget / Knowledge / Research / Logs / World Model / Wiki / Audit | `src/server/routes.mjs:401-715`、`838-928` | **PROTOCOL 第 5 节整体缺失**，但这些恰是实测脚本核心依赖 |
| `GET /api/swarms/:id/tasks/:taskId` | `src/server/routes.mjs:401-608` | 实现没有该路由，仅有 GET 集合、GET ready、PUT 单任务及动作路由；前两轮脚本误用 GET 单任务确属脚本缺陷，不是产品路由回退 |

实现中的关键响应形态包括：创建蜂群/消息/任务分别返回 201 和对象本体，任务集合返回 `{ "tasks": [...] }`，任务 accept 返回 `{ ...task, "mergeResult": ... }`，知识库集合返回 `{ "entries": [...] }`，start 对依赖阻塞返回 409，部分 start/accept 缺失任务返回 404。上述状态码与请求/响应字段均未在 `docs/PROTOCOL.md` 形成可供客户端独立实现的契约。

另有两处文档漂移：

- `docs/PROTOCOL.md:114` 写 metrics“需 Bearer 鉴权”，实现实际是：配置 `YUNYU_API_TOKEN` 时同时接受 Bearer 或 `?token=`（`src/server/routes.mjs:35-53`），未配置 token 的本机模式则允许匿名访问。建议改成条件式准确描述，并与既有 `S-03` 的查询串 token 收敛决策一致。
- `docs/PROTOCOL.md:117` 未列消息查询的 `seqs` 参数，实现在 `src/server/routes.mjs:366-375`。

## 3. 问题清单

### P0 — 既有问题复核确认（沿用原 backlog，不重复建单）

#### P0-1 `C-01`：跨进程写同一数据目录仍无单写者治理

- 证据：`src/core/storage.mjs:60-69` 使用固定 `meta.json.tmp` 后 rename，`:82-95` 直接同步 append，无锁、无进程所有权；既有待办 `docs/review/backlog.json:56-71` 已准确登记。
- 风险：HTTP 与 stdio MCP 等进程同时写时，可能互相覆盖 meta 临时文件或破坏事件顺序；同步 `appendFileSync` 只能降低单进程内交错风险，不能提供跨进程一致性。

#### P0-2 `C-02`：JSONL 坏行被静默丢弃，审计完整性不可见

- 证据：`src/core/storage.mjs:98-117` 对每行 `JSON.parse` 失败后返回 null 并过滤，无告警、隔离区或水位校验；既有待办 `docs/review/backlog.json:73-88` 已登记。
- 风险：崩溃或磁盘故障后的部分写入会被当成“不存在的历史”，重放得到缺事件的投影，与追加式可审计目标不符。

#### P0-3 `S-02`：发帖身份仍由请求体自报，可冒充任意成员

- 证据：`src/server/routes.mjs:378-388` 直接采用 `body.author`，全局鉴权仅是可选共享 token（`:35-53`），没有 author 与认证 principal 绑定；既有待办 `docs/review/backlog.json:186-199` 已登记。
- 风险：持有共享 token 的调用方可伪造作者、审批人或 Agent 发言，破坏审计归因与人工门禁可信度。

### P1 — 本轮新增

#### P1-1 `DEV-01`：Issue 状态机、Spec 冻结与验收门禁可绕过，重复创建还会覆盖旧任务

- 证据：
  - `src/core/tasks.mjs:324-326` 将非法创建状态静默回退为 backlog；
  - `:329-340` 对重复 id 调用 update，而路由 `src/server/routes.mjs:434-445` 仍固定返回 201；未提供字段会按 create 默认值覆盖旧描述、Spec、状态、负责人等；
  - `src/core/tasks.mjs:467-480` 不要求 Spec 非空即可 approved；
  - `src/server/routes.mjs:485-525` start 只检查依赖，不检查 `specStatus` 和当前状态；
  - `src/server/routes.mjs:593-607` 允许通过通用 PUT 任意改状态，可绕过 approve/start/accept 动作门禁；
  - `src/core/tasks.mjs:525-539` accept 不限制前置状态，并无条件把所有验收项改为 checked。
- 实测：空 Spec 可进入 ready；backlog 可直接 done；非法状态被吞掉。
- 风险：文档宣称的“冻结 Spec → 执行 → 待验收 → 验收”闭环可被 API 直接跳过，验收清单出现虚假完成记录；重复 POST 可造成非预期数据覆盖。

#### P1-2 `DEV-02`：预算硬熔断存在跨成员并发竞态，失败轮次也不记账

- 证据：`src/core/orchestrator.mjs:751` 先 `checkAllow`，随后可能等待 Hook（`:769-797`）和驱动执行（`:807-818`），直到 `:823-826` 才 `recordUsage`；不同成员有各自独立的串行 dispatch 链，因此可同时通过检查。异常分支 `:875-905` 不记录 turn/token。
- 实测：`maxTurns=1` 时两个并发成员实际执行 2 次。
- 风险：多 Agent 并行这一核心场景下，轮次预算不是硬上限，可能产生超额模型调用与费用；持续失败的调用还可绕过轮次上限。

#### P1-3 `DEV-03`：实测脚本多处只验证“有响应”，不足以证明关卡语义，存在假阳性

- 证据：
  - 第 2 关 `scripts/manual-test-run.mjs:112-120` 未断言 `health.json.ok`、UI HTTP 状态和关键 metrics 值；
  - 第 3 关 `:131-138` 只读 SSE `connected` 首帧，没有验证发帖后的 `message` 推送；
  - 第 4 关 `:150-152` 只返回 Worktree 数量不断言隔离分支；实际证据 `docs/acceptance/run-record.json:464-468` 采样的是 `pm/main`，并非 `sim-worker` 的隔离 Worktree；
  - 第 5 关 `scripts/manual-test-run.mjs:171-180` 未断言 `budget.status="exceeded"` 和预算告警必存在，仅用固定 3 秒观察窗；依赖 409 也未校验错误语义；
  - 第 7 关 `:197-204` 不验证 world refresh 文件数、impact 目标命中和 audit 最低分，因此 `worldFiles=null` 仍 pass；
  - 第 8 关 `:209-214` 不断言插件/连接器预期数量、`sync.dryRun=true` 或 planned files，仅检查一个 `.mcp.json` 未生成。
- 风险：功能退化、空结果或错误响应仍可能形成绿色记录；本轮“9 pass”应解释为脚本执行结果，不等同于所有标题所述能力均被充分证明。

#### P1-4 `DEV-04`：实测脚本缺少全局资源兜底，SSE 首帧可无限等待

- 证据：临时目录和 server 在 `scripts/manual-test-run.mjs:55-59` 创建，清理仅位于正常收尾 `:228-231`，没有顶层 `try/finally`；SSE 请求和 `reader.read()` 在 `:131-137` 无超时，abort 只在成功读到一帧后执行，异常路径也不会在局部 finally abort；demo 子进程 Promise `:99-106` 未监听 `error` 事件。
- 风险：SSE 无首帧时脚本可永久挂起；非预期异常、close/rm 失败或进程错误会遗留 server、子进程和临时沙盒，失败时还可能来不及写实测记录。

#### P1-5 `DEV-05`：任务内存投影先于 JSONL 持久化变更，写盘失败会造成内存与磁盘分叉

- 证据：创建任务在 `src/core/tasks.mjs:384-386` 先更新 Map/order 再 append；更新任务在 `:453-461` 先 `this.tasks.set` 再 append。`src/core/storage.mjs:92-95` 的目录创建或 append 可同步抛错，但 tasks 没有回滚。
- 风险：客户端收到错误后，当前进程却仍可见已变更任务，重启后又丢失该变更；并发读可观察到未持久化状态，破坏事件溯源一致性。

### P2 — 本轮新增

#### P2-1 `DEV-06`：PROTOCOL 不是完整的 REST 契约，核心端点、字段和状态码缺失

- 证据：见 §2.3；`docs/PROTOCOL.md:109-130` 仅是一张核心速查表，没有任务、预算、知识库、世界模型、Wiki、审计等实测依赖接口，也无统一错误结构和鉴权条件说明。
- 影响：第三方客户端只能读源码推断契约，前两次脚本误用不存在路由正是这一 DX 风险的现实例子。

#### P2-2 `DEV-07`：API 输入校验和错误状态码不统一

- 证据：非法创建状态和优先级在 `src/core/tasks.mjs:324-326`、`:360-362` 被静默替换；预算负值/非数值在 `src/core/budget.mjs:32-37` 被转为 0（即无限预算）而不是拒绝；`src/server/app.mjs:138-143` 把普通 `Error` 一律映射为 400，导致部分“任务不存在”路径返回 400，而 start/accept 又显式返回 404。
- 影响：配置错误可能悄悄关闭保护，客户端无法稳定地区分参数错误、资源不存在和状态冲突。

#### P2-3 `DEV-08`：IPv6 回环地址生成的 server base URL 不合法

- 证据：`src/server/app.mjs:155-163` 直接拼接 ``http://${this.host}:${this.port}``；当 host 为 `::1` 时缺少方括号，结果不是合法 WHATWG URL。CORS 代码已在 `src/server/routes.mjs:23-29` 考虑 `[::1]`，两处处理不一致。
- 影响：使用 IPv6 回环绑定启动后，返回的 base URL 无法直接传给 `fetch`；当前 Windows/IPv4 实测未覆盖该分支。

### 3.1 正向确认

- `package.json:16-18` 声明 Node `>=22.0.0`，且无 `dependencies`/`devDependencies`，符合零外部运行时依赖约束。
- `src/core/storage.mjs:82-95` 的同步追加在单进程 JS 事件循环内避免了异步 append 交错；本报告不将其误判为单进程并发写bug，P0 仅针对跨进程与崩溃恢复。
- `src/core/orchestrator.mjs:1205-1211` 对 swarm id 有严格白名单与重复检查；`src/core/storage.mjs:164-173` 另有路径安全清理。
- `src/core/ownership.mjs:7-16` 统一反斜杠并使用 `path.posix.normalize`，`:21-55` 对 glob 正则字符做转义且 Windows/macOS 使用大小写不敏感匹配，`:118-179` 能拦截 `../` 穿越和只读角色越界。
- `src/server/app.mjs:168-214` 静态文件使用 `path.relative` 与 realpath 双重边界检查；脚本自身使用 `path.join`、`fileURLToPath` 和独立临时 Git 仓库，当前 Windows 路径处理未发现阻断问题。
- 实测脚本对 Issue 生命周期数组、依赖解锁、知识检索和 JSONL 事件存在性做了真实语义断言，这些部分应保留。

## 4. 建议待办项

### 4.1 既有 P0 的验收要求（直接沿用，不重复并入）

| id | 标题 | 优先级 | 验收标准摘要 |
| :--- | :--- | :--- | :--- |
| `C-01` | 跨进程单写者治理 | P0 | 双进程并发集成测试无 meta 覆盖与事件交错，或 stdio MCP 默认改 HTTP 代理并记录 ADR |
| `C-02` | 崩溃恢复与坏行治理 | P0 | 中途 kill 注入测试通过；坏行隔离并告警而非静默丢弃；提供修复 CLI |
| `S-02` | author 绑定认证 principal | P0 | 伪造 author 返回 403；审计事件携带可信身份 |

### 4.2 可直接并入 `docs/review/backlog.json` 的 `items` 草案

```json
[
  {
    "id": "DEV-01",
    "title": "封死 Issue 状态机、Spec 与验收绕过并拒绝重复创建覆盖",
    "priority": "P1",
    "phase": "A",
    "perspective": "development/core",
    "ownerRole": "core",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "src/core/tasks.mjs:324-340",
      "src/core/tasks.mjs:467-539",
      "src/server/routes.mjs:434-445",
      "src/server/routes.mjs:485-525",
      "src/server/routes.mjs:593-607",
      "docs/acceptance/verdicts/development.md §2.2 内存探针"
    ],
    "acceptance": "空 Spec/未冻结 Spec 的非法启动被拒绝；backlog 不可直接 accept；通用 PUT 不能绕过合法状态迁移；accept 不再无依据自动伪造 AC 勾选；重复 id POST 返回 409 且不修改旧任务；非法 status/priority 返回 400；正反向 REST 与单元测试覆盖"
  },
  {
    "id": "DEV-02",
    "title": "预算并发预授权与失败轮次记账，恢复硬熔断语义",
    "priority": "P1",
    "phase": "A",
    "perspective": "development/core",
    "ownerRole": "core",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "src/core/orchestrator.mjs:741-826",
      "src/core/orchestrator.mjs:875-905",
      "src/core/budget.mjs:85-140",
      "docs/acceptance/verdicts/development.md §2.2 maxTurns=1 并发探针 executions=2"
    ],
    "acceptance": "同一蜂群多成员并发唤醒时 maxTurns 不被突破；@all 且 maxTurns=1 的回归测试 executions<=1；token/cost 采用可审计的 reservation 或 in-flight 上限策略；失败驱动调用按明确契约计入轮次并持久化；测试覆盖并发、异常与重启恢复"
  },
  {
    "id": "DEV-03",
    "title": "补齐 manual-test-run 语义断言并加入故障注入反证",
    "priority": "P1",
    "phase": "A",
    "perspective": "development/qa",
    "ownerRole": "qa",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "scripts/manual-test-run.mjs:112-120",
      "scripts/manual-test-run.mjs:131-138",
      "scripts/manual-test-run.mjs:150-180",
      "scripts/manual-test-run.mjs:197-214",
      "docs/acceptance/run-record.json:464-468 Worktree 样本为 pm/main",
      "docs/acceptance/run-record.json:524-540 worldFiles=null 仍 pass"
    ],
    "acceptance": "断言 health.ok、真实 SSE message、sim-worker 非 main 隔离 Worktree、budget exceeded+专属告警+调度静止、world 文件数与 impact 命中、明确 audit 阈值、插件/连接器数量、dryRun=true+plannedFiles+全目标无写入；依赖 409 校验错误语义；至少 3 个故障注入用例能令对应关卡失败"
  },
  {
    "id": "DEV-04",
    "title": "manual-test-run 全路径超时与 try/finally 资源清理",
    "priority": "P1",
    "phase": "A",
    "perspective": "development/qa",
    "ownerRole": "qa",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "scripts/manual-test-run.mjs:55-59",
      "scripts/manual-test-run.mjs:99-106",
      "scripts/manual-test-run.mjs:131-137",
      "scripts/manual-test-run.mjs:228-240"
    ],
    "acceptance": "SSE fetch/read 有独立超时且异常时 abort；demo spawn 处理 error；顶层 finally 关闭 server/子进程并清理两个临时根；注入 SSE 无首帧、stage 异常和 close 异常后无残留进程/沙盒，失败记录仍能落盘；Windows 与 POSIX 均验证"
  },
  {
    "id": "DEV-05",
    "title": "消除任务内存投影与 JSONL 写盘失败后的状态分叉",
    "priority": "P1",
    "phase": "A",
    "perspective": "development/core",
    "ownerRole": "core",
    "status": "open",
    "dependsOn": [
      "C-02"
    ],
    "evidence": [
      "src/core/tasks.mjs:384-386",
      "src/core/tasks.mjs:453-461",
      "src/core/storage.mjs:92-95"
    ],
    "acceptance": "注入 mkdir/append 写盘失败后，内存任务、HTTP 结果与重启重放三者一致；失败操作不产生半提交事件；创建与更新路径均有故障注入回归测试，并保持追加式历史不被就地改写"
  },
  {
    "id": "DEV-06",
    "title": "将 PROTOCOL 补全为可独立实现的 REST API 契约",
    "priority": "P2",
    "phase": "A",
    "perspective": "development/dx",
    "ownerRole": "docs",
    "status": "open",
    "dependsOn": [
      "D-02"
    ],
    "evidence": [
      "docs/PROTOCOL.md:109-130",
      "src/server/routes.mjs:401-715",
      "src/server/routes.mjs:838-928",
      "src/server/plugin-routes.mjs:70-433"
    ],
    "acceptance": "补齐 tasks/budget/knowledge/research/logs/world-model/wiki/audit 等端点；每个端点记录方法、路径、查询/请求字段、成功响应字段、400/401/403/404/409/413/429 语义和统一错误结构；说明 seqs 与条件鉴权；契约对照测试防止路由漂移"
  },
  {
    "id": "DEV-07",
    "title": "统一 API 输入校验、预算数值边界与错误状态码",
    "priority": "P2",
    "phase": "A",
    "perspective": "development/backend",
    "ownerRole": "backend",
    "status": "open",
    "dependsOn": [
      "DEV-01",
      "DEV-06"
    ],
    "evidence": [
      "src/core/tasks.mjs:324-326",
      "src/core/tasks.mjs:360-362",
      "src/core/budget.mjs:32-37",
      "src/server/app.mjs:138-143"
    ],
    "acceptance": "非法枚举、非有限数、负数和非整数轮次在边界返回 400，不得静默变成无限预算或默认状态；所有任务动作的不存在统一 404、非法状态迁移统一 409；错误响应结构一致并有 REST 参数矩阵测试"
  },
  {
    "id": "DEV-08",
    "title": "修正 IPv6 host 的 base URL 格式化并补回环集成测试",
    "priority": "P2",
    "phase": "C",
    "perspective": "development/backend",
    "ownerRole": "backend",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "src/server/app.mjs:155-163",
      "src/server/routes.mjs:23-29"
    ],
    "acceptance": "host=::1 时 server.start 返回合法 http://[::1]:port URL，fetch /api/health 成功；IPv4、localhost 与 Windows 现有行为无回归"
  }
]
```

## 5. 最终闭环建议

1. 先修 `DEV-01`、`DEV-02`，再增强 `DEV-03`；否则绿色实测仍可能掩盖门禁回归。
2. 将两个内存探针固化为自动化负向/并发测试，并纳入标准门禁。
3. 修复后重新运行完整实测，保留真实 GitLab 与 Docker 补测记录；届时再把“有条件通过”升级为对应发布范围内的“通过”。

---

评审模型署名：**Kimi-K3.1-Pro（开发角色）**
