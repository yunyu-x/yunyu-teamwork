<!-- yunyu-wiki slug=module-drivers version=1 category=module updatedAt=2026-11-21T18:01:56.155Z -->
# 模块域详解：异构 Agent 驱动层 (src/drivers)

- 文件数：9 · 总行数：2087 LOC · 导出符号：14
- 依赖下游域：`core` (7条边), `channels` (1条边)
- 被上游域调用：`core` (9条边), `bin` (1条边), `examples` (1条边), `server` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/drivers/base.mjs` | 567 | 11 | 2 | `AgentDriver`, `createGuardedWorkspaceTools`, `invokeToolWithHooks`, `resolveInsideWorkspace` |
| `src/drivers/cli-agent.mjs` | 475 | 2 | 1 | `CLI_PRESETS`, `CliAgentDriver` |
| `src/drivers/digital-twin.mjs` | 187 | 2 | 3 | `DigitalTwinDriver` |
| `src/drivers/human-agent.mjs` | 16 | 2 | 1 | `HumanAgentDriver` |
| `src/drivers/openai-compatible.mjs` | 524 | 2 | 1 | `OpenAICompatibleDriver` |
| `src/drivers/registry.mjs` | 47 | 12 | 7 | `DriverRegistry`, `createDefaultDriverRegistry` |
| `src/drivers/research-synthesizer.mjs` | 150 | 2 | 3 | `ResearchSynthesizerDriver` |
| `src/drivers/simulated-agent.mjs` | 44 | 2 | 2 | `SimulatedAgentDriver` |
| `src/drivers/webhook-agent.mjs` | 77 | 2 | 2 | `WebhookAgentDriver` |
