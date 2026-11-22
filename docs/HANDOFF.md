# 云驭协同（Yunyu Teamwork）项目开发交接文档（HANDOFF.md）

> 本文档面向**下一会话的 AI 编程智能体与核心开发者**，提供 `yunyu-teamwork` 的完整技术快照、架构契约、已踩坑记录、实测门禁状态以及 `v0.6.0` 演进路线图。

---

## 1. 项目基础信息快照

- **仓库地址**：`https://github.com/yunyu-x/yunyu-teamwork.git`（主干分支：`main`）
- **当前版本**：`v0.5.1`
- **运行环境要求**：Node.js `>= 22.0.0`、Git、Chromium/Chrome/Edge（仅 `npm run qa:ui` 需要）
- **核心设计原则**：**零外部 npm 运行时依赖**（纯 Node 22 ESM 内置模块 + 零构建原生 ES2022 模块化 Web UI），开箱适配企业内网、离线环境与自托管 GitLab。

---

## 2. 一键验收与本地运行命令

```bash
# 1. 全量一键验收（语法直检 + 单元/安全/集成测试 + 无头 Chrome 双端 UI 验收 + 全仓自动审计 100/100）
npm run verify

# 2. 启动离线全链路演练（真实 Git Worktree + 本地 GitLab v4 模拟 + 6 角色协同 + 世界模型 & Wiki）
npm run demo
# 访问 http://127.0.0.1:4310

# 3. 一次性冒烟测试（跑完自动释放资源退出，退出码 0）
node bin/yunyu.mjs demo --once --port 0

# 4. 全仓工程审计、导出活文档 Wiki 档案 & 跨端 Agent 插件/连接器管理
npm run audit
npm run wiki
npm run plugins
npm run connectors
node bin/yunyu.mjs plugin sync --harness claude-code --dry-run

# 5. 检查本机环境与异构 CLI Agent
node bin/yunyu.mjs doctor
```

---

## 3. 核心架构与源码导航

所有模块边界与 6 条硬不变量详见 [AGENTS.md](../AGENTS.md)、[docs/ARCHITECTURE.md](ARCHITECTURE.md) 与自动导出的活文档 [docs/wiki/README.md](wiki/README.md)。

