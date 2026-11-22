# 现有文档资产对比分析与整合决策（Doc Comparison & Consolidation）

> 评审基线日期：2026-11-22 · 对应版本：`v0.5.1`（`package.json:3`、`src/core/constants.mjs:1`）
> 本文是 [架构基线](01-architecture-baseline.md) 与 [企业级路线图](03-enterprise-roadmap.md) 的配套对比档案。
> 所有结论均附文件与行号证据，供人类与 Agent 直接复核。

---

## 1. 文档资产盘点

| 文档 | 定位 | 内容覆盖版本 | 新鲜度评估 | 主要问题 |
| :--- | :--- | :--- | :--- | :--- |
| [AGENTS.md](../../AGENTS.md) | 架构契约 + 6 条硬不变量 + 文件所有权 | v0.5.x | ✅ 与代码一致 | 无显著漂移；是最高优先级契约 |
| [README.md](../../README.md) / [README.en.md](../../README.en.md) | 门面 + 快速上手 | v0.5.1 | ✅ 已对齐（2026-11-22 修复） | 原徽章/工具数/视图数漂移已修复并补 v0.5.1 加固亮点（见 §2 修复记录） |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | 架构深潜 | v0.5.1（2026-11-22 依据 01 基线重写，D-01） | ✅ 与代码一致 | 原 v0.2 滞后已消除；7 驱动/全层拓扑/4 只读角色 |
| [docs/PROTOCOL.md](../PROTOCOL.md) | 5 种接入协议 + REST 速查 | v0.5.1 | ✅ 准确 | `/api/metrics` 已补（D-03）；37 工具数与实测一致 |
| [docs/PLUGINS_AND_TEAMAI.md](../PLUGINS_AND_TEAMAI.md) | 插件/连接器/Hook 指南 | v0.5.0 | ✅ 准确 | 与 `src/plugins/` 实现对应良好 |
| [docs/BENCHMARK_AND_INTEGRATION.md](../BENCHMARK_AND_INTEGRATION.md) | 行业对标白皮书 | **仅到 v0.3.0** | ⚠️ 半滞后 | v0.4（世界模型/Wiki/审计/分身）与 v0.5（插件生态）未纳入对标矩阵 |
| [docs/GITLAB_INTEGRATION.md](../GITLAB_INTEGRATION.md) | GitLab 集成指南 | v0.2+ | ✅ 基本准确 | 未提及 GitHub 适配器规划（HANDOFF v0.6.0 项 1） |
| [docs/HANDOFF.md](../HANDOFF.md) | 交接快照 + 15 坑点 + 部署 + 路线图 | v0.5.1 | ✅ 最新最权威 | §6 已收敛为 backlog.json 唯一事实源引用（D-06）；§4 增补坑点入库流程约定 |
| [docs/wiki/*](../wiki/README.md)（14 页） | 世界模型自动导出活文档 | v0.5.1（2026-11-22 再生成） | ✅ 自动生成 | 15 坑点已回流 KnowledgeVault，决策页精选收录（D-04，见 §3.2） |
| [SECURITY.md](../../SECURITY.md) | 安全控制清单 | v0.5.1 | ✅ 准确 | v0.5.1 限流/强制鉴权/metrics/非 root 容器条目已补（D-03） |
| [CHANGELOG.md](../../CHANGELOG.md) | 版本史 | v0.5.1 | ✅ 准确 | — |
| 附件 `docs/temp/Genie-Teamwork多智能体协作方案.html.crdownload` | 外部方案（用户提供） | — | ❌ **不可用** | 95,507 字节全为 0x00（Chrome 中断下载的空占位文件），无任何可解析内容；已请用户重新提供，见 §4 |

---

## 2. 已证实的不一致清单（逐项证据）

> ✅ **2026-11-22 修复记录**：§2.1–§2.5 所列漂移已全部修复——ARCHITECTURE.md 已依据 01 基线重写至 v0.5.1（D-01）；README 中英文徽章 0.5.1 / 37 工具 / 9 视图已对齐并补 v0.5.1 加固亮点（D-02 文档部分）；PROTOCOL.md 已补 `/api/metrics`、SECURITY.md 已补 v0.5.1 条目（D-03）；HANDOFF §6 已收敛为 backlog.json 引用（D-06）。**剩余**：审计器文档一致性门禁（D-02 的 auditor.mjs 扩展）仍待实施。以下保留原始证据供追溯。

### 2.1 版本号漂移
- `README.md:6` 与 `README.en.md:6` 徽章均为 `Version-0.5.0`；实际 `package.json:3` 与 `src/core/constants.mjs:1` 均为 `0.5.1`。
- **根因**：`src/core/auditor.mjs:375-389` 的版本一致性检查覆盖 `constants.mjs`、`bin/yunyu.mjs`、`src/server/routes.mjs` 与 `src/mcp/server.mjs` 的版本字面量，**但不检查 README 徽章与文档中的工具数/视图数等派生数字**，故 `npm run audit` 100/100 仍放行漂移（本次评审新增 docs/review/ 后实测审计仍 100/100 PASS，佐证此盲区）。

### 2.2 MCP 工具数漂移
- `README.md:115` 写「30 个 MCP 工具」；实测 `MCP_TOOLS.length === 37`（`src/mcp/server.mjs`，本次评审运行时验证），`README.md:10` 徽章与 `docs/PROTOCOL.md:30` 均为 37。同一文件内部自相矛盾。

### 2.3 视图数漂移
- `README.md:63`「全部 8 大实时视图」、`README.md:165`「全 8 视图」、`README.en.md:45`「all 8 real-time views」；而 `README.md:34` 标题、`AGENTS.md`、`docs/HANDOFF.md:68` 均为 **9 视图**（v0.5.0 新增 Plugins 视图后未同步旧文案）。

### 2.4 ARCHITECTURE.md 结构性滞后（最严重）
- §2.5 仅列 **5 种驱动**（openai-compatible / cli-agent / webhook / human / simulated）；实际为 **7 种**（缺 `research-synthesizer`、`digital-twin`，见 `src/drivers/` 与 HANDOFF §3）。
- §1 总体拓扑图完全缺失 v0.3–v0.5 的核心层：Issue 中心（tasks）、预算治理（budget）、知识库（knowledge）、情报引擎（research）、世界模型（world-model）、活文档 Wiki（wiki）、审计器（auditor）、数字分身（twins-store）、插件控制平面（src/plugins）、6 渠道 IM 网桥（src/channels）。
- §2.2 只写 `verifier`/`qa` 被禁改源码；实际守卫覆盖 `verifier`/`reviewer`/`researcher`/`qa` 四角色（AGENTS.md 不变量 #3 与 SECURITY.md 均已更新）。
- **结论**：ARCHITECTURE.md 不能作为当前架构讨论基线，本评审以 [01-architecture-baseline.md](01-architecture-baseline.md) 取代其「现状描述」职能，并开具重写待办（ROADMAP D-01）。

### 2.5 其他小项
- `docs/PROTOCOL.md` §5 REST 速查缺 v0.5.1 新增 `GET /api/metrics`。
- `SECURITY.md` 未收录 v0.5.1 的限流、非回环强制鉴权、Docker 非 root 交付。
- `docs/HANDOFF.md:119` 路线图用 `~~删除线~~ + ✅` 手工标记完成态，无 ID、无优先级、无验收标准，Agent 无法直接消费。

---

## 3. 双源分叉与知识回流缺口

### 3.1 手写文档 vs 自动 Wiki 的职责边界（整合决策）
当前 `docs/*.md`（手写）与 `docs/wiki/*`（世界模型自动导出）并存但**无明确分工声明**，读者（含 Agent）不知道以哪个为准。整合决策：

| 层 | 唯一事实源 | 更新方式 |
| :--- | :--- | :--- |
| 工程契约与不变量 | `AGENTS.md` | 人工评审修订 |
| 模块拓扑/导出符号/LOC 指标 | `docs/wiki/*`（自动） | `npm run wiki` 再生成，**禁止手改** |
| 架构叙事与设计决策 | `docs/ARCHITECTURE.md`（待重写）+ ADR | 人工 + 评审 |
| 运维/交接/坑点 | `docs/HANDOFF.md` | 每版本追加 |
| 演进规划与待办 | `docs/review/03-enterprise-roadmap.md` + `backlog.json` | 本评审建立，后续按 Issue 流转 |

### 3.2 坑点知识未回流活文档
`docs/wiki/decisions-and-pitfalls.md` 显示「共享知识库暂无条目」，而 `docs/HANDOFF.md` §4 已沉淀 **15 个带回归测试的坑点**。这些是高价值 `pitfall`/`adr` 类知识，应通过 `knowledge_save` 写入 KnowledgeVault 再由 Wiki 引擎自动收录，否则每个新会话 Agent 都要重读 HANDOFF 全文（上下文浪费），且 Wiki「决策档案」页名不副实。→ 待办 D-04。

> ✅ **2026-11-22 已回流（D-04 交付）**：15 条 pitfall 追加式写入 `.yunyu/swarms/project-knowledge/events.jsonl`；`bin/yunyu.mjs cmdWiki` 新增 `loadRepoKnowledge` 接线（按目录扫描 `knowledge_add` 事件，兼容无 meta.json 的知识沉淀蜂群）；`npm run wiki` 后决策页精选收录最新 12 条（全量 15 条入库可检索）；HANDOFF §4 增补「新增坑点必须入库」流程约定。

---

## 4. 附件 Genie-Teamwork 方案对比（用户已决定跳过）

- 文件 `docs/temp/Genie-Teamwork多智能体协作方案.html.crdownload` 经字节级校验：**95,507 字节全部为 0x00**，系下载中断产生的稀疏占位文件，无 HTML/文本可提取。
- 已向用户询问补充方式，用户选择**稍后重新提供文件**。
- **溯源排查记录（2026-11-22，10 条途径全部落空，后续 Agent 请勿重复搜索）**：
  1. Chrome / Edge 全部 Profile 的 `downloads` 表：无该文件下载记录（说明并非经这两个浏览器正常下载）；
  2. Chrome `urls` 浏览历史：无「Genie-Teamwork / 协作方案」相关页面访问记录；
  3. 全盘文件名搜索（`D:\workspace`、用户目录、Downloads/Desktop/Documents、微信接收目录 `xwechat_files`）：无其他副本；
  4. WorkBuddy/Genie 应用数据（`%APPDATA%\@genie`、`~/.workbuddy` 含 sessions/artifact-index/workbuddy.db）：无该方案产物或引用；
  5. Qoder 附件缓存（`com.qodercn.app.stable/chat-user-attachments`）：仅 PNG 截图，无 HTML；
  6. Qoder 会话转录与 turn payload 缓存：附件仅以路径引用出现，无内联正文；Qoder 协作消息/文件缓存数据库（collaboration-message-cache.sqlite）所有文件与消息表均为 0 行；
  7. 联网搜索「Genie-Teamwork 多智能体协作方案」：无公开来源；
  8. **同名消歧**：搜索命中的 Google 开源 **Teamwork** 框架（生成-测试-组合循环、对抗性批评、动态团队规模）是**另一事物**，与本附件（用户内部方案文档，推测与 genie-mcp/genie-memory 项目族相关）无关，**严禁以其内容冒充本附件做对比**。
- 结论：文件内容在本机不可恢复。**用户决定（2026-11-22）：参考文件缺失，先跳过本项对比**；G-01 转为 deferred，文件监视器已停止。下方对比框架保留，用户补充有效文件后可直接重启 G-01。
- **预留对比框架**（拿到内容后按此填充，不影响其余交付）：
  1. 协作模型对比：消息拓扑（共享留言板 vs 其方案）、唤醒机制、任务分派与验收闭环；
  2. 隔离与安全对比：Worktree/所有权守卫 vs 其方案的沙箱与权限模型；
  3. 项目管理能力对比：Issue 生命周期、看板、预算、审计 vs 其方案的企业能力（组织/审批/报表等）；
  4. 可吸收长处 → 转化为 backlog 条目；冲突主张 → 记录 ADR 决策。

---

## 5. 对比结论摘要

1. **代码与契约（AGENTS.md/HANDOFF/SECURITY/CHANGELOG）高度一致**，工程纪律好；漂移集中在**门面文档（README）与架构叙事（ARCHITECTURE.md）**。
2. 审计器「100/100」对文档漂移盲区 → 需要把**文档一致性纳入自动门禁**（D-02），这与本项目「活文档」主张自洽。
3. 知识双源（HANDOFF 坑点 vs 空 Wiki 决策页）需要一次性回流 + 建立「坑点必须入库」的流程约定（D-04）。
4. 路线图需要从散文式升级为**结构化 backlog**（本评审 `backlog.json` 已建立），可直接派生为 Qoder Issue。