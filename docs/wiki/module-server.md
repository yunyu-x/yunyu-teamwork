<!-- yunyu-wiki slug=module-server version=1 category=module updatedAt=2026-11-21T16:35:47.313Z -->
# 模块域详解：HTTP API 与 SSE 服务 (src/server)

- 文件数：3 · 总行数：1456 LOC · 导出符号：6
- 依赖下游域：`core` (7条边), `channels` (2条边), `drivers` (1条边), `mcp` (1条边), `gitlab` (1条边)
- 被上游域调用：`bin` (1条边), `examples` (1条边), `core` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/server/app.mjs` | 205 | 9 | 8 | `YunyuServer` |
| `src/server/routes.mjs` | 1179 | 1 | 6 | `handleApiRoute`, `readJsonBody`, `readRawBody`, `sendJson` |
| `src/server/sse.mjs` | 72 | 1 | 0 | `SseHub` |