| 目录 / 文件 | 核心职责 | 关键类 / 导出符号 |
| :--- | :--- | :--- |
| [src/core/world-model.mjs](../src/core/world-model.mjs) | 项目世界模型与变更爆炸半径预测 | `ProjectWorldModel`（ESM 拓扑图、高扇入核心枢纽、循环依赖检测、`simulateChangeImpact`、`getAgentBriefing`） |
| [src/core/wiki.mjs](../src/core/wiki.mjs) | 追加式版本化活文档项目 Wiki | `ProjectWiki`（`events.jsonl` 重放、自动生成多页活文档、修订历史、`exportToDir`） |
| [src/core/auditor.mjs](../src/core/auditor.mjs) | 全仓多视角工程与安全自动审计器 | `ProjectAuditor`（零依赖铁律、硬编码密钥、eval/模板表达式注入、Shell 拼接、循环依赖、版本一致性） |
| [src/core/board.mjs](../src/core/board.mjs) | 共享不可变留言板、频道与协作图谱 | `MessageBoard`, `parseMessageTokens`（`@member`, `@#channel`, `@all`, `#seq`, `annotateTranslation`, `buildGraph`） |
| [src/core/storage.mjs](../src/core/storage.mjs) | 追加式 JSONL 持久化与安全快照恢复 | `SwarmStorage`, `sanitizeId`（防路径穿越、容错截断 JSONL 尾行） |
| [src/core/ownership.mjs](../src/core/ownership.mjs) | 文件所有权契约与只读角色禁改守卫 | `OwnershipGuard`, `matchGlob`（强制 `verifier`/`reviewer`/`researcher`/`qa` 禁改 `src/**`, `web/**`，防 `..` 与大小写绕过） |
| [src/core/worktree.mjs](../src/core/worktree.mjs) | 真实 Git Worktree 生命周期与安全 Git 套件 | `WorktreeManager`（`rehydrate` 自动修复、`-uall` + `core.quotePath=false` 审计、受保护分支与防参数注入） |
| [src/core/tasks.mjs](../src/core/tasks.mjs) | Qoder 6 态 Issue 中心 + Beads DAG + TTL 认领锁 | `TaskTracker`（`ISS-N` 全方法解析、Spec/验收清单、环检测、`listReadyTasks`、`claimTask`/`acceptTask`/`rejectTask`） |
| [src/core/budget.mjs](../src/core/budget.mjs) | Paperclip 风格预算与成本治理熔断器 | `BudgetGovernor`（Token/轮次/费用上限、独立 80% 预警、100% 熔断） |
| [src/core/knowledge.mjs](../src/core/knowledge.mjs) | 追加式共享项目知识库 | `KnowledgeVault`（安全 `http/https` URL 过滤 + 全文检索） |
| [src/core/research.mjs](../src/core/research.mjs) | 零依赖多源情报采集与整合引擎 | `ResearchEngine`, `isPrivateIpOrHost`（IPv4/IPv6/DNS/重定向 SSRF 防护 + 流式字节上限） |
| [src/core/twins-store.mjs](../src/core/twins-store.mjs) | 个人数字分身模板库持久化 | `TwinsStore`（`.yunyu/twins.json` 跨蜂群一键挂载 + 凭据脱敏） |
| [src/core/orchestrator.mjs](../src/core/orchestrator.mjs) | 蜂群总控调度器与多蜂群管理器 | `SwarmInstance`, `TeamworkManager`（重启恢复、世界模型/Wiki/审计/插件生命周期接入、响应密钥脱敏） |
| [src/plugins/](../src/plugins/index.mjs) | Agent 插件、TeamAI 跨端连接器、MCP Client、渐进式技能与 Hook 引擎 | `PluginHub`, `PluginRegistry`, `SkillsRuntime`, `HookEngine`, `McpClientManager`, `ConnectorHub`, `parseYamlLite` |
| [plugins/](../plugins/yunyu-engineering-pack/plugin.json) | 内置官方插件包（Agent Plugin 标准 & TeamAI 规范） | `yunyu-engineering-pack`（TDD/安全技能与命令/密钥拦截 Hooks）、`teamai-sync-pack`（TeamAI 跨端同步与 Wiki 维护官） |
| [src/channels/](../src/channels/index.mjs) | 零依赖 6 渠道 IM / 机器人双向通信网桥 | `CHANNEL_ADAPTERS`（飞书/企微/钉钉/Telegram/Slack/通用 Webhook 验签防重放）、`ChannelBridge` |
| [src/drivers/](../src/drivers/registry.mjs) | 7 大异构 Agent 驱动层 | `OpenAICompatibleDriver`, `CliAgentDriver`, `ResearchSynthesizerDriver`, `DigitalTwinDriver`, `WebhookAgentDriver`, `HumanAgentDriver`, `SimulatedAgentDriver` |
| [src/gitlab/](../src/gitlab/index.mjs) | GitLab REST API v4、Webhook 路由、双向同步与模拟服务 | `GitLabClient`, `verifyGitLabWebhookToken`, `translateGitLabWebhook`, `GitLabSyncService`, `GitLabMockServer` |
| [src/mcp/server.mjs](../src/mcp/server.mjs) | 标准 MCP JSON-RPC 2.0 服务端 | `YunyuMcpServer`, `MCP_TOOLS`（37 工具 + 3 类资源，stdio 与 HTTP `/api/mcp` 双传输） |
| [src/server/](../src/server/app.mjs) | 零依赖 HTTP REST（含 `plugin-routes.mjs`）+ SSE + 安全静态服务 | `YunyuServer`, `handleApiRoute`, `handlePluginApiRoute`, `SseHub` |
| [web/](../web/index.html) | 原生暗黑双语 9 视图模块化 Web 看板 | `app.js`, `world-wiki.js`, `graph.js`, `i18n.js`, `lib/state.js`, `views/{board,kanban,knowledge,members,gitlab,contract,plugins}.js`, `styles/plugins.css` |

