# 更新日志（Changelog）

本文件记录 **云驭协同（Yunyu Teamwork）** 的所有重要版本演进与工程交付。

---

## [0.5.0] - 2026-11-22

### Agent 插件生态 + TeamAI 跨端连接器同步 + 外部 MCP 客户端 + 渐进式技能/规则 + 生命周期 Hook 治理台
- **双规范插件注册中心（`src/plugins/registry.mjs`, `src/plugins/parser.mjs`）**：
  - 零外部依赖原生支持 **Agent Plugin Open Standard（`plugin.json`）** 与腾讯开源 **`Tencent/teamai-cli` Git 资产仓库规范（`teamai.yaml` / `mcp/mcp.yaml` / `hooks/hooks.yaml`）**，提供内置 YAML 子集与 Markdown Frontmatter 解析器（支持多行块标量 `|`/`|-`/`>`、紧凑列表与原型链污染防护）。
  - 内置两大官方插件包：`plugins/yunyu-engineering-pack`（TDD 与安全审查技能、零依赖中文规则、`/preflight` 命令、破坏性命令与密钥写入拦截 Hooks、`@sec-auditor` 专职 Agent）与 `plugins/teamai-sync-pack`（TeamAI 跨端同步规程、`SessionStart`/`PreCommit` Hooks、本地 MCP 自检连接器、`@wiki-curator` 专职 Agent）。
  - 支持本地目录、远端 Git 仓库（`git clone`/`git pull` 硬化防护）与 Web/API 在线内联创建插件，持久化启停与授信状态至 `.yunyu/plugins-state.json`。
- **8 大异构 Agent 连接器雷达与 TeamAI 非破坏性跨端同步（`src/plugins/connectors.mjs`）**：
  - 自动探测 **Claude Code CLI、OpenAI Codex CLI、Gemini CLI、Cursor IDE、OpenCode CLI、Antigravity (AGY)、CodeBuddy / TeamAI、标准 MCP/Webhook/ACP 网关** 8 类连接器的 CLI 版本与项目配置状态。
  - 支持 `Dry-Run` 预览与一键将启用中的 Skills、Rules、Commands、Hooks、MCP Servers **非破坏性深度合并**至 `.claude/`、`.mcp.json`、`.codex/`、`.cursor/rules/*.mdc`、`.gemini/settings.json`、`opencode.json`、`.agent/`、`.codebuddy/`，自动剥离未授信命令与敏感环境变量。
- **渐进式披露技能、工程规则与斜杠命令运行时（`src/plugins/skills-runtime.mjs`）**：
  - 按任务文本、触发词、标签、角色与文件通配符动态打分匹配高相关 `SKILL.md` 与 `rules/*.md`，注入 `OpenAICompatibleDriver` 与 `CliAgentDriver` 提示词上下文，并提供 `skill_list` / `skill_match` / `skill_read` 工具供 Agent 按需深读；支持在留言板直接输入 `/preflight`、`/sync-team` 等插件斜杠命令自动展开。
- **10 大生命周期 Hook 治理引擎与追加式审计日志（`src/plugins/hooks.mjs`）**：
  - 覆盖 `SessionStart`、`PreTurn`、`PostTurn`、`PreToolUse`、`PostToolUse`、`OnMessage`、`PreCommit`、`PreMerge`、`OnIssueTransition`、`OnAudit` 10 类事件，支持零 Shell 确定性 `policy`/`builtin` 策略（含 ReDoS 静态防护）与双重门禁受控 `command` 脚本，所有触发历史追加持久化至 `.yunyu/hooks-audit.jsonl`。
- **外部 MCP 客户端管理器与动态工具桥接（`src/plugins/mcp-client.mjs`）**：
  - 支持连接外部 `http` 与受信任 `stdio` MCP Server（JSON-RPC 2.0 `initialize` / `tools/list` / `resources/list` / `tools/call`），具备单服务故障隔离、并发连接合并、SSRF/DNS/重定向拦截与环境变量脱敏；已连接外部 MCP 工具自动以 `mcp__<serverId>__<toolName>` 桥接至大模型工具集（只读角色强制隔离）。
