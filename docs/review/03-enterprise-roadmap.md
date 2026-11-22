# 多视角批判分析与企业级演进路线图（Enterprise Roadmap & Backlog）

> 基线：[01-architecture-baseline.md](01-architecture-baseline.md)（v0.5.1 实测）· 对比：[02-doc-comparison.md](02-doc-comparison.md) · 企业 PM 对标：[04-enterprise-pm-benchmark.md](04-enterprise-pm-benchmark.md)
> 机器可读待办：[backlog.json](backlog.json)（可直接派生为 Qoder Issue / 供 Agent 认领）
> 目标：**在坚守 AGENTS.md 六条硬不变量的前提下，把云驭协同从「内网单节点多 Agent 协作工具」演进为「企业级项目管理平台」。**

---

## 1. 多视角批判（八个 Agent 角色）

### 1.1 架构师（Architect）
**认可**：事件溯源 + 不可变审计是同类开源项目中最干净的协作底座；0 循环依赖、清晰域边界、驱动/渠道/插件三个扩展点抽象到位。
**批判**：
1. **聚合根过重**：`SwarmInstance` 聚合 10+ 领域服务（orchestrator.mjs:133-170），7000 行 core 中 orchestrator 是上帝对象趋势；Issue/知识/Wiki 各自重放同一 events.jsonl（4 处），事件分发缺乏统一「投影（projection）」抽象，新增消费者就要再写一遍重放。
2. **单进程假设渗透全局**：内存 Map + 同步 fs + SSE 内存 Set，任何水平扩展都要动骨架；而 stdio MCP 已经事实上打破了单进程假设（双 Manager 写同一目录，bin/yunyu-mcp.mjs:10-14）——**架构假设与部署现实已经矛盾**。
3. 世界模型/审计器是纯内存静态扫描，无增量缓存，大仓扫描成本会随规模线性上涨。
**建议**：引入「事件日志 = 唯一事实源 + 可插拔投影层」抽象（C-03/E-03）；先解决单写者语义（C-01），再谈扩展（P-02）。

### 1.2 后端 / 核心开发（Core Dev）
**认可**：串行 per-member 调度避免了同成员竞态；tmp+rename 原子 meta 写、坏行容错、防唤醒环（noWake）等细节成熟。
**批判**：
1. `readEvents` 全量读 + 4 消费者重复 parse：1 万条消息的蜂群重启要解析 4 万行 JSON；`board.read` O(n) 过滤，无 since 索引（storage.mjs:104-116、board.mjs:290-327）。
2. 同步 fs 阻塞事件循环：大蜂群 append/read 期间所有 HTTP/SSE 停摆（storage.mjs:94,104）。
3. meta.json 与 events.jsonl 双写无事务、无 seq 水位校验，崩溃窗口内可能状态分叉（C-02）。
**建议**：checkpoint/snapshot + 增量重放；`node:sqlite` 做读索引（决策门 D2）；fs 异步化分批让出事件循环（P-01）。

### 1.3 前端开发（Frontend）
**认可**：零构建原生 ESM + SSE 实时刷新 + 双端 CDP 验收，离线内网体验完整；9 视图信息架构清晰。
**批判**：
1. 单一可变全局 `state`（web/lib/state.js:3-60）无变更追踪，视图间靠约定同步，规模再涨会出现渲染竞态与调试黑洞。
2. 留言板/图谱全量渲染，无虚拟滚动，万级消息 DOM 会卡死（与后端 O(n) 叠加）。
3. 无组件级错误边界：一个视图抛错可能拖垮整页（CDP 只验收快乐路径）。
**建议**：F-01 状态分片 + 派生缓存 + 虚拟列表 + 视图级错误隔离；坚持零构建不变量。

