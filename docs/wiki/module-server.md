<!-- yunyu-wiki slug=module-server version=1 category=module updatedAt=2026-11-21T18:01:56.155Z -->
# 模块域详解：HTTP API 与 SSE 服务 (src/server)

- 文件数：4 · 总行数：1937 LOC · 导出符号：7
- 依赖下游域：`core` (8条边), `channels` (2条边), `plugins` (2条边), `drivers` (1条边), `mcp` (1条边), `gitlab` (1条边)
- 被上游域调用：`bin` (1条边), `examples` (1条边), `core` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/server/app.mjs` | 209 | 10 | 8 | `YunyuServer` |
| `src/server/plugin-routes.mjs` | 437 | 1 | 3 | `handlePluginApiRoute` |
| `src/server/routes.mjs` | 1219 | 1 | 7 | `handleApiRoute`, `readJsonBody`, `readRawBody`, `sendJson` |
| `src/server/sse.mjs` | 72 | 1 | 0 | `SseHub` |