- **Web UI 第 9 视图「插件与生态」、MCP 37 工具与 CLI 扩展（`web/views/plugins.js`, `src/server/plugin-routes.mjs`, `src/mcp/server.mjs`, `bin/yunyu.mjs`）**：
  - 新增第 9 视图「插件与生态（Plugins & Connectors）」，集成连接器雷达与 Dry-Run 同步器、插件包启停/授信/在线创建器、外部 MCP 连接面板、渐进式技能匹配测试器与 `SKILL.md` 阅读器、插件专职 Agent 一键招募入群、以及生命周期 Hook 实时演练器与审计流。
  - 标准 MCP Server 扩展至 **37 个工具 + 3 类资源**（新增 `plugin_list`、`skill_match`、`skill_read`、`hook_test`、`connector_probe`、`mcp_connector_list`、`mcp_connector_call` 与 `yunyu://plugins/catalog`）；CLI 新增 `yunyu plugin <list|install|enable|disable|trust|untrust|sync>` 与 `yunyu connectors`。
- **3 路独立审计 Agent 深度安全与架构加固**：
  - 修复 HTTP `/toggle` 授信提权、工作区插件自声明 `trusted` 绕过、插件目录符号链接穿越、HTTP MCP 默认私网/元数据 SSRF、MCP `swarm_add` 自定义 CLI 绕过、跨端同步覆盖既有 JSON 配置、同缩进 YAML 列表与块标量 `#` 标题解析、角色大小写与只读角色外部 MCP 隔离、`OpenAICompatibleDriver` 双重 `PreToolUse` 触发等全部审计发现，全仓自动审计保持 **100/100（P0=0 / P1=0 / P2=0）**。

---

## [0.4.0] - 2026-11-21

### 项目世界模型（World Model）+ 活文档 Wiki 档案 + 全仓自动审计 + 全面安全加固与前端模块化
- **项目世界模型（`src/core/world-model.mjs`）**：
  - 零外部依赖构建代码仓库实时结构与运行态心智模型：上下文感知 JS/ESM 词法扫描提取模块导出、相对依赖图、高扇入核心枢纽（Hubs）、所有权角色映射、DFS 循环依赖检测与仓库健康度评分（`0-100`）。
  - **变更爆炸半径模拟器（`simulateChangeImpact`）**：修改源码前基于反向依赖图 BFS 预测直接/传递上游模块、关联回归测试、需联动责任人及核心工程不变量警告；支持自动向 LLM 驱动注入成员专属世界模型上下文简报（`getAgentBriefing`）。
- **项目活文档 Wiki 档案（`src/core/wiki.mjs`）**：
  - 基于 `events.jsonl` 实现追加式不可变版本追踪（`wiki_upsert`），支持跨重启无损重放、全文与分类检索、保留词/Windows 设备名防护及 Markdown 目录导出（`exportToDir`，自动生成 `README.md` 索引）。
  - 一键从世界模型、共享知识库与审计报告自动合成多页活文档（项目总览、架构拓扑 Mermaid 图、模块导出清单、工程门禁、决策避坑档案及各模块域深潜页），内容未变更时保持版本幂等（`skipIfUnchanged`）。
- **全仓多视角自动审计引擎与 CLI（`src/core/auditor.mjs`, `bin/yunyu.mjs`）**：
  - 自动检测零外部运行时依赖铁律、硬编码敏感密钥（GitHub/GitLab/OpenAI/AWS/PEM）、危险动态执行（含模板字面量 `${eval(...)}`）、不安全 Shell 拼接、循环依赖、所有权冲突、超大文件与全仓版本号一致性；支持 `createIssues: true` 一键将 P0/P1 发现转为 Qoder Issue。
  - 新增 CLI 子命令 `yunyu audit [--dir <path>] [--json]` 与 `yunyu wiki [--dir <path>] [--out docs/wiki]`，并纳入 `npm run verify` 与 GitHub Actions 跨平台（Linux/Windows/macOS）CI 门禁。