### 1.4 QA / 验证官（Verifier）
**认可**：44 个测试覆盖安全回归与重启恢复，`npm run verify` 一键门禁在同类项目中属上游水平。
**批判**：
1. **零并发/竞态测试**：双实例写、多进程 append、认领租约跨进程失效均无测试（勘察证实 tests/ 无相关用例）。
2. **零崩溃注入测试**：kill -9 在 append 中途 / meta 写中途的恢复行为未验证；坏行「静默丢弃」意味着**审计数据可能无声缺失**——对「不可变审计」主张是反讽。
3. **零性能/长稳门禁**：无消息量基准、无内存增长断言，「企业级」无从谈起。
4. 审计 100/100 不查文档一致性，README 漂移漏网（auditor.mjs:375-389 仅查源码版本字面量）。
**建议**：Q-01（竞态+崩溃注入+基准）为 P0；Q-02 长稳压测入门禁；D-02 文档一致性入审计。

### 1.5 安全官（Security）
**认可**：SSRF/路径逃逸/符号链接/零信任插件/常量时间验签/敏感 env 剥离——Agent 执行面防护是同类最全面的。
**批判**：
1. **密钥明文落盘**：`sanitizeForStorage` 不剥离 apiKey（orchestrator.mjs:27-42,419），GitLab token `persistToken` 明文入 meta.json（:437-439）；脱敏只在响应层——**磁盘才是攻击面**，备份/容器卷泄露即全量密钥泄露。
2. **author 可冒充**：`author: body.author || 'human'`（routes.mjs:381），单 token 下任何持有者可伪装 coordinator 发 `[done]`、派单、验收——审计归因不可信，直接击穿不变量 #3 的「隔离」价值（隔离的是 Agent 角色，不是人）。
3. 无密钥轮换、无静态加密、无 secret store 对接；单 token 无最小权限分级。
**建议**：S-01（密钥不落盘/引用化）与 S-02（身份绑定）均 P0；E-01/E-02 补 RBAC 与 SSO。

### 1.6 SRE / 运维（Operations）
**认可**：Docker 非 root + HEALTHCHECK + 限流 + /api/metrics + 指数退避降噪，单机运维面已就绪。
**批判**：
1. 无备份/恢复工具链：`.yunyu` 全量 JSONL 是唯一资产，损坏蜂群仅 console.error 跳过（orchestrator.mjs:1172），**没有「恢复出厂」以外的修复手段**。
2. 无 RPO/RTO 定义、无快照导出/校验 CLI；metrics 无 Prometheus 文本格式（HANDOFF 称「供适配」但未实现）。
3. 单进程崩溃 = 全平台停摆，无 supervisor 策略文档（compose restart 只是兜底）。
**建议**：P-03 备份/快照/修复 CLI + 损坏隔离区；metrics 标准化；部署拓扑文档化。

### 1.7 产品 / 项目管理（PM）
**认可**：6 态 Issue + Spec 冻结 + 验收清单 + DAG + Diff 审查，研发流闭环完整，中文体验一流。
**批判**：
1. **「项目管理」≠「研发流」**：缺里程碑/迭代、优先级与排期、工时/成本归集到项目维度、跨蜂群组合视图（portfolio）、报表（吞吐/周期时间/缺陷逃逸/预算消耗趋势）——企业 PM 的核心决策面缺失。
2. 审批只有单点 `human_gate`：无多级审批、代理、超时升级、审批留痕报表。
3. 人的协作体验弱：无人员账号/通知偏好/@我的聚合/移动端 IM 深度闭环（IM 目前偏通知）。
4. GitLab 单绑定：企业现实是 GitHub/Gitee/Jira/飞书项目并存，适配器抽象已具备但未复制。
**建议**：E-04/E-05/E-06/E-07 构成「企业 PM 能力包」；X-01/X-04 平台适配；先做报表（低成本高感知）。

