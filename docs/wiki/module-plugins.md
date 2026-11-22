<!-- yunyu-wiki slug=module-plugins version=1 category=module updatedAt=2026-11-22T03:38:48.762Z -->
# 模块域详解：Agent 插件与生态层 (src/plugins)

- 文件数：8 · 总行数：3287 LOC · 导出符号：24
- 依赖下游域：`core` (5条边)
- 被上游域调用：`core` (2条边), `server` (2条边), `bin` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/plugins/connectors.mjs` | 482 | 2 | 0 | `ConnectorHub`, `HARNESS_CATALOG` |
| `src/plugins/hooks.mjs` | 526 | 3 | 0 | `HOOK_EVENTS`, `HookEngine` |
| `src/plugins/hub.mjs` | 195 | 3 | 5 | `PluginHub` |
| `src/plugins/index.mjs` | 8 | 2 | 7 | `ConnectorHub`, `HARNESS_CATALOG`, `HOOK_EVENTS`, `HookEngine`, `McpClientManager`, `PluginHub` |
| `src/plugins/mcp-client.mjs` | 593 | 2 | 2 | `McpClientManager` |
| `src/plugins/parser.mjs` | 331 | 2 | 0 | `parseConfigFile`, `parseMarkdownAsset`, `parseYamlLite` |
| `src/plugins/registry.mjs` | 990 | 3 | 3 | `PluginRegistry`, `redactPluginForPublic` |
| `src/plugins/skills-runtime.mjs` | 162 | 2 | 1 | `SkillsRuntime` |
