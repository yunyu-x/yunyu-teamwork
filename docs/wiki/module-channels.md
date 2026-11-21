<!-- yunyu-wiki slug=module-channels version=1 category=module updatedAt=2026-11-21T16:35:47.313Z -->
# 模块域详解：IM 与通信通道层 (src/channels)

- 文件数：3 · 总行数：502 LOC · 导出符号：6
- 依赖下游域：`core` (2条边)
- 被上游域调用：`server` (2条边), `drivers` (1条边), `core` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/channels/adapters.mjs` | 361 | 2 | 1 | `CHANNEL_ADAPTERS`, `listChannelTypes` |
| `src/channels/bridge.mjs` | 138 | 4 | 2 | `ChannelBridge` |
| `src/channels/index.mjs` | 3 | 3 | 2 | `CHANNEL_ADAPTERS`, `ChannelBridge`, `listChannelTypes` |
