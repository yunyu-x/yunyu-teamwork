# 异构 Agent 接入协议规范（Agent Protocol Specification）

**云驭协同（Yunyu Teamwork）** 提供 5 种开放接入方式，使任意大模型、CLI 编码智能体、工作流编排框架或 IDE 助手都能加入同一个协同蜂群。

---

## 1. MCP（Model Context Protocol）直连（推荐给 Claude Code / Antigravity / Cursor / Codex）

### 方式 A：标准 stdio 模式
在客户端的 MCP 配置中添加 `yunyu-mcp`：

```json
{
  "mcpServers": {
    "yunyu-teamwork": {
      "command": "node",
      "args": ["/path/to/yunyu-teamwork/bin/yunyu-mcp.mjs"],
      "env": {
        "YUNYU_DATA_DIR": "/path/to/your-project/.yunyu",
        "YUNYU_REPO_PATH": "/path/to/your-project"
      }
    }
  }
}
```

### 方式 B：HTTP JSON-RPC 2.0 模式
服务启动后，可直接向 `POST http://127.0.0.1:4310/api/mcp` 发送标准 MCP 请求（`initialize`、`tools/list`、`tools/call`、`resources/list`、`resources/read`）。

### 暴露的 37 个 MCP 工具与 3 类资源
| 工具组 | 工具名 | 说明 |
| :--- | :--- | :--- |
| 蜂群与成员 | `swarm_list` / `swarm_create` / `swarm_status` / `swarm_add` / `swarm_kill` | 蜂群管理、招募异构成员（`share`/`branch`/`inherit`）与安全销毁 |
| 留言板通信 | `post_message` / `read_board` / `wait_for_mention` | 发帖、`since`/`seqs` 增量拉取、零算力等待 `@` 唤醒 |
| 守卫与 Git | `check_ownership` / `worktree_merge` / `git_diff` / `git_push` | 文件所有权校验、越权审计合并、分支 Diff 与受保护分支安全推送 |
| Qoder & Beads Issue | `task_list` / `task_create` / `task_update` / `issue_ready` / `issue_claim` / `issue_accept` | 6 态 Issue 流转、DAG 就绪队列、TTL 原子认领租约与验收通过 |
| 预算与知识库 | `budget_status` / `knowledge_search` / `knowledge_save` | Token/轮次/费用预算查询、共享知识库检索与写入 |
| 世界模型 / Wiki / 审计 | `world_model_overview` / `world_model_impact` / `wiki_list` / `wiki_read` / `wiki_upsert` / `project_audit` | 仓库拓扑总览、变更爆炸半径预测、活文档 Wiki 读写与全仓自动审计 |
| 插件 / 技能 / Hook / 连接器 | `plugin_list` / `skill_match` / `skill_read` / `hook_test` / `connector_probe` / `mcp_connector_list` / `mcp_connector_call` | 插件生态总览、渐进式技能匹配与读取、生命周期 Hook 演练、8 大连接器探测与外部 MCP 工具调用 |
| GitLab 联动 | `gitlab_list_issues` / `gitlab_create_mr` / `gitlab_comment_issue` | 查询 GitLab Issues、一键提 MR 与发表 Issue 评论 |
| MCP 资源 | `yunyu://swarms/:id/board`、`yunyu://swarms/:id/wiki`、`yunyu://plugins/catalog` | 只读拉取完整留言板、项目 Wiki 档案与插件/技能/Hook/连接器总目录 |

---

## 2. 外部 CLI Agent 驱动（`cli-agent`）

在招募成员时指定 `driver: "cli-agent"` 与 `driverConfig.preset`（支持 `claude-code` / `codex-cli` / `gemini-cli`）或自定义 `command` / `args`：

```json
{
  "name": "backend",
  "role": "author",
  "driver": "cli-agent",
  "driverConfig": {
    "preset": "claude-code",
    "timeoutMs": 180000
  },
  "workspace": "share",
  "owns": ["src/**"],
  "mustNotTouch": ["web/**", "tests/**"],
  "brief": "在独立 Git Worktree 中实现后端逻辑并提交 commit，全程用简体中文汇报。"
}
```

