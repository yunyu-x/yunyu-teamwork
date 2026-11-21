# 开源多 Agent 管理标杆与 Qoder-CN Issue 模式深度对标与集成白皮书

> 本文档系统梳理 **Qoder-CN（Issue 驱动模式）** 以及全球领先的开源多 Agent 工程协同项目（**Vibe Kanban**、**Beads (`bd`)**、**Paperclip**、**Composio Agent Orchestrator**、**LangGraph / ResearchAI 多 Agent 调研整合架构**）的核心长处与工程实践，逐项识别 `yunyu-teamwork` 此前未考虑到的架构短板，并记录 `v0.3.0` 取长补短的落地集成方案。

---

## 1. 行业标杆横向对标矩阵

| 标杆项目 | 核心定位 | 值得吸收的核心长处 | 自身局限 / 补位点 |
| :--- | :--- | :--- | :--- |
| **Qoder-CN（Issue / Quest 模式）** | 阿里 AI 原生 IDE / 企业多 Agent 协同工作台 | 1. **6 态 Issue 生命周期**（`待规划` → `待开始` → `进行中` → `待验收` → `已完成` → `已取消`）；<br>2. **Spec-Driven 规划**：先冻结结构化 Spec 与验收标准 Checklist，确认后再派单开工；<br>3. 极简高效的看板操作：`全部 / 我的`、`搜索 Issue`、排序/筛选、每列行内 `+` 快速建单、`+ 邀请`、待验收阶段一键接受或打回返工。 | 偏封闭生态、强绑定专属 IDE，缺乏自托管企业内网 GitLab 深度联动与异构 CLI/个人 IM 分身接入。 |
| **Vibe Kanban** | 开源可视化多 Agent 并行编排看板 | 1. 每个任务自动挂载隔离 **Git Worktree**；<br>2. 「待验收」阶段提供**类 PR 在线着色 Unified Diff 审查**与直接打回反馈闭环。 | 缺少文件所有权契约（`CONTRACT.json`）硬守卫、缺少 QA/复核者禁改源码物理隔离与预算治理。 |
| **Beads (`bd` / Gas Town)** | Steve Yegge 开源的 Agent 原生分布式 Issue 图谱 | 1. **DAG 显式任务依赖图**（`dependsOn` / `parentId` + 环路检测）；<br>2. **`ready` 就绪队列**：只暴露所有前置依赖已完成且未被阻塞的任务，防止并行 Agent 抢跑；<br>3. **原子 TTL 认领锁（Claim Lease）**：防多 Agent 重复认领同一任务。 | 命令行导向、缺少面向人类 PM 与团队协作的可视化中文看板、双语译文层与 IM 通知闭环。 |
| **Paperclip** | 开源多 Agent 组织级控制面 | **预算与成本治理（Budget Governor）**：为蜂群与单个 Agent 配置 Token / 轮次 / 费用上限，软阈值预警（80%）、硬上限自动熔断（100%），解决长时/夜间任务失控烧额度短板。 | 偏宏观组织抽象，底层代码仓库 Git 隔离与文件所有权校验较薄弱。 |
| **Composio Agent Orchestrator (`ao`)** | 开源并行编码 Agent 编排器 | 自动化 PR/MR 反馈路由与 CI 失败自愈循环、异构 CLI/Worktree 统一监控。 | 缺少共享持久化知识库与个人数字分身跨 IM 审批机制。 |
| **Multi-Agent Research Assistants**（LangGraph / ResearchAI / Azure Doc Research） | 开源多源信息搜集与整合智能体流水线 | 专职 **Researcher / Synthesizer** 角色：关键词拆解 → 跨源检索（本地文档/代码 + 外部网页/API + 历史上下文）→ 去重与引用编号 `[1][2]` → 沉淀至结构化共享知识库，避免“无调研直接拍脑袋写代码”。 | 通常独立于软件工程看板存在，未与 Issue Spec、Worktree 开发及验收闭环打通。 |

---

## 2. 识别的 6 大短板与 `yunyu-teamwork v0.3.0` 补全落地

基于上述对标，`yunyu-teamwork v0.3.0` 在坚持**零外部运行时依赖（Node.js 22 内置模块）**与 6 条工程不变量的前提下，将上述长处完整融合：