### 1.8 开发者体验 / 生态（DX）
**认可**：5 种接入方式 + 8 端连接器 + 渐进式技能 + 双规范插件，生态野心与完成度都高。
**批判**：
1. 文档漂移直接伤害 DX：新 Agent 读 ARCHITECTURE.md 会得到 v0.2 世界观（5 驱动、无插件层），读 README 得到 30 工具/8 视图——**第一印象即错误上下文**（详见 02 文档）。
2. HANDOFF 15 坑点未入知识库，Wiki 决策页空白，每个新会话重复付上下文成本。
3. 路线图散文式、无 ID 无验收标准，Agent 无法认领。
**建议**：D-01~D-06 一次性还清文档债并建立防回归门禁；本 backlog.json 即为结构化路线图起点。

### 1.9 独立对抗复核补充（第二评审 Agent，2026-11-22）

本档案产出后由独立评审 Agent 做了对抗性复核：**10 项核心论断全部证实**（行号精确命中），另发现 6 个运行时语义盲区与 5 处路线硬伤，均已验证并回写：

- **新盲区 → 新待办**：SSE 断线丢事件/无背压（C-04）、Webhook 异步回调无鉴权 + 出站 fetch 无超时阻塞串行链（C-05，P0）、GitLab 镜像静默失败 + 标签读改写竞态 + tasks 投影吞错（C-06）、agent-logs 无轮转 + 每消息全量重写 meta 写放大（P-04）、POSIX 孙进程泄漏（C-07）、`?token=` 查询串鉴权泄密（S-03）。证据详见 [01 基线 §7.1](01-architecture-baseline.md)。
- **路线修正**：C-03（投影层）从 P0/A 调整为 P1/B（性能重构不应挤占信任阶段，且与 C-02 同改重放路径需排序）；C-01/C-02 显式依赖 Q-01 测试床；E-02 补 OIDC 安全验收（签名/JWKS/nonce/state/PKCE）；E-03 补 engines 下限提升与 node:sqlite 同步 API 张力论证；P-02 验收改为按 D4 决策分支；F-01/Q-02/X-03 验收量化。
- **偏差修正**：审计器版本检查范围（含 bin/constants）、agent-logs 文件权限未收紧、`YUNYU_ALLOW_INSECURE` 逃生门——已回写 01/02。

---

## 2. 企业级能力差距矩阵

| 能力域 | 企业级期望 | 现状（证据见 01 文档） | 差距 | 待办 |
| :--- | :--- | :--- | :--- | :--- |
| 身份与权限 | 人员账号、RBAC、SSO、最小权限 | 单全局 token，author 可冒充 | 🔴 大 | S-02, E-01, E-02 |
| 密钥治理 | 不落盘/加密/轮换/secret store | apiKey 与 GitLab token 明文 meta.json | 🔴 大 | S-01 |
| 数据可靠性 | 崩溃一致、可修复、备份 DR | 坏行静默丢、损坏蜂群跳过、无备份工具 | 🔴 大 | C-02, Q-01, P-03 |
| 并发正确性 | 多进程安全或明确单写者 | 双 Manager 无锁写同一 .yunyu | 🔴 大 | C-01 |
| 规模与性能 | 万级消息、索引查询、SLO | 全量重放×4、O(n)、同步 fs | 🟠 中 | E-03, P-01, Q-02 |
| 高可用/扩展 | 多节点或分片、故障隔离 | 单进程内存聚合 | 🟠 中（视 D1/D4） | P-02 |
| 项目管理深度 | 里程碑/迭代/报表/审批流/组合视图 | 研发流闭环强，PM 决策面弱 | 🟠 中 | E-04~E-07 |
| 平台集成 | GitHub/GitLab/Jira/飞书项目 | 仅 GitLab（抽象已具备） | 🟠 中 | X-01, X-04 |
| 合规审计 | 防篡改链、留存策略、导出 | 追加不可变✅，无 hash 链/导出/留存 | 🟡 小 | E-08 |
| 可观测性 | Prometheus/告警/追踪 | /api/metrics JSON✅，无标准格式/告警 | 🟡 小 | P-03 |
| 多租户 | 租户隔离/配额/计费（若 SaaS） | 无 | ⚪ 取决于 D1 | E-09 |
| 文档与 DX | 单一事实源、防漂移门禁 | 门面漂移、知识未回流 | 🟡 小但急 | D-01~D-06 |

