# 贡献指南（Contributing to Yunyu Teamwork）

欢迎为 **云驭协同（Yunyu Teamwork）** 贡献代码、驱动适配器、GitLab 扩展或文档！

## 开发环境要求
- **Node.js `>= 22.0.0`**（零第三方 `npm install` 依赖）
- **Git `>= 2.30`**（用于 `git worktree` 隔离测试）
- 可选：本机 Chromium / Chrome / Edge（用于 `npm run qa:ui` 自动化前端视觉验收）

## 本地开发流程
1. Fork 仓库并创建特性分支（如 `feat/driver-ollama` 或 `fix/gitlab-webhook`）。
2. 在修改前先阅读 [AGENTS.md](AGENTS.md)，确认改动符合模块边界与六条工程不变量。
3. 编写对应单元测试或集成测试（位于 `tests/unit/` 或 `tests/integration/`）。
4. 运行完整验证门禁：
   ```bash
   npm run verify
   ```
5. 提交清晰的 Commit Message（推荐使用 Conventional Commits，如 `feat(gitlab): support draft MR status sync`）并提交 Merge Request / Pull Request。
