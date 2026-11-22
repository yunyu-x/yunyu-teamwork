# 架构视角闭环验收评审（Architecture Acceptance Verdict）

> **评审对象**：yunyu-teamwork v0.5.1（工作区 `D:\workspace\codex\yunyu-teamwork`）
> **评审角色**：architect（只读验收评审；未修改 `src/`、`web/`、`tests/` 任何文件，未执行 git commit/push）
> **评审依据**：AGENTS.md 六条硬不变量 · docs/ARCHITECTURE.md · docs/acceptance/run-record.json + README.md · docs/review/01-architecture-baseline.md + backlog.json（交叉复核）
> **独立取证（2026-11-22 实测）**：
> - `node bin/yunyu.mjs audit --json` → score **100** / total **0** / scannedFiles 67 / worldHealthScore 100
> - `npm run check` → **92** 个 JS/MJS 文件 node --check 全部通过
> - `npm test` → **46/46 通过**（11.6s，独立复核与评审档案记录一致）
> - `node -e` 实测 `MCP_TOOLS.length = 37`
>
> **评审模型署名**：**DeepSeek-V4-Pro（架构角色）**

---

## 1. 验收结论

**结论：有条件通过。**

**一句话理由**：六条硬不变量全部在代码中真实落地且文档声明与实现高度一致（抽查数字全部属实），但企业级目标下存在 5 项代码可证实的 P0 信任缺口与 1 项 P0 决策缺口（D1 定位未拍板），且自动化实测记录存在 4 处证据口径瑕疵——机制验收通过，企业级交付须先闭合 P0 并修复实测口径。

**通过条件（在 v0.6 前必须满足）**：
1. 闭合 5 项 P0：跨进程单写者、密钥不落盘、author 身份绑定、Webhook 超时与回调鉴权、崩溃恢复加固；
2. 拍板决策门 D1（单节点企业内网 vs 多租户 SaaS）并落 ADR；
3. 实测记录口径修复（V-01）。

---

## 2. 六条硬不变量落地证据（文件级）

| # | 硬不变量 | 判定 | 文件级证据（本次一手抽查） |
| :--- | :--- | :--- | :--- |
| 1 | 零外部运行时依赖 | ✅ 落地 | `package.json` 全文无 `dependencies`/`devDependencies` 字段；`engines.node >= 22.0.0`（package.json:16-18）；抽查全部 import 均为 `node:` 内置或相对路径（storage.mjs:1-2、worktree.mjs:1、hooks.mjs:1-4）；audit 实测零依赖检查 0 发现项 |
| 2 | 追加式不可变 JSONL | ✅ 落地（含加固点） | `appendEvent → fs.appendFileSync(events.jsonl, {mode:0o600})`（src/core/storage.mjs:82-96）；meta.json tmp+rename 原子写（storage.mjs:66-69）；消息与双语翻译注解均走追加（src/core/board.mjs:236、:259）；验收第 6 关实测 23 行 JSONL 追加断言通过（run-record stage 6）。⚠️ 加固缺口：坏行静默丢弃（storage.mjs:110-114）、无 seq 水位校验 → 问题 P0-5 |
| 3 | 作者 ↔ 只读审查角色隔离 | ✅ 落地 | 禁改清单 14 项（src/core/constants.mjs:87-101）；verifier/qa/reviewer/researcher 四角色+四名称判定并自动追加禁改（src/core/ownership.mjs:89-100）；写入校验含路径穿越/globalForbidden/mustNotTouch/owns（ownership.mjs:118-180）；`run_command` 硬拦截（src/drivers/base.mjs:186-193）与外部 MCP 硬拦截（base.mjs:438-443）；Hook 之前强制隔离、只读角色无法经 Hook/MCP 越权（base.mjs:472-489）；提交/推送/合并三处 `auditChangedFiles()` 越权审计（src/core/worktree.mjs:515-521、:484-489、:554-560） |
| 4 | 并发作者 Worktree 隔离 | ✅ 落地 | share=`git worktree add -b`（worktree.mjs:295-303）；branch=`git clone --no-hardlinks`（worktree.mjs:304-306）；inherit=共享主目录（worktree.mjs:270-283）；合并 `--no-ff`+未提交改动拦截（worktree.mjs:562-568、:583-593）；销毁保护（未合并改动默认拒绝，worktree.mjs:619-624）；重启 rehydrate 自动修复（worktree.mjs:128-263）；目录越界防护 `_assertSafeWorktreeTarget`（worktree.mjs:649-681）；验收第 4 关实测 share 工作区创建与回帖自证（run-record stage 4） |
| 5 | 事件驱动零轮询唤醒 | ✅ 落地 | 唤醒判定：@member / @worker-N 前缀分组 / @#channel 订阅 / @all，不自唤醒、monitor 豁免（src/core/orchestrator.mjs:706-721）；调度：noWake 短路、50 轮上限、human→waiting_human、每成员串行 Promise 链（orchestrator.mjs:723-744）；预算前置熔断+noWake 系统告警（orchestrator.mjs:751-764）；零算力 `waitForMention` 长轮询（orchestrator.mjs:672-704）；看门狗 15s 巡检/30s 阈值/`[done]` 自动停机/人工门禁 30→480s 指数退避（src/core/monitor.mjs:12-13、:46-50、:74-81）；验收第 5 关实测熔断后唤醒被拦截、系统告警携带 noWake（run-record stage 5 `breakerBlockedWake:true`） |
| 6 | 中文优先人机友好 | ✅ 落地 | 默认语言 `zh-CN`（constants.mjs:115）；看门狗提醒/限流/越权拦截消息全中文（monitor.mjs:90-97、src/server/app.mjs:112、ownership.mjs:125）；前端默认中文并一键切换（web/app.js:398）；技术标识（Git SHA、命令、JSON 键名）保留英文——抽查确认 |

