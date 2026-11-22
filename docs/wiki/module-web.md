<!-- yunyu-wiki slug=module-web version=1 category=module updatedAt=2026-11-22T11:07:02.553Z -->
# 模块域详解：Web 协同看板前端 (web)

- 文件数：12 · 总行数：6245 LOC · 导出符号：34
- 依赖下游域：无外部域依赖（底层独立域）
- 被上游域调用：顶层入口域

## 文件清单与符号契约

| 文件 | 行数 | Fan-In | Fan-Out | 导出符号 |
| :--- | ---: | ---: | ---: | :--- |
| `web/app.js` | 1014 | 0 | 11 | — |
| `web/graph.js` | 166 | 3 | 0 | `colorForNode`, `renderCollaborationGraph` |
| `web/i18n.js` | 201 | 8 | 0 | `I18N`, `t` |
| `web/lib/state.js` | 157 | 8 | 0 | `$`, `KANBAN_ORDER`, `api`, `escapeHtml`, `formatRichText`, `formatTime` |
| `web/views/board.js` | 116 | 1 | 3 | `renderBoard`, `renderMessageCard` |
| `web/views/contract.js` | 162 | 1 | 2 | `renderContract` |
| `web/views/gitlab.js` | 201 | 1 | 2 | `loadIssueNotes`, `renderGitLab` |
| `web/views/kanban.js` | 459 | 1 | 2 | `closeIssueDrawer`, `formatUnifiedDiff`, `openIssueDrawer`, `renderIssueDrawer`, `renderKanban` |
| `web/views/knowledge.js` | 123 | 1 | 2 | `renderKnowledge` |
| `web/views/members.js` | 185 | 1 | 3 | `renderAgentLogs`, `renderMemberModalHelpers`, `renderMembers`, `renderSavedTwinsBar`, `syncMemberModalDynamicFields` |
| `web/views/plugins.js` | 818 | 1 | 1 | `handlePluginClick`, `loadPluginsOverview`, `renderPluginsView` |
| `web/world-wiki.js` | 529 | 1 | 1 | `renderSafeMarkdown`, `renderWorldWikiView` |
