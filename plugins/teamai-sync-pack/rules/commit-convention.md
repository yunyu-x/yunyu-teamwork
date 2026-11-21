---
name: commit-convention
description: Conventional Commits 提交规范与 Worktree 隔离合入约束
globs:
  - src/**
  - web/**
  - docs/**
alwaysApply: false
---
# 提交与分支合并规范

- 所有提交遵循 Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`。
- 禁止向受保护分支（`main` / `master` / `release/*`）强推（`--force`），并发改动统一在 `yunyu/<swarm>/<member>` 隔离工作树内完成并通过 `OwnershipGuard` 审计后合并。