- **Web UI 第 8 视图「世界模型 & Wiki」与前端模块化拆分（`web/world-wiki.js`, `web/lib/`, `web/views/`）**：
  - 新增交互式模块域 SVG 依赖拓扑图、点击式爆炸半径模拟器、一键全仓审计面板与分栏式 Wiki 活文档浏览器/在线修订编辑器。
  - 将原 2175 行 `web/app.js` 拆分为 `web/lib/state.js` + `web/views/{board,kanban,knowledge,members,gitlab,contract}.js` + `web/world-wiki.js` + 精简壳层 `web/app.js`，全仓审计得分达到 **100/100（P0=0 / P1=0 / P2=0）**。
- **多 Agent 联合深度安全与架构审计修复**：
  - 安全加固：收敛 CORS 仅允许本机回环/显式白名单、新增可选 `YUNYU_API_TOKEN` Bearer 鉴权、阻断 `sanitizeId("..")` 路径逃逸、修复 `OwnershipGuard` `..` 折叠/大小写/`role==='qa'` 与符号链接逃逸、加固 `CliAgentDriver` Windows 进程树清理与 `EPIPE` 防护、限制只读角色 `run_command`/白名单化 `run_verification`、加固 `ResearchEngine` IPv6 `[::1]`/DNS/重定向 SSRF 与流式字节上限、修复 `KnowledgeVault` `javascript:` 存储型 XSS、强化钉钉/Slack 验签防重放与 IM 渠道类型隔离、限制 `tokenEnv` 白名单及全路径响应密钥脱敏。
  - 架构修复：`TaskTracker` 全量支持 `ISS-N` 键操作、`BudgetGovernor` 补齐独立费用 80% 预警、`WorktreeManager` 使用 `-c core.quotePath=false -uall` 审计未追踪子目录与中文路径并在合并前防丢未提交改动、前端支持作用域 SSE 与防表单覆写保护。

---

## [0.3.0] - 2026-11-21

### Qoder-CN Issue 驱动模式 + 信息搜集与整合 Agent + 开源多 Agent 治理补短板
- **Qoder-CN 风格 Issue 管理中心（`src/core/tasks.mjs`, `web/`）**：
  - 升级为 6 态 Issue 生命周期：**待规划（`backlog`）→ 待开始（`ready`）→ 进行中（`in_progress`）→ 待验收（`review`）→ 已完成（`done`）→ 已取消（`cancelled`）**，自动分配递增编号 `ISS-1`、`ISS-2`...（向下兼容旧状态别名）。
  - 新增 **Spec-Driven 规划与验收闭环**：每个 Issue 支持 Markdown Spec 规格、冻结状态（`draft` / `approved`）、可勾选验收清单（`acceptanceCriteria`）、一键批准 Spec、启动执行、**验收通过** 与 **打回返工（附意见自动 `@assignee`）**。
  - Web UI 升级为 Qoder 风格顶部控制条（`全部 / 我的`、6 态快速筛选、实时 `搜索 Issue`、排序、`仅看就绪(Ready)`、`+ 邀请`、每列行内 `+` 快速建单）及右侧 **Issue 详情滑出抽屉**。
- **Beads 风格 DAG 依赖图与 TTL 认领租约（`src/core/tasks.mjs`, `src/mcp/server.mjs`）**：
  - 支持 `dependsOn` / `parentId` 子 Issue 关系与 DFS 循环依赖检测；新增 `GET /api/swarms/:id/tasks/ready` 与 MCP `issue_ready` 就绪队列；新增原子 TTL Claim Lease（`/claim`、`/release`、`issue_claim`）防多 Agent 重复认领。
- **Vibe Kanban 风格在线 Git Diff 审查（`web/app.js`, `web/styles.css`）**：
  - 在 Issue 详情抽屉内嵌语法着色 Unified Diff 预览器，直接对照验收清单审查分支代码差异并执行验收通过或打回返工。
- **Paperclip 风格预算与成本治理（`src/core/budget.mjs`, `src/core/orchestrator.mjs`）**：
  - 支持配置蜂群级与成员级 `maxTokens` / `maxTurns` / `maxCostUsd` 与 80% 预警、100% 自动熔断；新增 `GET/PUT /api/swarms/:id/budget`、MCP `budget_status` 与 UI 实时预算进度条。
