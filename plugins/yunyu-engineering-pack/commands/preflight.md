---
name: preflight
description: 发布前全量自检命令：语法直检、单测/集成测试、UI 验收与全仓审计
---
请依次核对以下发布前门禁并向 `@coordinator` 汇报结果：
1. 调用 `project_audit` 确认评分 `100/100` 且 `P0=0 / P1=0`。
2. 调用 `world_model_overview` 确认模块依赖图为无环 DAG（`cyclesCount === 0`）。
3. 核对 `npm run verify` 全绿且无未归档变更。
