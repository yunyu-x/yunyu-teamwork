# 测试验收评审结论 · QA 独立复核（v0.5.1）

> 评审角色：QA（只读验收，未修改 src/、web/、tests/、scripts/，未执行任何 git 写操作）
> 评审模型署名：**Step-5-Preview（测试角色）**
> 评审时间：2026-11-22 · 复核对象：主干 HEAD `5722fb7` + docs/acceptance/run-record.json（9 通过 / 0 失败 / 2 跳过）
> 本文件为 QA 唯一授权写入物（docs/acceptance/verdicts/testing.md）。

---

## 1. 验收结论

**有条件通过。** 三大门禁经本复核真实重跑全部零缺陷（语法直检退出码 0 / 测试 46/46 通过 / 全仓审计 100/100），自动化实测 9 关通过且 2 关跳过判定合理，当前主干达到可发布质量；但所有权越权审计（`auditChangedFiles`）与多作者同文件合并冲突缺少直接回归用例、`qa:ui` 未纳入本轮验收执行链，需按第 6 节条件补齐后方视为完整验收闭环。

---

## 2. 三大门禁命令真实执行结果

| 门禁 | 命令 | 退出码 | 关键输出摘要 |
| :--- | :--- | :--- | :--- |
| 语法直检 | `npm run check` | **0** | `[check-syntax] OK: 92 JS/MJS files passed node --check.` |
| 测试套件 | `npm test` | **0** | TAP：`# tests 46 / # pass 46 / # fail 0 / # cancelled 0 / # skipped 0`，总耗时约 11.9s（单元 15 文件 + 集成 9 文件，含真实 Git Worktree E2E 11.7s、重启恢复 3.3s） |
| 全仓审计 | `npm run audit` | **0** | `综合评分：100/100 · 世界模型健康度：100/100 · 结果：✅ PASS`；`扫描源码：67 个 · 发现：P0=0 / P1=0 / P2=0` |

环境说明：本次复核运行于 node v24.22.1（实测记录为 v22.16.0），均满足 `>= 22` 约束，门禁结果与原记录一致。

### qa:ui 静态评估（按任务约束未执行）

- 本机 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）与 Edge 均实际存在，脚本具备运行条件；未执行系任务约束，非环境缺失。
- 历史证据 `docs/benchmarks/latest-ui-qa-report.json`（executedAt 2026-11-22T11:07:50Z）：晚于 v0.5.1 代码提交（03:40Z）、早于纯文档提交（13:40Z），覆盖当前 web/ 状态。报告显示 desktop 九视图功能断言通过（Kanban 6 列、Issue 抽屉 Spec/标准/Diff/验收、知识库、世界模型 Wiki 8 页 + 爆炸半径 + 审计、插件 dry-run + Skill 查看 + 英文 i18n + Hook 拒绝、Graph、Members、GitLab 评论、Contract 越权拒绝）、mobile 390x844 五标签零水平溢出、`runtimeErrors: []`、9 张截图、耗时 22.5s。
- 判定：证据充分但未纳入本轮验收执行链，不可一键复现，列 P1-3。

---

## 3. 自动化实测记录证据充分性评审

### 3.1 逐关断言可复现性

| 关卡 | 断言强度 | 评估 |
| :--- | :--- | :--- |
| 0 doctor | 弱 | 仅版本探测，价值低但无害，可复现。 |
| 1 demo --once | 中 | 仅校验退出码 0 + 输出尾 4 行；真实 Worktree / GitLab Mock / MR 合并等关键行为无结构化断言（如分支名、MR 记录），"Mock 全链路已覆盖"的声称部分依赖输出文案而非可验证字段。 |
| 2 serve | 强 | health/metrics 200 + 响应体键校验 + UI HTML 特征，充分。 |
| 3 发帖 + SSE | 强 | 发帖 seq 回查 + SSE 首帧 `connected`，充分。 |
| 4 唤醒 + Worktree | 中强 | 15s 轮询等到回帖，充分；但 `worktreeSample` 取到的是 `pm`（main 分支）而非 `sim-worker` 的隔离分支，隔离性仅靠 `worktreeCount=2` 间接佐证，证据不精确。 |
| 5 Issue/DAG/熔断 | 强 | 六态等值比较、依赖 409、解锁复验、熔断负向断言，充分；熔断用固定 3s sleep，慢速驱动下有假阳性风险（P2-7）。 |
| 6 知识库 | 强 | 写入 + 检索命中 + events.jsonl 行级 `knowledge_add` 校验，充分。 |
| 7 世界模型/Wiki/审计 | 中 | impact 键存在 + wikiPages=6；`worldFiles: null`（refresh 响应不含预期键）、`auditScore: 90` 无扣分明细（P2-8）。 |
| 8 插件/连接器/dry-run | 强 | dry-run 后 `.mcp.json` 不存在即非破坏性失效防护，断言设计良好。 |

