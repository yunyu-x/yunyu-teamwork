<!-- yunyu-wiki slug=workflows-and-ops version=1 category=operations updatedAt=2026-11-21T16:35:47.312Z -->
# 工程规范、测试矩阵与质量门禁
## 1. 自动化测试清单
- `tests/integration/digital-twin-channels.test.mjs` (218 行 · 覆盖依赖 5 个源码模块)
- `tests/integration/http-api-sse.test.mjs` (96 行 · 覆盖依赖 1 个源码模块)
- `tests/integration/mcp-server.test.mjs` (79 行 · 覆盖依赖 3 个源码模块)
- `tests/integration/rehydrate-recovery.test.mjs` (173 行 · 覆盖依赖 5 个源码模块)
- `tests/integration/swarm-e2e.test.mjs` (53 行 · 覆盖依赖 3 个源码模块)
- `tests/integration/v020-api-kanban-gitlab-im.test.mjs` (209 行 · 覆盖依赖 3 个源码模块)
- `tests/integration/v030-qoder-research-budget.test.mjs` (194 行 · 覆盖依赖 3 个源码模块)
- `tests/integration/v040-world-wiki-audit.test.mjs` (166 行 · 覆盖依赖 2 个源码模块)
- `tests/ui/cdp-ui-qa.mjs` (482 行 · 覆盖依赖 2 个源码模块)
- `tests/unit/board.test.mjs` (61 行 · 覆盖依赖 2 个源码模块)
- `tests/unit/budget-knowledge-research.test.mjs` (200 行 · 覆盖依赖 9 个源码模块)
- `tests/unit/cli-agent-stream.test.mjs` (209 行 · 覆盖依赖 2 个源码模块)
- `tests/unit/drivers.test.mjs` (89 行 · 覆盖依赖 2 个源码模块)
- `tests/unit/git-agents-workflow.test.mjs` (140 行 · 覆盖依赖 8 个源码模块)
- `tests/unit/gitlab-webhook.test.mjs` (48 行 · 覆盖依赖 1 个源码模块)
- `tests/unit/monitor.test.mjs` (44 行 · 覆盖依赖 1 个源码模块)
- `tests/unit/ownership.test.mjs` (43 行 · 覆盖依赖 1 个源码模块)
- `tests/unit/qoder-issues-dag.test.mjs` (130 行 · 覆盖依赖 3 个源码模块)
- `tests/unit/security-hardening.test.mjs` (295 行 · 覆盖依赖 15 个源码模块)
- `tests/unit/worktree.test.mjs` (55 行 · 覆盖依赖 4 个源码模块)
- `tests/unit/world-model-wiki-audit.test.mjs` (169 行 · 覆盖依赖 5 个源码模块)
## 2. 协作交付标准流程
1. 修改高扇入核心文件前，先运行「变更爆炸半径模拟器」识别受影响的下游域、测试集与协作成员。
2. 并发作者通过独立 Git Worktree (`workspace: "share"`) 隔离改动，合并前执行 `OwnershipGuard` 越权审计。
3. 验证者 / 复核者 / 情报研究员严格保持对 `src/` 与 `web/` 只读，发现缺陷在留言板 `@author` 或开具 Qoder Issue。
4. 发布前必须依次通过语法直检、单测/集成测试、无头 Chrome UI QA 与全仓安全审计门禁。
## 3. 最近一次全仓自动审计快照

- 审计评分：**100/100**（通过）
- 发现数：P0=0 · P1=0 · P2=0
