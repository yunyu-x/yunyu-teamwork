<!-- yunyu-wiki slug=api-and-protocols version=1 category=protocol updatedAt=2026-11-21T18:01:56.155Z -->
# 核心模块导出与协议接口清单

## 1. Node.js 内置能力依赖

本项目使用的运行时内置模块：`node:assert/strict`, `node:child_process`, `node:crypto`, `node:dns/promises`, `node:events`, `node:fs`, `node:http`, `node:net`, `node:os`, `node:path`, `node:readline`, `node:test`, `node:url`

## 2. 源码导出符号索引

| 模块路径 | 所属域 | 主要导出符号 |
| :--- | :--- | :--- |
| `src/channels/adapters.mjs` | `channels` | `CHANNEL_ADAPTERS`, `listChannelTypes` |
| `src/channels/bridge.mjs` | `channels` | `ChannelBridge` |
| `src/channels/index.mjs` | `channels` | `CHANNEL_ADAPTERS`, `ChannelBridge`, `listChannelTypes` |
| `src/core/auditor.mjs` | `core` | `ProjectAuditor` |
| `src/core/board.mjs` | `core` | `MessageBoard`, `parseMessageTokens` |
| `src/core/budget.mjs` | `core` | `BudgetGovernor` |
| `src/core/constants.mjs` | `core` | `APP_VERSION`, `AUTONOMY_MODES`, `DEFAULT_CONFIG`, `GITLAB_STATUS_LABELS`, `KNOWLEDGE_CATEGORIES`, `MEMBER_ROLES`, `MEMBER_STATES`, `MESSAGE_KINDS` |
| `src/core/knowledge.mjs` | `core` | `KnowledgeVault` |
| `src/core/monitor.mjs` | `core` | `StallMonitor` |
| `src/core/orchestrator.mjs` | `core` | `SwarmInstance`, `TeamworkManager`, `redactDriverConfigForPublic`, `validateGitLabTokenEnvName` |
| `src/core/ownership.mjs` | `core` | `OwnershipGuard`, `matchGlob`, `normalizeRelPath` |
| `src/core/research.mjs` | `core` | `ResearchEngine`, `extractKeywords`, `extractUrls`, `isPrivateIpOrHost` |
| `src/core/storage.mjs` | `core` | `SwarmStorage`, `sanitizeId` |
| `src/core/tasks.mjs` | `core` | `TaskTracker`, `normalizeTaskStatus` |
| `src/core/templates.mjs` | `core` | `AGENT_PRESETS`, `TEAM_TEMPLATES`, `listAgentPresets`, `listTemplates` |
| `src/core/twins-store.mjs` | `core` | `TwinsStore` |
| `src/core/wiki.mjs` | `core` | `ProjectWiki`, `WIKI_CATEGORIES`, `sanitizeWikiSlug` |
| `src/core/worktree.mjs` | `core` | `WorktreeManager`, `hasHeadCommit`, `isGitRepo` |
| `src/core/world-model.mjs` | `core` | `ProjectWorldModel` |
| `src/demo/showcase-scenario.mjs` | `demo` | `createDemoGitRepo`, `runShowcaseDemo` |
| `src/drivers/base.mjs` | `drivers` | `AgentDriver`, `createGuardedWorkspaceTools`, `invokeToolWithHooks`, `resolveInsideWorkspace` |
| `src/drivers/cli-agent.mjs` | `drivers` | `CLI_PRESETS`, `CliAgentDriver` |
| `src/drivers/digital-twin.mjs` | `drivers` | `DigitalTwinDriver` |
| `src/drivers/human-agent.mjs` | `drivers` | `HumanAgentDriver` |
| `src/drivers/openai-compatible.mjs` | `drivers` | `OpenAICompatibleDriver` |
| `src/drivers/registry.mjs` | `drivers` | `DriverRegistry`, `createDefaultDriverRegistry` |
| `src/drivers/research-synthesizer.mjs` | `drivers` | `ResearchSynthesizerDriver` |
| `src/drivers/simulated-agent.mjs` | `drivers` | `SimulatedAgentDriver` |
| `src/drivers/webhook-agent.mjs` | `drivers` | `WebhookAgentDriver` |
| `src/gitlab/client.mjs` | `gitlab` | `GitLabClient` |
| `src/gitlab/index.mjs` | `gitlab` | `GitLabClient`, `GitLabMockServer`, `GitLabSyncService`, `translateGitLabWebhook`, `verifyGitLabWebhookToken` |
| `src/gitlab/mock-server.mjs` | `gitlab` | `GitLabMockServer` |
| `src/gitlab/sync.mjs` | `gitlab` | `GitLabSyncService` |
| `src/gitlab/webhook.mjs` | `gitlab` | `translateGitLabWebhook`, `verifyGitLabWebhookToken` |
| `src/index.mjs` | `core` | `AGENT_PRESETS`, `AgentDriver`, `BudgetGovernor`, `CHANNEL_ADAPTERS`, `CLI_PRESETS`, `ChannelBridge`, `CliAgentDriver`, `DigitalTwinDriver` |
| `src/mcp/server.mjs` | `mcp` | `MCP_TOOLS`, `YunyuMcpServer` |
| `src/plugins/connectors.mjs` | `plugins` | `ConnectorHub`, `HARNESS_CATALOG` |
| `src/plugins/hooks.mjs` | `plugins` | `HOOK_EVENTS`, `HookEngine` |
| `src/plugins/hub.mjs` | `plugins` | `PluginHub` |
| `src/plugins/index.mjs` | `plugins` | `ConnectorHub`, `HARNESS_CATALOG`, `HOOK_EVENTS`, `HookEngine`, `McpClientManager`, `PluginHub`, `PluginRegistry`, `SkillsRuntime` |
| `src/plugins/mcp-client.mjs` | `plugins` | `McpClientManager` |
| `src/plugins/parser.mjs` | `plugins` | `parseConfigFile`, `parseMarkdownAsset`, `parseYamlLite` |
| `src/plugins/registry.mjs` | `plugins` | `PluginRegistry`, `redactPluginForPublic` |
| `src/plugins/skills-runtime.mjs` | `plugins` | `SkillsRuntime` |
| `src/server/app.mjs` | `server` | `YunyuServer` |