### 3.2 Skip 判定合理性

- **第 9 关（真实 GitLab）**：环境无 `GITLAB_BASE_URL/TOKEN/PROJECT_ID`，跳过合理；Mock 全链路在第 1 关 + 测试套件（#3 Webhook 验签、#6 GitLab E2E、#5 重启恢复 GitLab Client/Sync）已双重覆盖。但脚本第 219 行 `gitlabConfigured ? 'skip' : 'skip'` 恒为 skip——即使配置了凭据也不会执行，仅文案不同（P2-4）。
- **第 10 关（Docker）**：本机无 docker CLI，跳过合理；Dockerfile/compose 为静态资产且经审计器读取。但零自动化冒烟（P2-6）；且 README 声称"人工补测步骤见 HANDOFF §5 与实测路线图"——HANDOFF §5 仅含容器化部署命令，并不存在独立的实测路线图文档，真实 GitLab 的逐步补测 SOP 缺失（P2-6）。

### 3.3 关键路径点名核查

| 关键路径 | 实测覆盖 | 既有测试覆盖 | 判定 |
| :--- | :--- | :--- | :--- |
| 所有权越权审计 | 第 1 关 "QA 拦截返工"（仅输出尾佐证） | `checkWrite` 角色隔离充分（#20/#27/#36）；`auditChangedFiles` 仅经 `commitChanges` 传递覆盖（worktree.test.mjs:30）；`pushBranch`/`mergeToBase` 的越权拦截（worktree.mjs:485/555）**零用例** | **P1-1 缺口** |
| 看门狗停机 | 未直接测 | #25（`[done]` 停机 + 同 head 防抖）+ #24（30s→480s 指数退避 16x 封顶 + 门禁解除复位） | 覆盖充分 |
| 多作者 Worktree 冲突 | 第 4 关单隔离 worktree | #43 单作者 clean merge + 未合并改动保护；#6 并行作者 E2E（异文件）；**同文件冲突零用例** | **P1-2 缺口** |
| 预算熔断边界 | 第 5 关 maxTurns=1 → exceeded + 唤醒阻断 | #13 token 熔断 + 成员 STOPPED + budgetExceeded 元数据；maxTurns 维度与等号边界无单测 | P2-5 缺口 |

---

## 4. 实测流程与既有测试套件的重叠与缺口

**重叠（分层互补，健康）**：stage 5 ↔ #34/#35（六态/DAG/TTL）+ #13（预算）；stage 4 ↔ #25（看门狗）+ #43（Worktree）；stage 6 ↔ #14（知识库追加持久化）；stage 7 ↔ #44/#45/#46（世界模型/Wiki/审计器）；stage 8 ↔ #28–#32（插件/连接器/MCP 客户端/Hook）；stage 1 ↔ #6（GitLab E2E）+ showcase；stage 2/3 ↔ #3/#7（REST/SSE）。实测走 HTTP API 面、单测走模块面，重复成本可接受。

**缺口（实测与套件两边均无）**：见第 5 节 P1/P2 清单。

---

## 5. 覆盖缺口与风险清单

### P0（阻塞发布）：无

### P1（发布前应补齐）

| id | 缺口 | 风险 |
| :--- | :--- | :--- |
| P1-1 | `OwnershipGuard.auditChangedFiles` 无直接单测；`pushBranch`/`mergeToBase` 的越权拦截路径零用例 | AGENTS.md 不变量 4 点名该机制为"提交、推送与合并前必须通过"的强制审计，目前仅靠 commitChanges 抛错消息间接覆盖；若重构返回值结构或漏接守卫，无回归网捕获 |
| P1-2 | 多作者并发写同一文件的 Worktree 合并冲突无回归用例 | 并发作者场景（不变量 4 的核心场景）下冲突处理行为未知，存在静默丢改动或合并错乱风险 |
| P1-3 | `qa:ui` 未纳入本轮验收执行链（AGENTS.md 提交前验证命令包含该项，`npm run verify` 未完整跑过） | 验收闭环不可一键复现；虽有同日 11:07Z 零错误报告佐证，但证据链未正式归档引用 |

### P2（随迭代补齐）