---

## 3. 分阶段路线图

### Phase A · v0.6.0 「信任与正确性」（P0，先决条件）
> 主题：让「不可变审计」与「隔离」主张在磁盘与身份层面成立。不做完 A，企业能力都是沙上建塔。
- Q-01 并发/崩溃注入/万级消息基准测试套件（**先行**，为 C-01/C-02 提供测试床与基线数字）
- C-01 跨进程单写者治理（锁 / stdio MCP 改代理模式，二选一 ADR）
- C-02 崩溃恢复加固（seq 水位、坏行隔离区、损坏蜂群修复 CLI）
- S-01 密钥不落盘（env 引用化 + persistToken 默认 false + 迁移）
- S-02 发帖身份绑定认证 principal（禁冒充）
- C-05 Webhook 异步回调鉴权 + 关联令牌 + 出站 fetch 超时（P0，与 S-02 同批）
- S-03 移除/收敛 `?token=` 查询串鉴权（P1）
- C-04 SSE 可靠性：事件 id + Last-Event-ID 补拉 + 背压（P1）
- C-06 GitLab 镜像失败治理：错误 surfaced + 重试/死信 + 标签原子更新（P1）
- D-01~D-06 文档债清偿 + 一致性审计门禁 + 坑点回流知识库
- X-01 GitHub 适配器、X-02 自动译文 Hook + 流式输出（承接 HANDOFF v0.6.0 既定项）

### Phase B · v0.7–v0.8 「企业 PM 能力包」（P1）
- C-03 统一事件投影层（收敛 4 处重放；依赖 C-02 先稳定重放路径，基线取 Q-01 基准）
- E-01 人员账号 + RBAC（admin/pm/dev/qa/viewer）+ 审计归因
- E-02 OIDC SSO（零依赖 code flow + 完整安全验收）
- E-03 存储索引层（决策门 D2：node:sqlite 读索引 + JSONL 审计源 + checkpoint + engines 下限提升）
- E-04 里程碑/迭代/优先级/工时/自定义字段
- E-05 报表仪表盘（吞吐/周期时间/缺陷逃逸/成本趋势）+ 导出
- E-06 多级审批流（代理/超时升级/IM 联动）
- E-07 通知路由中心（订阅/免打扰/摘要）
- P-01 fs 异步化 + 分页索引；P-04 日志轮转 + meta 写放大治理；C-07 POSIX 进程树清理
- F-01 前端状态治理 + 虚拟滚动；Q-02 长稳压测门禁

### Phase C · v1.0 「规模与合规」（P2）
- P-02 扩展路径落地（决策门 D4：蜂群分片多进程 / 单写多读）
- P-03 备份/快照/DR CLI + Prometheus 文本格式 + RPO/RTO 目标
- E-08 审计 hash 链 + 合规导出 + 留存策略
- X-03 多仓库联邦世界模型（承接 HANDOFF 既定项）
- D-05 ADR 治理目录（docs/adr/）

### Phase D · v1.x 「生态与可选 SaaS」
- X-04 Jira/飞书项目/Teambition 适配评估；X-05 插件市场签名与版本锁定
- E-09 多租户（**仅当决策门 D1 选择 SaaS**）；F-02 白标/无障碍
- G-01 Genie-Teamwork 方案对比整合（**用户已决定跳过**：附件缺失，2026-11-22；对比框架见 02 文档 §4，文件补充后可重启）

---

## 4. 待办清单（人类可读版；机器版见 backlog.json）

> 优先级：P0=信任/正确性缺口，P1=企业核心能力，P2=规模/合规/生态。
> 所有权角色遵循 AGENTS.md 文件所有权表；QA/Verifier 只验收不实现。

