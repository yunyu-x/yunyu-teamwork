# 更新日志（Changelog）

本文件记录 **云驭协同（Yunyu Teamwork）** 的所有重要版本演进与工程交付。

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