**结论：六条硬不变量在 v0.5.1 代码中全部真实落地，无一处名存实亡。**

---

## 3. 模块边界与依赖方向评估

**分层健康（✅）**：
- 依赖方向：`server → core`、`drivers → core`、`plugins → core` 成立；core 仅存在两条已知反向边——`core/orchestrator → gitlab`（orchestrator.mjs:23-24）与 `core/orchestrator → plugins/hub`（orchestrator.mjs:25）；**core 零导入 server/drivers/mcp**；plugins→core 为单向（plugins/registry.mjs:6-7、plugins/skills-runtime.mjs:1、plugins/mcp-client.mjs:4-5）。
- 无循环依赖：本次 audit 实测 `worldHealthScore: 100`；与 01 基线「268 依赖边 / 0 环」一致。
- 所有权边界与 AGENTS.md 表格一致（core/server/drivers/plugins/channels/gitlab/mcp 各司其职，无越界文件）。

**文档漂移评估（✅ 基本无漂移，2 处轻微瑕疵）**：
- ARCHITECTURE.md v0.5.1 声明数字**全部抽查属实**：37 MCP 工具（实测）、10 Hook 事件（src/plugins/hooks.mjs:6-17）、8 连接器（src/plugins/connectors.mjs:19-89）、15 SSE 事件（orchestrator.mjs:1178-1188 + :1246 + :1140-1141）、限流 1200/min 且 /api/health 豁免（src/server/rate-limit.mjs:8、app.mjs:107）、非回环强制 token（rate-limit.mjs:51-59、app.mjs:100）、90s 出站超时（src/drivers/openai-compatible.mjs:451）、看门狗 15/30s 与指数退避（monitor.mjs:12-13、:74-81）、SSE 200 连接上限（src/server/sse.mjs:5）。
- 瑕疵 D-1：ARCHITECTURE.md §1 文字「依赖方向健康：server → core、drivers → core、plugins → core」未提及 core→gitlab/plugins 两条反向边（拓扑图已画出，01 基线如实披露）→ 建议补一句说明（待办 V-02）。
- 瑕疵 D-2：审计器文档一致性门禁仍未落地——auditor.mjs:369-405 仅检查版本号字面量，不校验 README 徽章/工具数/视图数等派生数字（backlog D-02 保持 open，本次实测 audit 100 分恰恰不覆盖此类漂移，佐证该盲区）。

---

## 4. 企业级架构缺口清单（P0/P1/P2）

### P0（6 项：5 项代码可证实 + 1 项决策门）

