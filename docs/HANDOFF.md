# 云驭协同（Yunyu Teamwork）项目开发交接文档（HANDOFF.md）

> 本文档面向**下一会话的 AI 编程智能体与核心开发者**，提供 `yunyu-teamwork` 的完整技术快照、架构契约、已踩坑记录、实测门禁状态以及可直接启动的下一阶段演进路线图。

---

## 1. 项目基础信息快照

- **项目路径**：`d:/workspace/codex/yunyu-teamwork`
- **当前版本**：`v0.1.0`（分支：`main`，尚未配置远端仓库与 `git push`）
- **运行环境要求**：Node.js `>= 22.0.0`（本机实测 `v22.16.0`）、Git（本机实测 `2.47.0.windows.2`）、Chromium/Chrome/Edge（仅 `npm run qa:ui` 需要）
- **核心设计原则**：**零外部 npm 运行时依赖**（全纯 Node 22 ESM 内置模块 + 原生 ES2022 Web UI），开箱适配企业内网与自托管 GitLab 环境。
- **本机已探测可用外部 CLI Agent**（`node bin/yunyu.mjs doctor` 实测）：
  - `claude`：`2.1.214 (Claude Code)`（已安装）
  - `codex`：`codex-cli 0.144.6`（已安装）
  - `gemini`：未安装

---

## 2. 一键验收与本地运行命令

新会话接手开发前，先跑一次门禁确认基线全绿：

```bash
cd d:\workspace\codex\yunyu-teamwork

# 1. 全量一键验收（43 文件语法检查 + 13 项单元/集成测试 + 无头 Chrome CDP 双端 UI 验收）
npm run verify

# 2. 启动离线全链路演练（内置 GitLab v4 模拟 + 真实 Git Worktree + 6 角色协同交付）
npm run demo
# 访问 http://127.0.0.1:4310

# 3. 一次性冒烟测试（跑完自动释放资源退出，退出码 0）
node bin/yunyu.mjs demo --once --port 0

# 4. 启动生产服务（接入真实 GitLab 仓库前请先配置 .env）
npm start

# 5. 检查本机环境与异构 CLI Agent
node bin/yunyu.mjs doctor
```

---

## 3. 核心架构与源码导航

所有模块边界与 6 条硬不变量详见 [AGENTS.md](../AGENTS.md) 与 [docs/ARCHITECTURE.md](ARCHITECTURE.md)。核心代码地图如下：

| 目录 / 文件 | 核心职责 | 关键类 / 导出符号 |
| :--- | :--- | :--- |
| [src/core/board.mjs](../src/core/board.mjs) | 共享不可变留言板、频道、Token 解析与图谱构建 | `MessageBoard`, `parseMessageTokens`（支持 `@member`, `@#channel`, `@all`, `#seq`, `annotateTranslation`, `buildGraph`） |
| [src/core/storage.mjs](../src/core/storage.mjs) | 追加式 JSONL 持久化与快照恢复 | `SwarmStorage`（写入 `.yunyu/swarms/<id>/events.jsonl` 与 `meta.json`） |
| [src/core/ownership.mjs](../src/core/ownership.mjs) | 文件所有权契约与 QA 禁改守卫 | `OwnershipGuard`, `matchGlob`（强制 `verifier`/`qa` 禁改 `src/**`, `web/**`, `app/**`, `lib/**`） |
| [src/core/worktree.mjs](../src/core/worktree.mjs) | 真实 Git Worktree 生命周期管理 | `WorktreeManager`（`share`=`git worktree add`, `branch`=`git clone`, `inherit`；含提交/合并前审计与未合并保护） |
| [src/core/monitor.mjs](../src/core/monitor.mjs) | 防停滞看门狗 | `StallMonitor`（全员静默超时精准唤醒，`[done]` 自动停机） |
| [src/core/orchestrator.mjs](../src/core/orchestrator.mjs) | 蜂群总控调度器与多蜂群管理器 | `SwarmInstance`, `TeamworkManager`（事件驱动唤醒、轮次熔断上限 50、`waitIdle`、`waitForMention`） |
| [src/core/templates.mjs](../src/core/templates.mjs) | 内置中文研发团队模板 | `TEAM_TEMPLATES`（`gitlab-fullstack`, `heterogeneous-cli`, `gitlab-code-review`） |
| [src/drivers/](../src/drivers/registry.mjs) | 异构 Agent 驱动层 | `OpenAICompatibleDriver`, `CliAgentDriver` (`claude-code`/`codex-cli`/`gemini-cli`), `WebhookAgentDriver` (HMAC-SHA256), `HumanAgentDriver`, `SimulatedAgentDriver` |
| [src/gitlab/](../src/gitlab/index.mjs) | GitLab REST API v4、Webhook 路由、双向同步与本地模拟器 | `GitLabClient`, `verifyGitLabWebhookToken`, `translateGitLabWebhook`, `GitLabSyncService`, `GitLabMockServer` |
| [src/mcp/server.mjs](../src/mcp/server.mjs) | 标准 MCP JSON-RPC 2.0 服务端 | `YunyuMcpServer`, `MCP_TOOLS`（支持 stdio [bin/yunyu-mcp.mjs](../bin/yunyu-mcp.mjs) 与 HTTP `/api/mcp`） |
| [src/server/](../src/server/app.mjs) | 零依赖 HTTP REST + SSE + 静态资源服务 | `YunyuServer`, `handleApiRoute`, `SseHub` |
| [web/](../web/index.html) | 原生暗黑双语（默认简体中文）5 视图 Web 看板 | `index.html`, `styles.css`, `app.js`, `graph.js`（SVG 拓扑 + 时间轴回放）, `i18n.js` |
| [src/demo/showcase-scenario.mjs](../src/demo/showcase-scenario.mjs) | 离线全链路真实 Git + GitLab 演示剧本 | `createDemoGitRepo`, `runShowcaseDemo` |