| ID | 待办 | 优先级 | 阶段 | 建议所有权 | 验收标准（摘要） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| C-01 | 跨进程单写者治理（HTTP 与 stdio MCP 双实例） | P0 | A | core | 双进程并发测试（Q-01 测试床）无 meta 覆盖/事件交错；或 MCP 默认代理模式 + ADR |
| C-02 | 崩溃恢复加固：seq 水位校验、坏行隔离区、修复 CLI | P0 | A | core | kill -9 注入测试（Q-01 测试床）通过；坏行不再静默丢弃而是隔离+告警 |
| C-03 | 统一事件投影层（收敛 board/tasks/knowledge/wiki 4 处重放） | P1 | B | architect/core | 新增消费者无需自写重放；重启耗时较 Q-01 记录的基线下降 ≥50% |
| C-04 | SSE 可靠性：事件 id + Last-Event-ID 断线补拉 + 写背压 | P1 | A | backend/frontend | 断线重连零丢事件集成测试；慢消费者不拖垮广播 |
| C-05 | Webhook 异步回调鉴权 + 关联令牌 + 出站 fetch 超时 | P0 | A | drivers/backend | 无签名/无关联回调 401；挂起远端超时释放串行链（测试覆盖） |
| C-06 | GitLab 镜像失败治理：错误 surfaced + 重试/死信 + 标签原子更新 | P1 | A | gitlab | 镜像失败可见+可重放；并发标签更新不互相覆盖（测试） |
| C-07 | POSIX 进程树清理（孙进程泄漏） | P1 | B | drivers | POSIX 下 kill 后无残留孙进程（测试）；Windows 行为不回退 |
| S-01 | 密钥不落盘：driverConfig/GitLab token 引用化 + 存量迁移 | P0 | A | core/security | meta.json 扫描零明文密钥；审计器新增落盘密钥检查 |
| S-02 | author 绑定认证 principal，禁止冒充 | P0 | A | backend | 伪造 author 请求 403；审计事件含可信身份 |
| S-03 | 移除/收敛 `?token=` 查询串鉴权 | P1 | A | backend | 默认拒绝查询串 token（或仅限 SSE 且文档警示）；代理日志无 token |
| Q-01 | 并发/崩溃注入/万级消息基准测试套件 | P0 | A | qa | 套件入 npm test；基准数字记录入 docs/benchmarks |
| D-01 | ✅ 重写 docs/ARCHITECTURE.md 至 v0.5.1（以 01 基线为稿，2026-11-22 交付） | P0 | A | docs | 7 驱动/全层拓扑/4 角色隔离与代码一致 |
| D-02 | 文档一致性审计门禁 + 修复 README 徽章/30 工具/8 视图漂移（文档修复已完成 2026-11-22，审计门禁待实施） | P0 | A | docs/qa | audit 检查版本/工具数/视图数；漂移即扣分 |
| D-03 | ✅ PROTOCOL.md 补 /api/metrics；SECURITY.md 补 v0.5.1 条目（2026-11-22 交付） | P1 | A | docs | 与 routes.mjs/CHANGELOG 对齐 |
| D-04 | ✅ HANDOFF 15 坑点回流 KnowledgeVault → Wiki 决策页（2026-11-22 交付） | P1 | A | docs/core | 15 条入库，wiki/decisions-and-pitfalls.md 精选收录且非空 |
| D-05 | 建立 docs/adr/ 决策记录治理（含本评审 D1–D6 决策门） | P1 | C | architect | 每个架构决策有编号 ADR 与状态 |
| D-06 | ✅ HANDOFF 路线图收敛为指向 backlog.json 的引用（2026-11-22 交付） | P1 | A | docs | 不再散文式维护待办 |
| X-01 | GitHub Issues/PR 双向适配器（复用 SyncService 抽象） | P1 | A | gitlab/backend | GitHub Mock 集成测试绿；webhook 验签 |
| X-02 | 自动双语译文 Hook + OpenAI 驱动 SSE 流式输出 | P1 | A | drivers | 英文帖自动 zh-CN 注解；流式增量可回放 |
| E-01 | 人员账号 + RBAC + 审计归因 | P1 | B | backend/core | 5 角色权限矩阵测试；API 全路由鉴权覆盖 |
| E-02 | OIDC SSO 对接 | P1 | B | backend | code flow 登录/登出/会话过期 + id_token 签名验证/JWKS 轮换/nonce/state/PKCE 防重放测试 |
| E-03 | node:sqlite 读索引 + checkpoint 增量重放（JSONL 仍为审计源） | P1 | B | core | 万级消息查询 P95 < 50ms；索引可全量重建；engines 下限提升至免 flag 版本；同步 API 与 P-01 异步化张力有 ADR 论证 |
| E-04 | 里程碑/迭代/优先级/工时/自定义字段（够用就好：少量字段类型，不做组合 roadmap/资源调度） | P1 | B | core/frontend | Issue 模型扩展 + 看板视图 + 迁移兼容；范围裁定见 04 对标 §3 |
| E-05 | 报表仪表盘 + 导出（吞吐/周期/缺陷逃逸/成本）+ **agent token/成本按 Issue/成员归集**（差异化） | P1 | B | frontend/core | 4 类报表可从事件流纯函数推导；agent 成本归集报表为六家对标平台均无的独家维度 |
| E-06 | 人机混合审批流（agent human-gate/多级签核/超时升级/IM 卡片；不做通用 BPM） | P1 | B | core/channels | 审批链事件溯源；超时升级测试；通用审批表单明确不做 |
| E-07 | 通知路由中心（订阅/免打扰/摘要） | P1 | B | channels | 规则引擎测试；6 渠道复用 |
| P-01 | fs 异步化 + 读路径分页/索引 + 事件循环延迟监控 | P1 | B | core | 基准对比同步版；lag 指标入 /api/metrics |
| P-02 | 扩展路径落地（依 D4 分支验收） | P2 | C | architect/core | D4=垂直：扫描/重放 worker_threads 化 + lag SLO 达标；D4=分片：双节点集成测试 + SSE 跨节点广播 |
| P-03 | 备份/快照/DR CLI + Prometheus 文本格式 + RPO/RTO | P2 | C | backend/qa | 快照→恢复演练测试；/metrics 文本格式可被 Prometheus 抓取 |
| P-04 | agent-logs 磁盘轮转 + meta.json 写放大治理（含 logs 文件权限补齐） | P1 | B | core | 轮转上限可配且测试覆盖；meta 改为节流/增量写；logs 0o600 |
| F-01 | 前端状态分片 + 虚拟滚动 + 视图错误边界 | P1 | B | frontend | 万级消息滚动无 >200ms 长任务、交互响应 <100ms；CDP 注入单视图错误不拖垮整页 |
| Q-02 | 长稳压测门禁（内存增长/SSE 满连接/24h 演练） | P1 | B | qa | 24h 稳态 RSS 增长 <5% 断言入 CI；SSE 200 满连接无泄漏；报告入 docs/benchmarks |
| E-08 | 审计 hash 链 + 合规导出 + 留存策略 | P2 | C | core/security | 篡改任一历史事件可被校验发现 |
| X-03 | 多仓库联邦世界模型 | P2 | C | core | ≥2 仓接口契约图；跨仓爆炸半径列出下游模块与回归测试集（集成测试判定） |
| X-04 | Jira/飞书项目/Teambition 适配器评估与落地 | P2 | D | channels/backend | 评估 ADR + 至少 1 个适配器 MVP |
| X-05 | 插件市场治理：签名/版本锁定/依赖声明 | P2 | D | plugins | 未签名插件默认拒绝；版本锁定测试 |
| E-09 | 多租户隔离/配额/计费（仅 D1=SaaS 时启动） | P2 | D | architect | 租户隔离渗透测试 |
| F-02 | 白标主题 + 无障碍（WCAG AA） | P2 | D | frontend | 对比度/键盘导航 CDP 验收 |
| G-01 | Genie-Teamwork 方案对比整合（用户决定跳过；附件全 0 字节，文件补充后可重启） | P1 | D | architect/docs | 按 02 文档 §4 框架产出对比 + 吸收项入 backlog |