| ID | 问题 | 位置（本次核实） | 建议 |
| :--- | :--- | :--- | :--- |
| P0-1（=C-01） | 跨进程双写者无锁：HTTP 服务与 stdio MCP 各自实例化 TeamworkManager 写同一 `.yunyu`；JSONL 追加无锁、meta.json 全量重写无互斥 | bin/yunyu-mcp.mjs:10-14；src/server/app.mjs:80-88；src/core/storage.mjs:94、:60-70 | dataDir lockfile 单写者治理（含陈旧锁检测），或 stdio MCP 默认转 HTTP 代理模式；配套并发集成测试（Q-01） |
| P0-2（=S-01） | 密钥明文落盘：`sanitizeForStorage` 仅剥离 function/symbol，apiKey/secret 原样写入 meta.json；GitLab token 在 `persistToken:true` 时落盘；SENSITIVE_FIELD_RE 仅作用于 API 响应层 | src/core/orchestrator.mjs:27-44、:419、:437-439 | 密钥引用化（仅存 env 名）、persistToken 默认 false、审计器新增「落盘密钥」检查项 |
| P0-3（=S-02） | author 可冒充：发帖/任务/知识等 9 处 `body.author` 任意声明，单全局 token 无 principal 绑定，审计轨迹作者不可信 | src/server/routes.mjs:381、439、511、600、674、685、881、894、924；鉴权本体 :35-53 | token→身份 principal 模型，伪造 author 返回 403；为 E-01 RBAC 预留身份模型 |
| P0-4（=C-05） | Webhook 出站 fetch 无超时/AbortSignal（挂起远端永久阻塞该成员串行调度链）；`async→alreadyPosted` 后远端回调走自报 author 的普通 POST，无鉴权无关联 | src/drivers/webhook-agent.mjs:48-52、:62-64（对比 openai-compatible.mjs:451 有 90s 超时） | 出站超时 + 回调关联令牌/签名；超时释放成员串行链（测试覆盖） |
| P0-5（=C-02） | 崩溃恢复静默丢数据：JSONL 坏行静默丢弃、损坏蜂群仅 console.error 跳过、无 seq 水位校验、meta/events 双写无事务 | src/core/storage.mjs:110-114；src/core/orchestrator.mjs:1172 | 坏行隔离区+告警、seq 水位校验、损坏蜂群修复 CLI；kill -9 中途写入注入测试（Q-01） |
| P0-6（=D1） | 【决策门】企业级定位未拍板：单节点企业内网 vs 多租户 SaaS——决定 E-09 多租户、P-02 扩展路径、E-01 RBAC 的深度与顺序；04 对标已证实 RBAC+SSO+审计是六家平台一致的采购硬门槛 | docs/review/backlog.json decisionGates.D1（open） | D1 尽快拍板并落 ADR（D-05）；无论哪个分支，S-02→E-01→E-02 身份链均为 B 阶段前置 |

### P1（13 项，全部已在 backlog.json 登记，本次抽样复核证据一致）