- **信息搜集与整合 Agent + 共享知识库（`src/core/research.mjs`, `src/core/knowledge.mjs`, `src/drivers/research-synthesizer.mjs`）**：
  - 新增 `researcher` 只读角色（受 `OwnershipGuard` 源码禁改保护）、`research-synthesizer` 驱动、一键预设 `info-synthesizer` 与全链路模板 `research-to-delivery`。
  - 零依赖跨源采集仓库源码/文档 + HTTP 网页 HTML 正文提取 + 蜂群历史上下文，去重整合出带 `[1][2]` 引用编号的中文调研简报并持久化至追加式 **共享知识库（`KnowledgeVault`）**；Web UI 新增「情报知识库」视图支持一键发起调研与全文检索。
- **行业标杆对标白皮书**：新增 [docs/BENCHMARK_AND_INTEGRATION.md](docs/BENCHMARK_AND_INTEGRATION.md)。

---

## [0.2.0] - 2026-11-21

### 核心生产能力与生态扩展（Production Recovery, Streaming CLI, Kanban, Git Agents & Digital Twins）
- **重启持久化自动恢复（`src/core/worktree.mjs`, `src/core/orchestrator.mjs`）**：
  - `SwarmInstance._saveMeta()` 完整持久化 `worktreeRoot`、`worktrees` 映射、可序列化 `driverConfig`、`sessionId` 与 GitLab 连接元数据（默认仅记录 `tokenEnv` 不落盘明文 Token，显式 `persistToken: true` 时可选本地保存）。
  - `WorktreeManager.rehydrate()` 启动时扫描 `git worktree list --porcelain` 自动重建内存映射；当 `share` 目录被外部清理但 Git 分支仍存时支持自动修复挂接（`autoRepair`）。
  - `SwarmInstance.rehydrate()` 自动重建 `GitLabClient` 与 `GitLabSyncService` 双向同步连接，并新增 `POST /api/swarms/:id/gitlab/reconnect` 动态重连接口。
- **CLI Agent 实时日志流与会话上下文复用（`src/drivers/cli-agent.mjs`, `src/core/storage.mjs`）**：
  - 升级 `claude-code`（`-p --output-format stream-json --verbose` + `--resume <sessionId>`）与 `codex-cli`（`exec --json -` + `exec resume --json <thread_id> -`，默认通过 stdin 传参规避 Windows 转义限制，验证/复核角色自动启用 `--sandbox read-only`）。
  - 逐行解析 JSONL 流并通过 SSE `agent_log` 实时推送至 Web 终端日志面板，独立归档至 `agent-logs.jsonl`；会话失效自动降级新会话单次重试；新增 `GET /api/swarms/:id/logs` 与 `POST /api/swarms/:id/members/:name/session/reset`。
  - 新增本机真实 Claude Code + Codex CLI 协同脚本 `examples/cli-agent-collab.mjs`（`npm run demo:cli`）。
- **Web UI 任务与交付物看板（Kanban）及 GitLab 评论闭环（`src/core/tasks.mjs`, `web/`）**：
  - 新增追加式持久化 `TaskTracker`（`backlog` / `in_progress` / `review` / `qa` / `blocked` / `done` 6 列），与留言板 `#seq` 交付凭证、Commit SHA 及 GitLab Issue/MR 自动联动。
  - 新增 Web UI 第 6 视图「任务看板（Kanban）」，以及 GitLab 面板 Issue 评论区实时预览与直接回复（支持一键同步镜像至蜂群留言板）。
  - 优化前端单飞合并刷新队列与 `WorktreeManager.listWorkspaces()` 同目录缓存，规避浏览器 HTTP/1.1 6 并发连接阻塞。