**依赖关系要点**：Q-01 **先行**提供竞态/崩溃/基准测试床与基线数字；C-01/C-02 依赖 Q-01；C-03 依赖 C-02+Q-01（先稳定重放路径再做投影重构，避免同路径双改冲突）；C-05 与 S-02 同批（回调身份同一模型）；S-02 → E-01 → E-02/E-06；C-03 → E-03/E-05；E-03 依赖决策门 D2；P-02 依赖 C-01+E-03+D4；D-02 依赖 D-01 完成后固化基线。

---

## 5. 决策门（需要人拍板，Agent 可提交论证）

| 门 | 问题 | 选项与倾向 | 影响 |
| :--- | :--- | :--- | :--- |
| D1 | 企业级定位 | A. 单节点企业内网平台（推荐先行，符合现行 HANDOFF 定位与零依赖优势）；B. 多租户 SaaS | 决定是否启动 E-09/P-02 全量 |
| D2 | node:sqlite 是否违反零依赖 | 倾向：属 Node 内置模块，不违反不变量 #1 字面与精神；需确认最低 Node 版本（22.5+ 实验期需 flag，22.13+/23.4+ 免 flag）并写入 AGENTS.md；**注意**：现 engines 为 >=22.0.0 需提升下限，且 node:sqlite 为同步 API，与 P-01 异步化目标的张力需 ADR 论证（worker_threads 隔离或接受索引读同步） | E-03 技术路线 |
| D3 | P0 顺序 | 倾向：Q-01 测试床先行 → C-01（数据安全）→ S-01（密钥）→ S-02/C-05（身份，同批）；C-02 并行 | Phase A 排期 |
| D4 | 扩展路径 | A. 垂直优先（异步化+索引+worker_threads 扫描）；B. 蜂群分片多进程 | P-02 设计 |
| D5 | PM 深度边界 | 倾向（04 对标已论证）：云驭做「AI-agent 原生协作 + 人机混合审批 + 效能/成本报表」；代码托管 CI 交 GitLab/GitHub，通用 BPM 与组合级资源管理不做；E-04/E-07 够用就好，E-05 叠加 agent 成本归集差异化 | E-04~E-07 范围 |
| D6 | Genie 方案取舍 | **已拍板（2026-11-22）**：用户决定附件缺失先跳过；文件补充后按 02 §4 框架评审 | G-01（deferred） |

