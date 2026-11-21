---
name: zero-dep-chinese-first
description: 严守零外部运行时依赖、只读角色源码隔离与默认简体中文汇报铁律
alwaysApply: true
---
# 核心工程规则（Always Apply）

- 严禁在 `package.json` 的 `dependencies` 中引入任何外部 npm 运行时包，所有运行时能力必须基于 Node.js `>= 22.0.0` 内置模块实现。
- `verifier` / `qa` / `reviewer` / `researcher` 角色严禁修改 `src/` 与 `web/`，发现缺陷必须通过 `@author` 开具结构化缺陷单。
- 面向人类的汇报、任务书、Wiki 与审计结论默认使用清晰简洁的简体中文，技术标识符（路径、SHA、命令、JSON 键名）保留英文原文。
