<!-- yunyu-wiki slug=home version=1 category=overview updatedAt=2026-11-21T18:01:56.154Z -->
# yunyu-teamwork v0.5.0 — 项目档案总览
> 云驭协同（Yunyu Teamwork）— 开源多 Agent 蜂群协同研发、Agent 插件与 TeamAI 跨端生态、项目世界模型、活文档 Wiki 与 GitLab 双向联动平台（零外部依赖、异构 Agent、Git Worktree 隔离、Qoder Issue 中心、MCP 双向网关）
## 1. 世界模型核心指标
| 指标 | 数值 | 说明 |
| :--- | :--- | :--- |
| 仓库健康度 | **100/100** | 综合循环依赖、零外部依赖不变量、测试与所有权冲突评分 |
| 扫描文件总数 | 139（源码 88 / 测试 23 / 文档 35） | 覆盖仓库主要代码与配置 |
| 总代码与文档行数 | 30124 LOC | 总体积 1151.2 KB |
| 模块导出符号 / 依赖边 | 194 导出 · 264 依赖边 | 循环依赖：0 个 |
| 外部运行时依赖 | 0 个 | 满足零外部运行时依赖铁律 |
## 2. 模块域分布全景
| 域 ID | 职责描述 | 文件数 | 行数 (LOC) | 导出符号 | 所有权角色 |
| :--- | :--- | ---: | ---: | ---: | :--- |
| `core` | 蜂群核心引擎 (src/core) | 17 | 7105 | 95 | — |
| `web` | Web 协同看板前端 (web) | 15 | 6245 | 34 | — |
| `tests` | 自动化测试与 UI QA (tests) | 23 | 4092 | 0 | — |
| `plugins` | Agent 插件与生态层 (src/plugins) | 8 | 3287 | 24 | — |
| `drivers` | 异构 Agent 驱动层 (src/drivers) | 9 | 2087 | 14 | — |
| `server` | HTTP API 与 SSE 服务 (src/server) | 4 | 1937 | 7 | — |
| `docs` | 架构文档与知识沉淀 (docs) | 22 | 1074 | 0 | — |
| `mcp` | MCP 协议服务端 (src/mcp) | 1 | 897 | 2 | — |
| `gitlab` | GitLab 双向集成层 (src/gitlab) | 5 | 749 | 10 | — |
| `root` | 项目根目录配置 | 8 | 577 | 0 | — |
| `demo` | 演示与编排场景 (src/demo) | 1 | 546 | 2 | — |
| `channels` | IM 与通信通道层 (src/channels) | 3 | 502 | 6 | — |
| `bin` | CLI 命令行入口 (bin) | 2 | 459 | 0 | — |
| `examples` | 接入示例与脚本 (examples) | 5 | 282 | 0 | — |
| `pluginPacks` | 内置插件资产包 (plugins) | 14 | 186 | 0 | — |
| `.github` | .github | 1 | 60 | 0 | — |
| `scripts` | 工程脚手架与门禁 (scripts) | 1 | 39 | 0 | — |
## 3. 常用工程脚本

| 命令 | 实际执行 |
| :--- | :--- |
| `npm run start` | `node bin/yunyu.mjs serve` |
| `npm run demo` | `node bin/yunyu.mjs demo` |
| `npm run demo:cli` | `node examples/cli-agent-collab.mjs` |
| `npm run audit` | `node bin/yunyu.mjs audit` |
| `npm run wiki` | `node bin/yunyu.mjs wiki` |
| `npm run plugins` | `node bin/yunyu.mjs plugin list` |
| `npm run connectors` | `node bin/yunyu.mjs connectors` |
| `npm run mcp` | `node bin/yunyu-mcp.mjs` |
| `npm run check` | `node scripts/check-syntax.mjs` |
| `npm run test:unit` | `node --test tests/unit/*.test.mjs` |
| `npm run test:integration` | `node --test tests/integration/*.test.mjs` |
| `npm run test` | `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs` |
| `npm run qa:ui` | `node tests/ui/cdp-ui-qa.mjs` |
| `npm run verify` | `npm run check && npm test && npm run qa:ui && npm run audit` |
> 本档案由云驭协同世界模型自动同步，完整修订时间线见页面元数据。