### 2.1 Qoder-CN 式 Issue 驱动管理模式（`src/core/tasks.mjs` + `web/`）
- **6 态生命周期完整对齐**：`待规划 (backlog)` → `待开始 (ready)` → `进行中 (in_progress)` → `待验收 (review)` → `已完成 (done)` → `已取消 (cancelled)`，每个 Issue 自动分配递增编号 `ISS-1`、`ISS-2`...
- **Spec-Driven 闭环**：每个 Issue 内置 `spec`（Markdown 规格）、`specStatus`（`draft` / `approved`）与可勾选的 `acceptanceCriteria`（验收清单）。通过 `POST /api/swarms/:id/tasks/:taskId/approve-spec` 冻结 Spec 并自动推进至 `待开始`，通过 `/start` 校验依赖无阻塞后派发 `@assignee` 执行。
- **Qoder 交互体验**：顶部 `全部 / 我的` + 6 态快速筛选 + `搜索 Issue` + 排序 + `仅看就绪(Ready)` + `+ 邀请` + 每列行内 `+` 快速建单；点击任意卡片打开右侧 **Issue 详情滑出抽屉**。

### 2.2 Beads 风格 DAG 依赖图与 TTL 认领租约（`src/core/tasks.mjs` + `src/mcp/server.mjs`）
- 支持 `dependsOn` 与 `parentId`（子 Issue 树），写操作执行 **DFS 循环依赖检测**拦截死锁。
- 提供 `GET /api/swarms/:id/tasks/ready` 与 MCP 工具 `issue_ready`：仅返回前置依赖全部完成且未被阻塞的就绪任务。
- 提供原子 **TTL Claim Lease**（`/claim`、`/release` 及 MCP `issue_claim`）：防止多个并行 Agent 重复认领同一 Issue，租约超时自动释放。

### 2.3 Vibe Kanban 风格在线 Diff 审查与一键验收/打回闭环（`web/app.js` + `src/server/routes.mjs`）
- 在 Issue 详情抽屉内实时拉取负责人 Worktree 分支的真实 Unified Git Diff 并语法着色展示（`+` 绿 / `-` 红 / `@@` 区块头）。
- 提供一键 **「✓ 验收通过」**（支持勾选自动经 `OwnershipGuard` 合并分支并归档至 `已完成`）与 **「✕ 打回返工」**（附具体修改意见自动 `@assignee` 发缺陷单并切回 `进行中` + `blocked` 标记）。

### 2.4 Paperclip 风格预算与成本治理熔断器（`src/core/budget.mjs`）
- 支持配置蜂群级与成员级 `maxTokens`、`maxTurns`、`maxCostUsd`、`warnRatio`（默认 80%）。
- 接入 `SwarmInstance._triggerMemberTurn()` 前置门禁：消耗达到 80% 触发一次预警，达到 100% 自动熔断停止新轮次唤醒并播报中文治理告警；支持在「契约与工作树」视图实时监控进度条与动态扩容。

### 2.5 信息搜集与整合 Agent（`src/core/research.mjs` + `src/drivers/research-synthesizer.mjs`）
- 新增 **`researcher` 只读角色**（受 `OwnershipGuard` 源码禁改保护，仅可写 `docs/research/**`）与 **`research-synthesizer` 驱动**及一键预设 `info-synthesizer`、全链路团队模板 `research-to-delivery`。
- **零依赖多源采集引擎（`ResearchEngine`）**：
  - 本地仓库源码与文档全文扫描（带行号与相关度排序）；
  - HTTP/HTTPS 网页采集与 HTML 正文/标题/章节提取（原生 `fetch`，自动过滤 `<script>`/`<style>`，默认阻断 SSRF 内网地址）；
  - 蜂群留言板、关联 Issue 与既有知识库上下文汇聚；
  - 自动去重并生成带 `[1][2]` 引用编号的中文结构化调研简报，同时支持可选挂载 `openai-compatible` / `cli-agent` 做深度综合。

### 2.6 共享项目知识库 / 持久化记忆（`src/core/knowledge.mjs`）
- 追加持久化至 `events.jsonl`（`knowledge_add`），解决多 Agent 会话重置后的“失忆短板”。
- 支持按类别（`research` / `spec` / `adr` / `pitfall` / `benchmark`）、标签与关键词全文检索，在 Web UI 新增 **「情报知识库」** 视图并支持在任意 Issue 内一键发起调研并自动双向挂载。