| ID | 问题 | 位置 | 建议 |
| :--- | :--- | :--- | :--- |
| C-03 | 同一 events.jsonl 被 4 模块各自全量重放 O(n)，重启即全量解析；无索引无分页 | board.mjs:73、tasks.mjs:82、knowledge.mjs:35、wiki.mjs:71 | 统一事件投影层，收敛重放路径（先于 E-03） |
| C-04 | SSE 帧无 `id:`、不支持 Last-Event-ID 补拉、broadcast 忽略写背压，断线即丢事件 | src/server/sse.mjs:40-48；web/app.js 重连无补拉 | 事件 id + 断线补拉 + 背压处理（集成测试） |
| C-06 | GitLab 镜像静默失败 + 标签读-改-写非原子竞态 + tasks 投影 catch{} 吞错 | orchestrator.mjs:220-222、:254-257；src/gitlab/sync.mjs:54-61 | 镜像失败 surfaced + 死信/重试 + 标签原子更新 |
| S-03 | `?token=` 查询串鉴权，token 泄入反代日志/浏览器历史 | routes.mjs:47-48 | 默认拒绝查询串 token（或仅 SSE 且文档警示） |
| P-04 | agent-logs.jsonl 磁盘无轮转、追加未设 mode（内存态却有 500 条上限）；每条消息全量重写 meta.json | storage.mjs:128、:131-133；orchestrator.mjs:224 | 磁盘轮转可配、logs 目录 0o700/文件 0o600、meta 节流/增量写 |
| P-01 | 同步 fs 阻塞事件循环（ADR-6 代价），大文件读全量进内存 | storage.mjs:94、:104-116 | fs 异步化 + 读路径分页/索引 + event loop lag 指标 |
| E-01 | 无人员账号/RBAC（role 仅为 Agent 工程角色，constants.mjs:18-30），token 持有者=超级管理员 | routes.mjs:35-53 | 5 角色权限矩阵 + 全路由鉴权覆盖 + 操作归因（依赖 S-02） |
| E-02 | 无企业身份对接（OIDC SSO） | —（node:crypto 可验 RS256，零依赖可行） | code flow + id_token/JWKS/nonce/PKCE 测试 |
| E-03 | 无读索引：查询依赖线性扫描；`node:sqlite` 为破局点但需 D2 拍板（engines 下限张力） | storage.mjs:104-116 | D2 拍板后：sqlite 读索引 + checkpoint 增量重放，JSONL 保持唯一审计源 |
| E-04/E-05 | 无里程碑/迭代/工时/自定义字段；无报表与 agent token/成本按 Issue/成员归集（差异化赛道） | src/core/tasks.mjs 现仅 6 态+DAG+Spec | 够用就好（对标 04 裁定）；成本归集报表为差异化重点 |
| E-06/E-07 | 仅单点 human_gate + 看门狗退避，无多级签核/超时升级；通知偏单向 | monitor.mjs:74-81；src/channels/ | 人机混合审批流 + 通知路由中心（不做通用 BPM） |
| Q-01/Q-02 | 无竞态/崩溃/性能测试床；无长稳内存/SSE 满连接压测（tests/ 25 文件勘察证实） | tests/ | 并发双实例写、租约跨进程、中途 kill、万级消息基准、24h 稳态断言入 CI |
| F-01/D-02 | 前端单一可变全局 state 无虚拟滚动无错误边界；审计器不查文档一致性 | web/lib/state.js:3-60；auditor.mjs:369-405 | 状态分片+虚拟滚动+视图级错误边界；audit 校验工具数/视图数/徽章与 constants 一致 |

### P2（6 项，既有 backlog 原样承接）

| ID | 问题 |
| :--- | :--- |
| P-02 | 水平扩展路径（依赖 C-01/E-03/D4：垂直优化 vs 蜂群分片多进程） |
| P-03 | 备份/快照/DR CLI + Prometheus 文本格式 + RPO/RTO 目标 |
| E-08 | 审计 hash 链防篡改 + 合规导出 + 留存策略 |
| E-09 | 多租户隔离/配额/计费（D1=SaaS 时才启动，当前 deferred） |
| X-03/X-04/X-05 | 多仓库联邦世界模型 / Jira·飞书项目·Teambition 适配器 / 插件市场签名与版本锁定 |
| F-02/D-05 | 白标主题+无障碍（WCAG AA）/ ADR 决策记录治理 |

---

## 5. 自动化实测记录充分性评审（架构视角）

### 5.1 已覆盖的机制（✅）

- **离线全链路**（stage 1）：真实 Git Worktree + GitLab Mock + 世界模型 13 条留言板记录；
- **服务面**（stage 2）：health/metrics/UI 可达、7 驱动注册表、6 模板、8 连接器；
- **事件唤醒**（stage 3-4）：人类发帖 + SSE 首帧 + simulated 成员 @mention 唤醒 + share 工作区自证；
- **治理机制**（stage 5）：Issue 六态 + DAG 依赖 409 + 验收解锁 + 预算熔断阻断唤醒 + noWake 系统告警；
- **持久化**（stage 6）：知识库写入→检索→JSONL 追加行级断言；
- **世界模型/Wiki/审计**（stage 7，审计口径见 5.3-R1）；
- **插件生态**（stage 8）：双规范清单 + 8 连接器探测 + claude-code dry-run 零写入；
- **回归套件**（本次独立实测 npm test 46/46）：board/ownership/worktree/monitor/drivers/gitlab-webhook/cli-agent-stream/rehydrate-recovery/swarm-e2e/http-api-sse/digital-twin/MCP/plugins-hooks/security-hardening/server-hardening/monitor-backoff 等 25 文件。

### 5.2 未被测试覆盖的架构风险（⚠️ 与 §4 缺口一一对应）

