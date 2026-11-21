---
name: tdd-guard
description: 红绿重构测试驱动开发技能：写生产代码前先补齐失败单测与边界断言
tags: [tdd, test, quality, unit, refactor]
triggers: [测试, 单测, 修复, bug, 重构, test]
globs:
  - src/**
  - tests/**
---
# TDD 红绿重构工程技能

1. **RED（先写失败测试）**：在修改任何 `src/**` 源码之前，先在 `tests/` 中编写能精确复现缺陷或定义新行为的 `node:test` 测试用例并运行确认失败。
2. **GREEN（最小实现转绿）**：编写满足契约与安全边界的最小清晰实现，重新运行 `node --test` 确认全部通过。
3. **REFACTOR & VERIFY（重构与全量门禁）**：运行 `npm run verify`（语法直检 + 单元/集成测试 + UI QA + `npm run audit` 100/100）确认零回归后再提交。