---

## 6. 与现有规划的整合声明

- HANDOFF v0.6.0 四项既定路线：项 1→X-01、项 2 已交付（v0.5.1）、项 3→X-02、项 4→X-03，**全部保留并纳入本 backlog**，无推翻。
- 本 backlog 是 HANDOFF 散文路线图的**超集与结构化升级**（D-06 将 HANDOFF 收敛为引用）。
- 行业对标白皮书（BENCHMARK_AND_INTEGRATION.md）的对标方法论沿用；企业级差距矩阵（§2）是其 v0.6+ 续篇，**企业 PM 维度对标已由 [04-enterprise-pm-benchmark.md](04-enterprise-pm-benchmark.md) 完成**（含 D5 范围裁定与 agent 成本归集差异化论证），建议后续将 §2 与 04 回写白皮书形成 v0.6 对标章节。
- 所有待办默认遵守：零依赖、追加不可变、作者/审查隔离、Worktree 隔离、事件驱动零轮询、中文优先（AGENTS.md 六不变量）。
- **复核记录**：2026-11-22 独立评审 Agent 对抗复核（§1.9），10 项核心论断证实、3 处偏差修正、6 项新盲区入 backlog、5 处路线硬伤修复；门禁实测：新增 docs/review/ 后 `npm run verify` 完整门禁全绿（check + test 46/46 + qa:ui 双端 ALL PASSED + audit 100/100，exit 0）。