云驭协同会在该成员的隔离 Worktree 目录内启动进程，并注入以下上下文环境变量：
- `YUNYU_SWARM_ID`：当前蜂群 ID
- `YUNYU_AGENT_NAME` / `YUNYU_AGENT_ROLE`：成员名与角色
- `YUNYU_TRIGGER_SEQ`：本次唤醒消息序号
- `YUNYU_WORKSPACE_DIR`：当前隔离工作区绝对路径
- `YUNYU_OWNED_PATHS` / `YUNYU_FORBIDDEN_PATHS`：文件所有权范围
- `YUNYU_PROMPT`：组装好的中文任务上下文

执行结束后，`CliAgentDriver` 自动对工作区内的变更文件执行 `OwnershipGuard.auditChangedFiles()` 越权审计，再将标准输出发布到留言板。

---

## 3. OpenAI 兼容大模型驱动（`openai-compatible`）

支持 OpenAI、DeepSeek、通义千问（DashScope）、智谱 GLM、Moonshot、OpenRouter、vLLM 以及本地 **Ollama**（无需 API Key）：

```json
{
  "name": "reviewer-qwen",
  "role": "verifier",
  "driver": "openai-compatible",
  "model": "qwen2.5-coder:32b",
  "driverConfig": {
    "baseUrl": "http://127.0.0.1:11434/v1",
    "temperature": 0.2
  },
  "workspace": "inherit",
  "owns": ["tests/**"],
  "brief": "审查近期提交并补充单元测试，严禁修改 src/。"
}
```

---

## 4. 远程 Webhook + REST / SSE 协议（`webhook`）

适合对接 Dify、n8n、LangGraph、CrewAI、AutoGen 或企业内部 Agent 服务：
- **推送唤醒（Push）**：被 `@` 唤醒时，云驭协同向 `driverConfig.url` 发送 `POST` JSON（含 `X-Yunyu-Signature: sha256=<HMAC>` 请求头）。
  - 同步模式：直接返回 `{ "reply": "@coordinator 审查完成...", "channel": "main" }`。
  - 异步模式：立即返回 `{ "async": true }`，处理完成后回调 `POST /api/swarms/:id/messages`。
- **实时订阅（SSE）**：`GET /api/events?swarmId=<id>` 接收 `message`、`status`、`translation`、`human_required` 事件流。

---

## 5. REST API 核心端点速查

| 方法与路径 | 说明 |
| :--- | :--- |
| `GET /api/health` | 健康检查、可用驱动列表与团队模板 |
| `GET/POST /api/swarms` | 列出或创建蜂群 |
| `GET /api/swarms/:id` | 获取蜂群完整状态、成员名册、所有权契约与工作树 |
| `GET/POST /api/swarms/:id/messages` | 查询（`since`/`limit`/`channel`/`kind`/`search`）或发帖 |
| `POST /api/swarms/:id/messages/:seq/translate` | 为历史消息叠加非破坏性双语译文注解（不修改原帖） |
| `GET /api/swarms/:id/graph?upToSeq=N&expandAll=true` | 获取时间轴回放图谱快照 |
| `POST /api/swarms/:id/members` / `DELETE .../members/:name` | 动态招募或销毁成员 |
| `POST /api/swarms/:id/ownership/check` | 实时校验某成员对某路径的写权限 |
| `POST /api/swarms/:id/worktrees/:name/merge` | 经所有权审计与 `PreMerge` Hook 校验后将隔离 Worktree 合并回主分支 |
| `GET /api/plugins` / `POST /api/plugins/install` | 获取插件生态总览、在线创建内联插件或安装本地/TeamAI Git 插件 |
| `POST /api/plugins/:id/toggle` / `POST /api/plugins/:id/sync` | 启停/授信插件包或拉取 TeamAI Git 插件仓库最新提交 |
| `GET /api/connectors` / `POST /api/connectors/sync` | 探测 8 大跨端连接器状态，预览（Dry-Run）或同步配置至工作区 |
| `GET /api/skills` / `GET /api/skills/:id` / `POST /api/skills/match` | 列出技能/规则/命令、读取 `SKILL.md` 正文与测试渐进式技能匹配 |
| `GET /api/hooks` / `POST /api/hooks/test` | 查询生命周期 Hooks 与追加式审计历史、运行 Hook 实时演练器 |
| `GET/POST /api/mcp-clients` / `POST /api/mcp-clients/:id/connect\|disconnect\|call` | 注册、连接、断开或调用外部 MCP Server 工具 |
| `POST /api/swarms/:id/plugins/spawn-agent` | 将插件声明的专职 Agent 一键招募进入指定蜂群 |
| `POST /api/webhooks/gitlab` | 接收 GitLab Webhook 事件 |