| id | 缺口 | 风险 |
| :--- | :--- | :--- |
| P2-4 | manual-test-run.mjs 第 9 关恒跳过（`gitlabConfigured ? 'skip' : 'skip'`） | 配置凭据后仍不执行，误导后续验收者 |
| P2-5 | 预算熔断边界缺测：tokens 恰等于 maxTokens 的等号语义、maxTurns=0、负值/畸形预算配置 | 边界行为依赖实现细节，无文档化断言 |
| P2-6 | Docker 零自动化冒烟；第 9/10 关人工补测 SOP 缺失（README 引用的"实测路线图"文档不存在） | 容器化交付与真实 GitLab 联动质量无任何执行级证据 |
| P2-7 | 第 5 关熔断用固定 3s sleep + "未回复即通过"负向断言 | 慢速/异步驱动下假阳性（熔断失效被漏放行） |
| P2-8 | 第 7 关 `worldFiles: null`、`auditScore: 90` 无扣分明细 | 证据字段缺失，无法判断沙盒审计扣分是否预期内 |
| P2-9 | MCP 工具数（文档声称 37）仅断言客户端侧 mock（v050:211），真实 `YunyuMcpServer` 的 tools/list 无数量断言 | 文档-实现漂移无测试捕获 |
| P2-10 | 插件计数口径不一致：UI QA 报告 plugins=3 vs run-record/health pluginCount=2，未注明原因 | 证据互相矛盾，损害验收记录可信度 |

---

## 6. 建议待办项（可并入 docs/review/backlog.json）

| id | 标题 | 优先级 | 验收标准 |
| :--- | :--- | :--- | :--- |
| T-01 | 补齐 `OwnershipGuard.auditChangedFiles` 直接回归用例 | P1 | 新增用例覆盖：author 改动 mustNotTouch 路径时，`commitChanges`/`pushBranch`/`mergeToBase` 三条路径均抛拦截且 `violations` 含 path/reason；verifier 写 src/ 在三条路径全部被拒；`npm test` 全绿 |
| T-02 | 多作者同文件 Worktree 合并冲突回归 | P1 | 两 author 各自隔离 worktree 修改同一文件，`mergeToBase` 遇 git 冲突时返回明确冲突错误且任一侧未合并改动不丢失；`npm test` 全绿 |
| T-03 | qa:ui 纳入本轮验收执行链 | P1 | `npm run verify` 全量跑通，最新 `latest-ui-qa-report.json` 时间戳与结论引用写入 docs/acceptance/README.md；或在 README 注明引用 2026-11-22T11:07:50Z 报告并附"web/ 自该报告后未变更"的 git 证据 |
| T-04 | 修复 manual-test-run.mjs 第 9 关恒跳过逻辑 | P2 | `gitlabConfigured` 为 true 时记录 `manual-only` 或实际执行，evidence 不再双分支同值；重跑 `node scripts/manual-test-run.mjs` 记录状态正确 |
| T-05 | 预算熔断边界用例 | P2 | 覆盖 tokens==maxTokens 等号语义、maxTurns=0、负值/畸形预算配置的校验行为，断言写入 tests/unit/budget-knowledge-research.test.mjs |
| T-06 | Docker 冒烟 + 第 9/10 关补测 SOP | P2 | 具备 docker 的节点执行 `docker build` 冒烟并归档日志；HANDOFF §5 或新增实测路线图文档写明第 9/10 关逐步人工补测步骤与预期断言 |
| T-07 | 第 5 关熔断验证改事件驱动 | P2 | 以 waitFor 轮询替代固定 3s sleep，超时 ≥15s，失败时输出诊断信息；重跑实测记录 `breakerBlockedWake` 仍为 true |
| T-08 | 第 7 关证据字段补全 | P2 | run-record.json 中 `worldFiles` 记录非 null；`auditScore < 100` 时附带扣分项明细 |
| T-09 | MCP 工具数漂移断言 | P2 | tests/integration/mcp-server.test.mjs 断言真实 `YunyuMcpServer` tools/list 数量与文档（37）一致 |
| T-10 | 插件计数口径统一 | P2 | health / `plugin list --json` / UI 三处 pluginCount 口径一致，或在文档注明差异原因 |

---

## 7. 署名

评审模型：**Step-5-Preview（测试角色）**
复核方式：三大门禁命令真实重跑 + 实测记录逐关证据评审 + tests/ 46 用例覆盖映射 + src/ 关键守卫路径只读核查；全程未编辑 src/、web/、tests/、scripts/，未执行 git commit/push 等写操作。