- **Git 研发工作流 Agents 套件 + 个人数字分身与多渠道 IM/Bot 通信网桥（`src/channels/`, `src/core/twins-store.mjs`, `src/drivers/digital-twin.mjs`）**：
  - 新增角色 `reviewer`（纳入只读源码禁改硬不变量）、`committer` 与 `digital_twin`；扩展受控 Git 工具套件（`git_status` / `git_diff` / `git_log` / `git_push` 受保护分支拦截与禁强推 / `git_review_branch` / `run_verification`）及 `git-dev-lifecycle` 模板与 `AGENT_PRESETS` 一键预设库。
  - 新增零依赖 6 渠道 IM / 机器人通信适配层（**飞书/Lark、企业微信、钉钉、Telegram、Slack/Discord、通用 HMAC-SHA256 Webhook**）与双向 `ChannelBridge`。
  - 新增 `DigitalTwinDriver`（支持 `hybrid` 混合审批托管、`auto_reply` 与 `relay_human`）及 `.yunyu/twins.json` 个人数字分身档案库（跨蜂群一键挂载），并在 Web UI 提供分身配置、入站回调地址预览与 IM 测试推送能力。

---

## [0.1.0] - 2026-11-21

### 首发核心能力（Initial Open-Source Release）
- **蜂群核心引擎（`src/core/`）**：
  - 实现追加式 JSONL 持久化共享留言板（`MessageBoard` & `SwarmStorage`），支持单调递增 `#seq`、频道隔离、 `@member` / `@#channel` / `@all` 事件驱动零轮询唤醒、`#seq` 交叉引用以及**非破坏性双语显示注解层**（不篡改原始不可变审计日志）。
  - 实现文件所有权契约守卫（`OwnershipGuard`），支持 `CONTRACT.json` 通配路径校验、并发作者重叠冲突预警以及 **QA / Verifier 严禁写入 `src/` 与 `web/`** 的硬不变量拦截。
  - 实现真实 **Git Worktree 隔离管理器（`WorktreeManager`）**，支持 `share`（独立 `git worktree` 分支）、`branch`（独立克隆）与 `inherit`（共享主目录），并在提交、合并与销毁阶段提供越权审计与未合并保护。
  - 实现 **防停滞看门狗（`StallMonitor`）**，自动检测全员静默并精准唤醒阻塞责任人，收到 `[done]` 后静默停机。
- **异构 Agent 驱动层（`src/drivers/`）与 MCP 服务端（`src/mcp/`）**：
  - 原生提供 5 类即插即用驱动：`openai-compatible`（OpenAI / DeepSeek / 通义千问 / OpenRouter / Ollama）、`cli-agent`（Claude Code / Codex CLI / Gemini CLI / 自定义脚本）、`webhook`（HMAC-SHA256 签名，适配 Dify / LangGraph / n8n）、`human`（人类门禁接入）与 `simulated`（离线演练与自动化测试）。
  - 提供标准 **MCP JSON-RPC 2.0 服务端**（`bin/yunyu-mcp.mjs` stdio 与 `/api/mcp` HTTP 双传输）。
- **GitLab 仓库与研发管理扩展（`src/gitlab/`）**：
  - 零依赖 GitLab REST API v4 客户端（Issues / Merge Requests / Notes / Labels / Pipelines / Branches）。
  - 常量时间验签的 GitLab Webhook 路由器（`X-Gitlab-Token`），支持 Issue / MR / Note / Pipeline 事件自动转化为中文看板卡片并精准 `@mention` 路由。
  - 双向状态同步器（`GitLabSyncService`）与内置本地 GitLab API v4 模拟服务器（`GitLabMockServer`）。
- **原生全中文暗黑协同看板（`web/`）**：
  - 集成 5 大实时视图：**看板（Board）**、**协作图谱与时间轴回放（Graph）**、**成员名册（Members）**、**GitLab 项目管理（GitLab）**、**契约与工作树（Contract & Worktrees）**，支持 SSE 实时推送、一键中英切换（`中文 / EN`）与行内中文译文/原文对比切换。
- **全自动化质量门禁（`tests/`）**：
  - 零外部依赖单元测试、真实 Git Worktree 测试、GitLab 端到端闭环测试、MCP 协议测试、HTTP/SSE 测试及无头 Chrome CDP 桌面/移动端视觉布局验收。
