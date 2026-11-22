# 企业级项目管理平台能力对标（Enterprise PM Benchmark，2025–2026）

> 调研方式：独立调研 Agent 联网检索（2026-11-22），来源见文末。
> 用途：支撑 [03 路线图](03-enterprise-roadmap.md) 决策门 **D5（PM 深度边界）** 与 **E-01/E-02/E-04/E-05/E-06/E-07** 的范围界定，避免过度建设。
> 定位：本文是 [BENCHMARK_AND_INTEGRATION.md](../BENCHMARK_AND_INTEGRATION.md)（多 Agent 编排对标，截至 v0.3.0）的**企业 PM 维度续篇**。

---

## 1. 能力对标矩阵

◎ 标配 / $ 付费档 / △ 部分 / — 缺失

| 维度 | Jira | Linear | GitLab Plan | 飞书项目 | Teambition | PingCode |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 工作项模型 | ◎ epic/story/task/subtask + 自定义字段 + 全可配工作流 | △ 层级浅、自定义字段弱、工作流按团队固定 | △ epic/issue/task；自定义字段 $Premium（仅 4 类型/50 上限）[5] | ◎ 自定义工作项/字段 + 节点流 SOP [7] | △ 自定义类型/工作流 $企业版 [8] | ◎ 多级需求 + 可视化自定义工作流 [10] |
| 规划面 | sprint ◎；跨项目 Plans/容量 $Premium [1] | cycles/projects/initiatives ◎ [4] | 里程碑/工时 ◎；epic/迭代/路线图 $Premium [11] | ◎ WBS/甘特/迭代/排期汇总 [7] | 甘特/里程碑/工时 $企业版 [8] | ◎ 迭代/里程碑/工时免费版即有 [9] |
| 报表 | 燃尽/速度/CFD ◎，高级分析 $ | 周期时间 Insights $Business，仪表盘 $Enterprise [4] | 燃尽图/价值流分析 $Premium [11] | ◎ 度量视图自定义数据源/维度/指标 [7] | 企业/项目统计 $，深度研发度量弱 | ◎ 燃尽 + 效能度量（周期/吞吐）[10] |
| 权限与身份 | RBAC ◎；SAML/组织审计需另购 Atlassian Guard [3] | SAML/SCIM/审计日志全部 Enterprise 付费墙 [4] | 群组 SAML/审计事件 $Premium [11] | 飞书组织架构 + 角色，SSO 随企业版 | SSO（AD/SAML/OAuth）仅专业版 [8] | SSO/审计/IP 限制/水印企业版 $，可私有化 + 信创 [10] |
| 审批与自动化 | 自动化 ◎；业务审批弱 | triage 规则 $；无审批流 | MR 多审批人 ◎；工作项审批弱 | ◎ 节点审批/评审管理 + 飞书审批 [7] | 自动化 $；审批靠钉钉 | ◎ 自动化智能引擎 + 执行记录 [9] |
| AI/Agent | Rovo agents 随付费版内置、按 credit 计量，可给 agent 派单 [1][2] | Agent 平台/MCP/Linear Agent 免费档即有，issue 可委派 Claude Code/Codex [4] | Duo Agent Platform 2026.1 GA（Premium+credits）：Planner/安全分析 agent、多 agent 流编排 [6] | AI 字段（提取/分类/生成，2025.4）[7] | 钉钉 AI 生态（通义/DeepSeek 切换） | AI 摘要/任务要点归纳 [9] |

## 2. 企业级最低门槛（table stakes）vs 差异化

**采购硬门槛（六家一致放在企业版付费墙后，必须有）**：
1. 可配置工作流 + 自定义字段 + 多级工作项；
2. 迭代/里程碑 + 燃尽/吞吐基础报表；
3. **RBAC + SSO + 审计日志**——印证本评审把 S-02/E-01/E-02 列为企业能力前置的判断；
4. 规则自动化 + IM 通知订阅。

**差异化加分项**：跨项目组合路线图、容量/资源池、节点级审批 SOP（中式企业刚需，欧美研发工具普遍缺失）、**agent 原生协作**。

**本项目独有赛道**：六家均无原生 **agent 工时/token 成本按 Issue/成员归集度量**（GitLab 仅到 credits 用量可见性 [6]）。云驭的 JSONL 事件流 + BudgetGovernor 已天然持有全量数据，E-05 报表叠加此维度即形成「人机混合团队效能与成本」独家视角。

## 3. 范围建议（已回写 backlog 验收标准）

| 待办 | 范围裁定 | 理由 |
| :--- | :--- | :--- |
| E-01/E-02 | **优先于所有 PM 功能** | 单全局 token 是最大采购阻断项；既有追加式审计日志天然满足归因，hash 链/导出（E-08）可后置 |
| E-04 | **够用就好**：里程碑 + 迭代 + 优先级 + 工时 + 少量自定义字段类型；**不做**组合级 roadmap 与资源调度 | GitLab 也仅 4 种字段类型 [5]；过度建设陷阱 |
| E-05 | **优先且做差异化**：吞吐/周期/燃尽从事件流纯函数推导（成本低）+ **agent token/成本按 Issue/成员归集报表** | 六家均无原生 agent 成本度量 |
| E-06 | **只做「人机混合审批」**：agent 产出 human-gate、多级签核、超时升级、IM 卡片联动；**不做**通用 BPM/审批表单 | 复用现有 watchdog human-gate 与 6 渠道；通用审批交给飞书/钉钉 |
| E-07 | **够用就好**：订阅规则 + 免打扰 + 摘要；不做模板市场 | IM 通知是门槛项而非差异化 |

## 4. 对决策门 D5 的输入

建议裁定：**云驭 = 「AI-agent 原生协作 + 人机混合审批 + 效能/成本报表」的企业研发 PM 平台**；代码托管/CI 交给 GitLab/GitHub，通用 BPM 与组合级资源管理不做。工作项模型向「可配置工作流 + 自定义字段」靠拢（E-04 范围内），身份三件套（RBAC/SSO/审计）按采购门槛优先补齐。

---

## 来源

- [1] [Jira Pricing 2026](https://community.atlassian.com/forums/App-Central-articles/Jira-Pricing-How-Much-Does-Jira-Cost-in-2026/ba-p/3284604)
- [2] [Atlassian Intelligence/Rovo features](https://support.atlassian.com/organization-administration/docs/understand-atlassian-intelligence-features-in-products/)
- [3] [Jira SAML 需 Guard 对比](https://alertops.com/blogs/enterprise-incident-management-software/)
- [4] [Linear Pricing](https://linear.app/pricing)
- [5] [GitLab Custom fields](https://docs.gitlab.com/user/work_items/custom_fields/)
- [6] [GitLab 18.8 Duo Agent Platform GA](https://about.gitlab.cn/docs/jh/releases/18/gitlab-18-8-released)
- [7] [飞书项目更新日志](https://project.feishu.cn/home/blogs/newsbriefing)
- [8] [Teambition 功能定价表](https://open.work.weixin.qq.com/wwopen/appStore/detail/price?appId=MTk3MDMyNTA1NjAwNjcxOF8x)
- [9] [PingCode Project 产品页](https://pingcode.com/product/project)
- [10] [PingCode 审计/SSO/效能测评](https://worktile.com/kb/p/3987911)
- [11] [GitLab Pricing Guide](https://www.spendbase.co/blog/saas-management/gitlab-pricing/)

> 注：联网调研结论为 2026-11 时点快照，付费墙与 AI 功能迭代快，落地 E-04~E-07 前建议复核关键事实。