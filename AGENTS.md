# AGENTS.md — 云驭协同（Yunyu Teamwork）多 Agent 协作架构契约与工程铁律

本文件为所有参与 `yunyu-teamwork` 开发的 AI 编程智能体（Claude Code / Codex / Gemini / Antigravity / OpenAI 兼容模型）与人类贡献者必须严格遵守的第一手架构契约。

---

## 1. 模块边界与文件所有权（File Ownership）

| 目录 / 文件 | 职责定位 | 推荐所有权角色 |
| :--- | :--- | :--- |
| `src/core/` | 蜂群核心引擎：不可变 JSONL 留言板、频道与 `@mention` 路由、文件所有权守卫、Git Worktree 隔离、防停滞监控器、总控编排器 | `architect` / `core` |
| `src/drivers/` | 异构 Agent 驱动层：OpenAI 兼容 LLM、CLI Agent（Claude/Codex/Gemini）、Webhook、Human、Simulated 驱动 | `drivers` |
| `src/gitlab/` | GitLab REST API v4 客户端、Webhook 验签路由、双向标签/评论同步、本地 GitLab 模拟服务器 | `gitlab` |
| `src/mcp/` & `bin/yunyu-mcp.mjs` | 标准 MCP（Model Context Protocol）JSON-RPC 2.0 服务端 | `protocol` |
| `src/server/` & `bin/yunyu.mjs` | 零依赖 HTTP REST API、SSE 实时事件流、CLI 启动与演示入口 | `backend` |
| `web/` | 原生暗黑双语（默认简体中文）协同看板 UI（Board / Graph 时间轴回放 / Members / GitLab / Contract） | `frontend` |
| `tests/` | 单元测试、端到端集成测试、无头 Chrome CDP UI 审计（**QA/Verifier 严禁编辑 `src/` 和 `web/`**） | `qa` |
| `docs/` & `examples/` | 架构文档、协议规范、GitLab 指南、演示团队配置 | `release` / `docs` |

---

## 2. 六条不可破坏的工程不变量（Hard Invariants）

1. **零外部运行时依赖（Zero Runtime Dependencies）**：严格使用 Node.js `>= 22.0.0` 内置模块（`node:http`, `node:fs`, `node:child_process`, `node:crypto`, `node:test` 等），确保内网自托管 GitLab 场景零供应链风险、开箱即用。
2. **追加式不可变审计日志（Append-Only Immutability）**：留言板每条消息分配单调递增 `#seq` 并持久化至 JSONL，严禁就地篡改原始历史消息；双语译文或摘要通过非破坏性注解事件（`translation`）叠加，保留完整可追溯性。
3. **作者与验证者严格隔离（Author ↔ Verifier Isolation）**：`role === "verifier"` 或 `"qa"` 成员的 `OwnershipGuard` 默认强制禁止写入 `src/` 与 `web/`，仅允许编写测试与审计报告，发现缺陷后必须通过 `@author` 在留言板开具结构化缺陷单。
4. **并发作者工作树隔离（Worktree Isolation）**：并发编辑源码的作者必须使用 `workspace: "share"`（独立 `git worktree` 分支）或严格互斥的 `owns` 文件通配路径；合并前必须通过 `OwnershipGuard.auditChangedFiles()` 越权审计。
5. **事件驱动零轮询唤醒（Event-Driven Wakeup）**：成员休眠态（`waiting`）不消耗任何推理算力，仅在留言板出现 `@自身名`、`@#已订阅频道` 或 `@all` 时被唤醒；任务完成发布 `[done]` 后看门狗（`monitor`）必须静默停机。
6. **默认全中文人机友好输出（Chinese-First Readability）**：所有系统派单模板、看门狗提醒、GitLab 事件映射卡片与默认 Web UI 均使用清晰简洁的简体中文，同时支持一键切换英文（`zh-CN` / `en-US`）；技术标识（文件路径、Git SHA、命令、JSON 键名）保留英文原文。

---

## 3. 提交前标准验证命令

```bash
npm run check            # 全部 .mjs / .js 语法直检（< 1s）
npm test                 # 单元测试 + 真实 Git Worktree + GitLab Mock + MCP + SSE 集成测试
npm run qa:ui            # 无头 Chrome CDP Web UI（1440x900 桌面 + 390x844 手机）零重叠/零报错验收
npm run verify           # 完整一键门禁（check + test + qa:ui）
```