---

## 4. 已踩坑与关键防护记录（后续改动严禁回退！）

以下 15 个真实工程与安全坑点均已有自动化回归测试或实战演练覆盖。**流程约定（D-04）**：新增坑点必须同步以 `category: pitfall` 写入 KnowledgeVault（`knowledge_save` MCP 工具或 `POST /api/swarms/:id/knowledge`），`npm run wiki` 会自动收录至 [wiki/decisions-and-pitfalls.md](wiki/decisions-and-pitfalls.md)（精选展示最新 12 条，全量可检索）；本节 15 条已于 2026-11-22 回流至 `.yunyu/swarms/project-knowledge/events.jsonl`。

1. **Windows `git status --porcelain` 首空格截断与中文八进制转义**（`src/core/worktree.mjs`）：必须传递 `-c core.quotePath=false status --porcelain -uall` 且 `trimLeading: false`。
2. **Windows 8.3 短路径与 `worktreeRoot` 边界校验**（`src/core/worktree.mjs`）：`git worktree list` 可能输出 `ADMINI~1`，必须通过 `fs.realpathSync.native` 规范化后再验证子目录边界。
3. **Node 22 `fetch`（undici）WHATWG 禁用端口随机碰撞**（`src/server/app.mjs`、`src/gitlab/mock-server.mjs`）：保留 `WHATWG_BAD_PORTS` 重试循环。
4. **系统报错自触发无限唤醒环**（`src/core/orchestrator.mjs`）：系统/熔断告警严禁使用 `@member` 语法，必须携带 `metadata.noWake: true`。
5. **`StallMonitor` 对自身告警重复触发**（`src/core/monitor.mjs`）：发帖后立即更新 `this.lastAlertSeq = alertMsg.seq`。
6. **Node 22 HTTP Keep-Alive 阻塞进程退出**（`src/server/app.mjs`）：关闭服务时始终调用 `srv.closeAllConnections?.()`。
7. **浏览器 HTTP/1.1 6 连接池与 SSE 表单覆写**（`web/app.js`）：保持单飞合并刷新、`requestSeq` 防陈旧响应、作用域 SSE `/api/events?swarmId=...` 与编辑态保护。
8. **内联 Markdown 代码块与 `**` 通配符冲突**（`web/lib/state.js`, `web/world-wiki.js`）：必须先对 `` `...` `` 占位编码，再执行 `**bold**` 替换。
9. **JS 静态词法解析正则与模板表达式边界**（`src/core/world-model.mjs`, `src/core/auditor.mjs`）：必须上下文识别 `/regex/` 字面量，且安全审计必须保留 `${...}` 模板表达式扫描。
10. **外部 MCP `capabilities` 按需枚举防 12s 超时**（`src/plugins/mcp-client.mjs`）：部分极简 MCP Server 仅声明 `capabilities: { tools: {} }` 且不响应 `resources/list`，连接时必须先检查 `caps.resources` 再发请求，同时监听进程 `exitCode !== null` 快速失败。
11. **插件零信任自声明隔离与符号链接防护**（`src/plugins/registry.mjs`, `src/server/plugin-routes.mjs`）：工作区自动扫描或 HTTP 安装的插件必须忽略 `manifest.trusted`（强制默认 `trusted: false`），HTTP `/toggle` 授予信任必须受 `allowCustomCli` 门禁保护，且 `loadPluginDirectory` 必须通过 `lstatSync` + `realpathSync` 拒绝任何符号链接逃逸。
12. **跨端连接器非破坏性 JSON 深度合并**（`src/plugins/connectors.mjs`）：向 `.mcp.json`、`.gemini/settings.json`、`opencode.json` 同步 MCP 配置时必须先读取既有 JSON 并仅合并 `mcpServers`/`mcp` 键，严禁覆写用户的 `theme`/`model`/`provider` 等既有配置。
13. **Windows Git Bash `curl` 中文请求体 GBK 乱码**（IPC 实战演练 seq 9）：向留言板 POST 中文 JSON 必须使用 `node fetch`（UTF-8）而非 shell `curl`；追加式留言板会永久保留乱码历史，纠错只能追加新帖澄清，严禁篡改旧帖。
14. **review 态 Issue 依赖不自动解锁**（`src/core/tasks.mjs`）：上游 Issue 进入 `review` 态后依赖它的下游仍被 409 阻塞，必须由协调者 `accept`（→`done`）后下游才可认领；派单契约中应显式声明「验收解锁」步骤。
15. **`kind=defect` 消息自动派生缺陷单**（`src/core/tasks.mjs` `onBoardMessage`）：普通讨论消息误标 `kind: 'defect'` 会自动创建缺陷 Issue；发帖时仅在真实缺陷场景使用该 kind，误派生单需走 `cancelled` 清理。