---

## 4. 已踩坑与关键修复记录（后续改动严禁回退！）

以下 6 个真实生产级坑点已在 `v0.1.0` 定位并修复，迭代时务必保留其防护逻辑：

1. **Windows `git status --porcelain` 首空格截断陷阱**（[src/core/worktree.mjs](../src/core/worktree.mjs)）：
   - `git status --porcelain` 对已追踪修改文件输出 `" M src/file.mjs"`（含前导空格）；若先 `.trim()` 再 `.slice(3)` 会把路径截成 `"rc/file.mjs"` 导致误报越权。已改为 `trimLeading: false` 保留前导状态列。
2. **Node 22 `fetch`（undici）WHATWG 禁用端口随机碰撞**（[src/server/app.mjs](../src/server/app.mjs)、[src/gitlab/mock-server.mjs](../src/gitlab/mock-server.mjs)）：
   - Windows 上 `server.listen(0)` 可能随机分配到 WHATWG Fetch 标准禁止端口（如 `4045`, `5060`, `6667`），导致 `fetch` 抛出 `Error: bad port`。已在两处加入 `WHATWG_BAD_PORTS` 检测与自动重选端口循环。
3. **系统报错自触发无限唤醒环**（[src/core/orchestrator.mjs](../src/core/orchestrator.mjs)）：
   - 成员执行抛错后，系统播报不能在文本中使用 `@member`（否则立即重新唤醒刚失败的成员形成死循环）。已改为反引号展示名 + `metadata.noWake: true` + 每成员 50 轮熔断保护。
4. **`StallMonitor` 对自身告警消息重复触发**（[src/core/monitor.mjs](../src/core/monitor.mjs)）：
   - 必须在 `postMessage` 之后将 `this.lastAlertSeq = alertMsg.seq`，避免下一次巡检把 monitor 自己的告警当成新静默消息再次提醒。
5. **嵌套 `node --test` 环境变量干扰**（[src/drivers/base.mjs](../src/drivers/base.mjs)）：
   - 在 `tools.run_command` 中删除继承的 `NODE_TEST_CONTEXT`，避免在集成测试中启动子进程执行 `node --test` 时发生异常。
6. **Node 22 HTTP Keep-Alive 导致进程无法退出（Tasks 一直 Running）**（[src/server/app.mjs](../src/server/app.mjs)、[src/gitlab/mock-server.mjs](../src/gitlab/mock-server.mjs)、[src/demo/showcase-scenario.mjs](../src/demo/showcase-scenario.mjs)）：
   - `cleanup()` 必须始终关闭内部创建的 `GitLabMockServer`；且 `http.Server.close()` 必须配合 `srv.closeAllConnections?.()` 立即释放 Keep-Alive 连接，确保 CLI 与测试进程毫秒级干净退出。

