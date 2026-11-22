# 企业级演进评审档案（Review Dossier）

> 2026-11-22 · 基线版本 v0.5.1 · 供架构、开发、QA、安全、SRE、产品与各类 AI Agent 讨论使用。
>
> **入口已接线**：[README.md](../../README.md) / [README.en.md](../../README.en.md) 文档导航与 [docs/HANDOFF.md](../HANDOFF.md) §6 均已链接本档案与 backlog.json（2026-11-22 完成，接线后 `npm run audit` 复测 100/100 PASS）。

## 阅读顺序

| 文档 | 内容 | 适合谁 |
| :--- | :--- | :--- |
| [01-architecture-baseline.md](01-architecture-baseline.md) | 与代码实测一致的架构基线：拓扑、运行时机制、接口面、信任模型、隐含 ADR、开放议题 | 所有角色（讨论共同出发点） |
| [02-doc-comparison.md](02-doc-comparison.md) | 现有文档资产盘点、逐项不一致证据、双源分叉整合决策、Genie 附件对比框架 | 架构 / 文档 / DX |
| [03-enterprise-roadmap.md](03-enterprise-roadmap.md) | 八视角批判 + 独立对抗复核、企业级差距矩阵、四阶段路线图、39 项待办、6 个决策门 | 决策者 / 全体 |
| [04-enterprise-pm-benchmark.md](04-enterprise-pm-benchmark.md) | 企业 PM 平台能力对标（Jira/Linear/GitLab/飞书项目/Teambition/PingCode）：采购门槛、范围裁定、agent 成本归集差异化赛道 | 产品 / 决策者 |
| [backlog.json](backlog.json) | 机器可读待办（ID/优先级/证据/验收标准/依赖/所有权），可直接派生 Qoder Issue | AI Agent / 协调者 |

## 使用约定

1. **讨论**：对基线或路线图的异议，请在对应文档章节补充「讨论注记」或在蜂群留言板 `@architect` 引用本目录文件路径；结论落入 backlog 或 ADR，不散落。
2. **认领**：Agent 按 `backlog.json` 的 `ownerRole` 与 AGENTS.md 文件所有权认领；QA/Verifier/Reviewer/Researcher 只验收不实现（硬不变量 #3）。
3. **更新**：待办状态变更同步更新 `backlog.json` 与 03 文档表格；`docs/wiki/*` 由 `npm run wiki` 再生成，禁止手改。
4. **跳过项**：G-01（Genie-Teamwork 附件对比）经用户决定（2026-11-22）跳过——附件缺失；对比框架保留在 02 文档 §4，文件补充后可重启。

## 关键结论速览

- 代码与工程契约高度一致、0 循环依赖、安全执行面防护同类领先；漂移原集中在门面文档（README 徽章/工具数/视图数、ARCHITECTURE.md 停留在 v0.2）——**2026-11-22 已全部修复**（D-01/D-03/D-04/D-06 交付，D-02 文档部分完成；剩余 D-02 审计器文档一致性门禁待实施）。
- 五个 P0 信任缺口：**双进程无锁写同一数据目录、密钥明文落盘、author 可冒充、Webhook 异步回调无鉴权且出站无超时、崩溃恢复静默丢数据**。
- 独立对抗复核（第二评审 Agent）另证实 6 个运行时盲区：SSE 断线丢事件、GitLab 镜像静默失败+标签竞态、日志无轮转+meta 写放大、POSIX 孙进程泄漏、`?token=` 查询串鉴权泄密、agent-logs 权限未收紧（详见 01 基线 §7.1）。
- 企业级最大差距：身份/RBAC/SSO、项目管理决策面（里程碑/报表/审批流）、存储索引与扩展性。
- 企业 PM 对标（04 文档）：RBAC+SSO+审计是六家平台一致的采购硬门槛；**agent token/成本按 Issue/成员归集报表**是六家均无的差异化赛道；E-04/E-07 够用就好、E-06 只做人机混合审批，避免过度建设。
- 零依赖不变量与企业诉求可兼容：`node:sqlite`（Node 内置）是存储破局点，需决策门 D2 确认（含 engines 下限与同步 API 张力）。
- 质量门禁实测（2026-11-22）：新增本评审档案后 `npm run audit` 仍 100/100 PASS、`npm test` 46/46 通过——同时佐证「审计不查文档一致性」盲区（待办 D-02）。

## 目标覆盖审计（2026-11-22）

> 对照用户原始目标逐项映射交付物与证据；附件对比项（G-01）经用户决定跳过，其余全部覆盖。

| 目标要求 | 交付物 | 证据 | 状态 |
| :--- | :--- | :--- | :--- |
| 整体架构梳理分析 | [01-architecture-baseline.md](01-architecture-baseline.md)（192 行） | 143 文件/30,456 行/268 依赖边/0 循环实测；关键论断带源码行号；含 §7.1 六个运行时盲区 | ✅ |
| 供各类人和 agents 讨论的文档 | 本索引 + 5 文档 + backlog.json；使用约定（讨论/认领/更新/阻塞） | README（中英）与 HANDOFF §6 入口已接线；机器可读 backlog 供 Agent 认领 | ✅ |
| 与现有文件分析比较 | [02-doc-comparison.md](02-doc-comparison.md) | 11 份文档资产盘点、5 类漂移逐项行号证据、审计器盲区根因（auditor.mjs:375-389） | ✅ |
| 进一步整合 | 02 §3 双源整合决策 + 03 §6 整合声明 + HANDOFF/README 入口接线 | HANDOFF v0.6.0 四项全量映射（X-01/X-02/X-03）；Wiki 再生成/契约/backlog 单一事实源裁定 | ✅ |
| 输出规划和待办项 | [03-enterprise-roadmap.md](03-enterprise-roadmap.md) + [backlog.json](backlog.json) | 四阶段路线图、39 项待办（8 项 P0）、6 决策门；md/json 一致性校验通过、依赖无环 | ✅ |
| 基于用户思路扩展 | 企业 PM 能力包（E-01~E-09）、运维/合规/生态扩展（P/E/X/F 系列） | [04-enterprise-pm-benchmark.md](04-enterprise-pm-benchmark.md) 六平台对标支撑范围裁定（D5） | ✅ |
| 不同 agent 眼光批判、分析、优化 | 03 §1 八角色批判 + §1.9 独立对抗复核 | 第二评审 Agent 证实 10 项论断、修正 3 处偏差、新增 6 盲区、修复 5 处路线硬伤 | ✅ |
| 打造成企业级项目管理平台（规划） | 03 §2 差距矩阵 + §3 路线图 + 04 对标 | 信任阶段 A → 企业 PM 阶段 B → 规模合规 C → 生态 D；差异化赛道：agent 成本归集 | ✅（规划交付；实施待决策门拍板） |
| 附件 Genie-Teamwork 方案对比 | 02 §4 预留对比框架 + G-01 待办（deferred） | 附件 95,507 字节全 0x00；10 条溯源途径落空（02 §4 记录）；**用户决定（2026-11-22）：文件缺失，先跳过** | ⏭️ 用户跳过（文件补充后可重启） |

**门禁复核**：`npm run verify` 完整门禁实测全绿（2026-11-22，exit 0）——check 语法直检通过 · test 46/46（11.7s）· qa:ui 桌面+移动双端 ALL PASSED（22.6s）· audit 100/100 PASS · 评审档案内链与 md/json 对齐校验全绿。**文档对齐轮复测**（同日，D-01/D-03/D-04/D-06 交付 + `cmdWiki` 知识库接线后）：verify 再次全绿（test 46/46 · qa:ui ALL PASSED · audit 100/100）。