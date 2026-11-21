<!-- yunyu-wiki slug=module-gitlab version=1 category=module updatedAt=2026-11-21T16:35:47.313Z -->
# 模块域详解：GitLab 双向集成层 (src/gitlab)

- 文件数：5 · 总行数：749 LOC · 导出符号：10
- 依赖下游域：`core` (4条边)
- 被上游域调用：`core` (3条边), `bin` (1条边), `demo` (1条边), `server` (1条边)

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `src/gitlab/client.mjs` | 153 | 3 | 1 | `GitLabClient` |
| `src/gitlab/index.mjs` | 5 | 6 | 4 | `GitLabClient`, `GitLabMockServer`, `GitLabSyncService`, `translateGitLabWebhook`, `verifyGitLabWebhookToken` |
| `src/gitlab/mock-server.mjs` | 320 | 1 | 0 | `GitLabMockServer` |
| `src/gitlab/sync.mjs` | 86 | 2 | 1 | `GitLabSyncService` |
| `src/gitlab/webhook.mjs` | 185 | 2 | 2 | `translateGitLabWebhook`, `verifyGitLabWebhookToken` |
