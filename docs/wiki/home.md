<!-- yunyu-wiki slug=home version=1 category=overview updatedAt=2026-11-21T16:35:47.312Z -->
# yunyu-teamwork v0.4.0 — 项目档案总览
> 云驭协同（Yunyu Teamwork）— 开源多 Agent 蜂群协同研发、项目世界模型、活文档 Wiki 与 GitLab 双向联动平台（零外部依赖、异构 Agent、Git Worktree 隔离、Qoder Issue 中心、MCP 服务端）
## 1. 世界模型核心指标
| 指标 | 数值 | 说明 |
| :--- | :--- | :--- |
| 仓库健康度 | **100/100** | 综合循环依赖、零外部依赖不变量、测试与所有权冲突评分 |
| 扫描文件总数 | 96（源码 76 / 测试 21 / 文档 12） | 覆盖仓库主要代码与配置 |
| 总代码与文档行数 | 22670 LOC | 总体积 847.4 KB |
| 模块导出符号 / 依赖边 | 164 导出 · 232 依赖边 | 循环依赖：0 个 |
| 外部运行时依赖 | 0 个 | 满足零外部运行时依赖铁律 |
## 2. 模块域分布全景
| 域 ID | 职责描述 | 文件数 | 行数 (LOC) | 导出符号 | 所有权角色 |
| :--- | :--- | ---: | ---: | ---: | :--- |
| `core` | 蜂群核心引擎 (src/core) | 17 | 6930 | 94 | — |
| `web` | Web 协同看板前端 (web) | 13 | 5095 | 31 | — |
| `tests` | 自动化测试与 UI QA (tests) | 21 | 3153 | 0 | — |
| `drivers` | 异构 Agent 驱动层 (src/drivers) | 9 | 1789 | 13 | — |
| `server` | HTTP API 与 SSE 服务 (src/server) | 3 | 1456 | 6 | — |
| `gitlab` | GitLab 双向集成层 (src/gitlab) | 5 | 749 | 10 | — |
| `mcp` | MCP 协议服务端 (src/mcp) | 1 | 698 | 2 | — |
| `demo` | 演示与编排场景 (src/demo) | 1 | 546 | 2 | — |
| `root` | 项目根目录配置 | 8 | 518 | 0 | — |
| `docs` | 架构文档与知识沉淀 (docs) | 6 | 513 | 0 | — |
| `channels` | IM 与通信通道层 (src/channels) | 3 | 502 | 6 | — |
| `bin` | CLI 命令行入口 (bin) | 2 | 343 | 0 | — |
| `examples` | 接入示例与脚本 (examples) | 5 | 282 | 0 | — |
| `.github` | .github | 1 | 57 | 0 | — |
| `scripts` | 工程脚手架与门禁 (scripts) | 1 | 39 | 0 | — |
## 3. 常用工程脚本

| 命令 | 实际执行 |
| :--- | :--- |
| `npm run start` | `node bin/yunyu.mjs serve` |
| `npm run demo` | `node bin/yunyu.mjs demo` |
| `npm run demo:cli` | `node examples/cli-agent-collab.mjs` |
| `npm run audit` | `node bin/yunyu.mjs audit` |
| `npm run wiki` | `node bin/yunyu.mjs wiki` |
| `npm run mcp` | `node bin/yunyu-mcp.mjs` |
| `npm run check` | `node scripts/check-syntax.mjs` |
| `npm run test:unit` | `node --test tests/unit/*.test.mjs` |
| `npm run test:integration` | `node --test tests/integration/*.test.mjs` |
| `npm run test` | `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs` |
| `npm run qa:ui` | `node tests/ui/cdp-ui-qa.mjs` |
| `npm run verify` | `npm run check && npm test && npm run qa:ui && npm run audit` |
> 本档案由云驭协同世界模型自动同步，完整修订时间线见页面元数据。