---

## 5. 下一阶段（v0.2.0 / v0.3.0）优先开发与优化路线图

建议按以下优先级分迭代推进：

### P0（核心生产可用性强化 — 推荐作为下一会话首个里程碑 `v0.2.0`）
1. **真实多 CLI Agent 实战联调（Claude Code + Codex CLI 协同实测）**：
   - 在 [src/drivers/cli-agent.mjs](../src/drivers/cli-agent.mjs) 增强对 `claude` / `codex` / `gemini` 流式输出（stdout 逐行推送至 SSE 实时终端日志面板）、会话上下文复用（`--resume` / session id）与结构化 JSON 输出解析。
   - 新增真实可运行的端到端脚本（例如让本机 Claude Code 充当 `@architect`，Codex CLI 充当 `@backend`，在沙盒 Git 仓库协同完成一个真实特性开发）。
2. **重启持久化 Worktree 与 GitLab 绑定恢复**：
   - 当前 `SwarmInstance.rehydrate()` 已恢复 `events.jsonl`、成员与契约，但尚未在重启后自动重建 `WorktreeManager` 内存映射与 `GitLabClient`/`GitLabSyncService` 实例（当前仅保存了 `meta.gitlab` 摘要）。需在 `rehydrate()` 补齐自动重连与 Worktree 扫描挂接。
3. **真实 GitLab 仓库双向闭环强化**：
   - 增加 `git push origin <branch>` 可控发布工具（带白名单分支保护，严禁强推 `main`）。
   - 在 GitLab 面板新增 **Issue 评论区查看与直接回复**、**MR Diff 在线预览** 以及 **GitLab Milestone / 看板燃尽统计**。
   - 支持配置多个 GitLab 项目映射表（一个 Yunyu 实例同时托管多个 GitLab 仓库）。

### P1（协作体验与项目管理升级 — `v0.2.x`）
4. **任务管理与交付物看板（Tasks & Milestones Tab）**：
   - 在 Web UI 新增第 6 个视图「任务看板（Kanban）」，将任务卡、关联的 GitLab Issue/MR、负责成员、`#seq` 交付凭证与验收状态结构化串联，方便人类项目经理一眼看清各阶段交付进度。
5. **自动中文翻译接入（Auto-Translator Hook）**：
   - 当英文外部 Agent 或英文 GitLab Webhook 发帖时，支持配置可选的轻量 LLM 翻译器自动调用 `annotateTranslation(seq, 'zh-CN', ...)` 填充中文注解层，同时在 UI 提供人工编辑/润色中文注解入口。
6. **LLM 流式输出与 Token/成本预算控制**：
   - 为 `OpenAICompatibleDriver` 增加 SSE 流式思考/输出展示、单蜂群 Token 预算上限与配额耗尽自动模型降级（`switchModel`）。

### P2（开源生态与企业部署 — `v0.3.0`）
7. **容器化与一键部署**：补充 `Dockerfile`、`docker-compose.yml`（可搭配自托管 GitLab CE 联调）与配置向导。
8. **安全与权限认证**：为 Web UI、REST API 与 HTTP `/api/mcp` 增加可选 Bearer Token / Basic Auth 认证，适配局域网多人协同访问。

---

## 6. 新会话开场白模板（可直接复制使用）

在开启新会话时，直接粘贴以下内容即可秒级恢复全部上下文并启动开发：

```text
请先阅读 d:/workspace/codex/yunyu-teamwork/AGENTS.md 与 d:/workspace/codex/yunyu-teamwork/docs/HANDOFF.md，然后运行 `npm run verify` 确认基线全绿。
本次目标为 yunyu-teamwork v0.2.0 迭代，请先基于 HANDOFF.md 第 5 节的 P0 路线图给我细化实施计划，确认后再开始编码开发与验证：
1. 重启后自动恢复 Git Worktree 映射与 GitLab Client/Sync 连接；
2. 增强 cli-agent 驱动对本机 Claude Code / Codex CLI 的实时日志流与会话上下文支持；
3. 在 Web UI 新增「任务与交付物看板（Kanban）」并支持 GitLab Issue 评论直接预览与回复。
```