1. **并发与竞态**：双进程写同一 `.yunyu`、租约跨进程、并发 worktree 冲突（P0-1）——无任何测试；
2. **崩溃注入**：kill -9 中途写入、坏行隔离、meta/events 双写不一致（P0-5）——无；
3. **性能与容量**：万级消息重放/查询延迟、同步 fs 阻塞、SSE 200 满连接、长稳内存增长（ADR-2/ADR-6 代价）——无基准数据；
4. **网络故障语义**：SSE 断线补拉、webhook 挂起超时释放、GitLab 镜像失败重试（C-04/C-05/C-06）——无；
5. **鉴权负向**：伪造 author 403、`?token=` 泄露、非回环拒绝启动的端到端验证——仅单元级；
6. **真实集成**：真实 GitLab（stage 9 跳过）、Docker（stage 10 跳过）、真实 IM 六渠道、真实 Claude/Codex CLI、真实 LLM 驱动——环境受限跳过属合理裁定，Mock 已由 stage 1 覆盖；
7. **多租户/水平扩展**——无（P0-6/P-02 未拍板，符合当前定位）。

### 5.3 实测记录本身的证据口径瑕疵（建议修复，见 V-01）

- **R-1 · stage 7 `auditScore: 90` 为沙盒口径**：验收蜂群 `repoPath` 指向 `makeSandbox()` 生成的 2 文件临时仓库（scripts/manual-test-run.mjs:41-53、:113、:125），审计器因沙盒无 tests/ 扣 1 项 P1（auditor.mjs:424 公式 100−10=90）；**真实仓库本次独立实测为 100 分 / 0 发现项**。README.md 未说明该口径，易误读为产品审计未满分；
- **R-2 · stage 7 `worldFiles: null`**：refresh 响应不含 fileCount/files 字段（manual-test-run.mjs:204 取值为 null），未真正断言世界模型扫描到文件；
- **R-3 · stage 2 `uiBytes: 16117`** 仅断言 HTML 非空，未与 qa:ui 的 9 视图断言串联；
- **R-4 · 可复现性**：未记录临时目录/工作树清理策略与依赖版本锁定（node/git 版本已记录）。

---

## 6. 建议待办项草案（可直接并入 docs/review/backlog.json）

```json
[
  {
    "id": "V-01",
    "title": "实测记录口径修复：stage7 直审真实仓库 + worldFiles 字段断言 + 口径说明",
    "priority": "P1",
    "phase": "A",
    "perspective": "qa",
    "ownerRole": "qa",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "scripts/manual-test-run.mjs:41-53（沙盒仅 2 文件无 tests/）、:204（worldFiles 取值为 null）",
      "docs/acceptance/run-record.json stage7 auditScore=90",
      "docs/acceptance/README.md 未说明审计口径"
    ],
    "acceptance": "manual-test-run.mjs stage7 对真实仓库运行 ProjectAuditor 并断言 score===100；refresh 断言 fileCount>0；run-record README 注明沙盒与真实仓库两种审计口径"
  },
  {
    "id": "V-02",
    "title": "ARCHITECTURE.md §1 依赖方向补注 core→gitlab/plugins 反向边说明",
    "priority": "P2",
    "phase": "A",
    "perspective": "dx",
    "ownerRole": "docs",
    "status": "open",
    "dependsOn": [],
    "evidence": [
      "docs/ARCHITECTURE.md §1 文字未提及反向边",
      "src/core/orchestrator.mjs:23-25",
      "docs/review/01-architecture-baseline.md §2 已如实披露"
    ],
    "acceptance": "§1 文字与 01 基线 §2 表述一致；D-02 审计器文档一致性门禁落地后自动校验"
  }
]
```

> 其余缺口维持既有 backlog 原 id 不重复造：**P0**=C-01/C-02/C-05/S-01/S-02 + 决策门 D1；**P1**=C-03/C-04/C-06/S-03/P-01/P-04/E-01~E-07/Q-01/Q-02/F-01/D-02；**P2**=P-02/P-03/E-08/E-09/X-03/X-04/X-05/F-02/D-05。

---

## 7. 评审声明

- 本次评审为**只读**：未修改 `src/`、`web/`、`tests/` 任何文件，未执行 git commit/push；唯一写入文件为本 verdict。
- 证据链：一手源码抽查（全部关键论断附 `文件:行号`）+ 3 条只读命令实测（audit/check/test）+ 验收记录交叉验证 + 既有评审档案（01 基线/backlog.json）交叉复核；对既有 backlog 引用的行号全部重新抽查属实。

**评审模型署名：DeepSeek-V4-Pro（架构角色）**