---

## 5. 生产部署指引（v0.5.1 安全加固）

v0.5.1 针对商用评估发现的 P0/P1/P2 缺口完成加固，全部保持零外部运行时依赖：

- **API 限流**（`src/server/rate-limit.mjs`）：按来源 IP 固定窗口限流，默认 1200 次/分钟，超限返回 `429 + Retry-After`；`/api/health` 豁免（供探针）。环境变量 `YUNYU_RATE_LIMIT_RPM`（0 = 关闭）与 `YUNYU_RATE_LIMIT_WINDOW_MS` 可调。
- **非回环绑定强制鉴权**：监听 `0.0.0.0` 等非回环地址时必须设置 `YUNYU_API_TOKEN`（Bearer），否则启动即拒绝；仅限可信内网演练可用 `YUNYU_ALLOW_INSECURE=true` 显式豁免。
- **监控指标端点**：`GET /api/metrics` 返回请求总量、限流计数、蜂群数、SSE 连接数与 RSS 内存，供 Prometheus 文本适配或巡检脚本消费。
- **看门狗人工门禁降噪**（`src/core/monitor.mjs`）：`waiting_human` 提醒按 30s→60→120→240→480s 指数退避（16 倍封顶），门禁解除即复位。
- **容器化交付**：`Dockerfile`（node:22-alpine、非 root、HEALTHCHECK）+ `docker-compose.yml`（强制 Token、回环端口映射、数据卷）。

```bash
# 容器化单机部署（内网自托管）
export YUNYU_API_TOKEN=$(openssl rand -hex 32)
docker compose up -d --build
curl -s http://127.0.0.1:4310/api/health
curl -s -H "Authorization: Bearer $YUNYU_API_TOKEN" http://127.0.0.1:4310/api/metrics
```

生产注意：TLS 由前置反向代理（Nginx/Caddy）终结；定期备份 `.yunyu/` 数据卷（全部 JSONL 追加式审计资产）；本系统定位为**内网单节点团队协作**，非多租户 SaaS。

---

## 6. 下一阶段演进路线图（唯一事实源：backlog.json）

> 📋 **本节不再手工维护待办状态**（待办 D-06 已收敛）。全部演进规划以 [docs/review/backlog.json](review/backlog.json) 为**唯一结构化事实源**：39 项待办，含 ID / 优先级 / 证据 / 验收标准 / 依赖 / 所有权角色，可直接派生 Qoder Issue 供 Agent 认领；状态变更只更新 backlog.json 与 [03 路线图](review/03-enterprise-roadmap.md) 表格。

- **讨论入口**：[docs/review/README.md](review/README.md)（架构基线 01 · 文档对比 02 · 多视角批判与四阶段路线图 03 · 企业 PM 对标 04）。
- **历史 v0.6.0 散文路线图映射**（仅供追溯）：GitHub 双向联动 → `X-01`；自动双语译文 Hook 与 LLM 流式推送 → `X-02`；多仓库联邦世界模型 → `X-03`；容器化与一键自托管部署 → ✅ 已于 v0.5.1 交付（见 §5）。
- **实施前提**：P0 信任缺口优先（阶段 A），战略方向待决策门 D1–D5 拍板（见 03 §5）；D6/G-01（Genie 附件对比）经用户决定跳过，文件补充后可重启。
