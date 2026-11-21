<!-- yunyu-wiki slug=module-core version=1 category=module updatedAt=2026-11-21T18:01:56.155Z -->
# 模块域详解：蜂群核心引擎 (src/core)

- 文件数：17 · 总行数：7105 LOC · 导出符号：95
- 依赖下游域：`drivers` (9条边), `gitlab` (3条边), `plugins` (2条边), `channels` (1条边), `demo` (1条边), `mcp` (1条边), `server` (1条边)
- 被上游域调用：`server` (8条边), `drivers` (7条边), `bin` (6条边), `plugins` (5条边), `gitlab` (4条边), `examples` (2条边), `channels` (2条边), `demo` (1条边), `mcp` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/core/auditor.mjs` | 444 | 5 | 2 | `ProjectAuditor` |
| `src/core/board.mjs` | 426 | 5 | 1 | `MessageBoard`, `parseMessageTokens` |
| `src/core/budget.mjs` | 216 | 4 | 0 | `BudgetGovernor` |
| `src/core/constants.mjs` | 128 | 39 | 0 | `APP_VERSION`, `AUTONOMY_MODES`, `DEFAULT_CONFIG`, `GITLAB_STATUS_LABELS`, `KNOWLEDGE_CATEGORIES`, `MEMBER_ROLES` |
| `src/core/knowledge.mjs` | 132 | 4 | 1 | `KnowledgeVault` |
| `src/core/monitor.mjs` | 101 | 2 | 1 | `StallMonitor` |
| `src/core/orchestrator.mjs` | 1290 | 15 | 16 | `SwarmInstance`, `TeamworkManager`, `redactDriverConfigForPublic`, `validateGitLabTokenEnvName` |
| `src/core/ownership.mjs` | 249 | 10 | 1 | `OwnershipGuard`, `matchGlob`, `normalizeRelPath` |
| `src/core/research.mjs` | 452 | 8 | 1 | `ResearchEngine`, `extractKeywords`, `extractUrls`, `isPrivateIpOrHost` |
| `src/core/storage.mjs` | 174 | 9 | 0 | `SwarmStorage`, `sanitizeId` |
| `src/core/tasks.mjs` | 737 | 4 | 1 | `TaskTracker`, `normalizeTaskStatus` |
| `src/core/templates.mjs` | 397 | 5 | 1 | `AGENT_PRESETS`, `TEAM_TEMPLATES`, `listAgentPresets`, `listTemplates` |
| `src/core/twins-store.mjs` | 168 | 3 | 1 | `TwinsStore` |
| `src/core/wiki.mjs` | 594 | 5 | 0 | `ProjectWiki`, `WIKI_CATEGORIES`, `sanitizeWikiSlug` |
| `src/core/worktree.mjs` | 690 | 5 | 3 | `WorktreeManager`, `hasHeadCommit`, `isGitRepo` |
| `src/core/world-model.mjs` | 875 | 6 | 1 | `ProjectWorldModel` |
| `src/index.mjs` | 32 | 0 | 31 | `AGENT_PRESETS`, `AgentDriver`, `BudgetGovernor`, `CHANNEL_ADAPTERS`, `CLI_PRESETS`, `ChannelBridge` |
