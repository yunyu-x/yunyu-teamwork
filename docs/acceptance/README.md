# 人工实测路线图 · 自动化执行记录

> 运行时间：2026-11-22T14:00:15.410Z → 2026-11-22T14:00:32.206Z · 版本 v0.5.1 · win32/x64 node v22.16.0
> 机器可读记录：[run-record.json](run-record.json) · 执行脚本：`node scripts/manual-test-run.mjs`

**结果：9 通过 / 0 失败 / 2 跳过（第 9/10 关按环境裁定）**

| 关卡 | 项目 | 结果 | 关键证据 |
| :--- | :--- | :--- | :--- |
| 0 | doctor 环境自检 | ✅ 通过 | {"node":"v22.16.0","git":"git version 2.47.0.windows.2","cliAgents":{"claude":"2.1.37 (Claude Code)","codex":"codex-cli 0.144.6","gemini":"未安装"}} |
| 1 | demo --once 离线全链路冒烟（真实 Worktree + GitLab Mock + 世界模型） | ✅ 通过 | {"exitCode":0,"outputTail":"   🌳 真实沙盒 Git 仓库：              C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\yunyu-demo-repo-mGO674 \|    📨 已生成留言板记录：               13 条（含架构冻结 → Worktree 并行开发 → QA 拦截返工 → MR 合并） \|  \| 提示：按 Ctr |
| 2 | serve 启动 + health/metrics/UI 可达 | ✅ 通过 | {"url":"http://127.0.0.1:12277","health":{"ok":true,"name":"yunyu-teamwork","version":"0.5.1","node":"v22.16.0","uptimeSec":11,"swarmCount":0,"drivers":[{"id":"openai-compatible","description":"通用 OpenAI 协议兼容大模型驱动（支持 Dee |
| 3 | 创建蜂群 + 人类成员发帖 + SSE 实时流 | ✅ 通过 | {"swarmId":"acceptance","postSeq":2,"sseFirstFrame":"event: connected","boardCount":2} |
| 4 | simulated 成员招募 + @mention 事件唤醒 + 隔离 Worktree | ✅ 通过 | {"triggerSeq":5,"replySeq":6,"replyExcerpt":"@coordinator 收到 #5：已在独立工作区完成对应模块实现并自测通过（成员 `sim-worker`，工作区模式 `share`）。","worktreeCount":2,"worktreeSample":{"member":"pm","branch":"main"}} |
| 5 | Issue 六态流转 + DAG 依赖 409 + 验收解锁 + 预算熔断 | ✅ 通过 | {"lifecycle":["backlog","ready","in_progress","review","done"],"expectLifecycle":["backlog","ready","in_progress","review","done"],"depBlocked409":409,"downstreamUnlocked":true,"budgetStatus":"exceeded","breakerBlockedWa |
| 6 | 知识库 pitfall 写入 + 检索 + JSONL 追加持久化 | ✅ 通过 | {"entryId":"kb-fca07d","searchHits":1,"jsonlLines":23,"appendOnlyPersisted":true} |
| 7 | 世界模型刷新 + 爆炸半径模拟 + Wiki 生成 + 全仓审计 | ✅ 通过 | {"worldFiles":null,"impactKeys":["targetPaths","missingTargets","directDependents","transitiveImpacted","impactedTests","affectedDomains","notifiedOwners","invariantWarnings","totalImpactedFiles","riskLevel"],"wikiPages" |
| 8 | 插件清单 + 连接器探测 + claude-code dry-run 同步（沙盒非破坏） | ✅ 通过 | {"pluginCount":2,"builtinPacks":["teamai-sync-pack","yunyu-engineering-pack"],"connectorCount":8,"syncDryRun":true,"syncKeys":["harnessId","harnessName","targetDir","dryRun","plannedFiles","writtenFiles","counts"],"noFil |
| 9 | 真实 GitLab 双向联动 | ⏭️ 跳过 | 环境未配置 GITLAB_BASE_URL/GITLAB_TOKEN/GITLAB_PROJECT_ID；第 1 关 demo 已覆盖本地 GitLab Mock 全链路 |
| 10 | Docker 容器化部署 | ⏭️ 跳过 | 本机 docker CLI 不可用；Dockerfile/compose 静态资产已随 v0.5.1 交付并通过审计 |

## 验收交接说明

- 本记录由协调者自动生成，供架构 / 设计 / 开发 / 测试各角色 Agent 做闭环验收；各角色结论写入 `docs/acceptance/verdicts/<role>.md`。
- 第 4 关使用 `simulated` 确定性驱动验证唤醒/调度/Worktree 机制本身；真实异构模型成员（CLI/LLM）的行为验收由多模型验收会话承担。
- 第 9 关（真实 GitLab）与第 10 关（Docker）为环境受限跳过，Mock 全链路已在第 1 关覆盖；人工补测步骤见 HANDOFF §5 与实测路线图。
