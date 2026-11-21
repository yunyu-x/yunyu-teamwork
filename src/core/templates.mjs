import { MEMBER_ROLES, WORKSPACE_MODES } from './constants.mjs';

/**
 * Built-in Chinese-first team templates inspired by real multi-agent software & game studios.
 */
export const TEAM_TEMPLATES = Object.freeze({
  'gitlab-fullstack': {
    id: 'gitlab-fullstack',
    name: 'GitLab 全栈研发协同蜂群',
    description: '适用于基于 GitLab 仓库的需求拆解、前后端并发开发（独立 Worktree 隔离）、独立 QA 验收与 MR 发布全链路。',
    channels: [
      { name: 'backend', topic: '后端 API、数据模型与服务端逻辑' },
      { name: 'frontend', topic: '前端界面、交互样式与移动端适配' },
      { name: 'qa', topic: '自动化测试、缺陷工单与发布门禁' }
    ],
    globalForbidden: ['dist/**', 'build/**', 'coverage/**'],
    members: [
      {
        name: 'coordinator',
        role: MEMBER_ROLES.COORDINATOR,
        driver: 'human',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'backend', 'frontend', 'qa'],
        owns: [],
        mustNotTouch: ['src/**'],
        brief: '你是本项目的蜂群总控协调者（Coordinator）。不直接编写业务代码，负责解读 GitLab Issue、拆分子任务、划定文件所有权、合并作者分支与组织 QA 验收。全程使用简体中文沟通。'
      },
      {
        name: 'architect',
        role: MEMBER_ROLES.ARCHITECT,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'backend', 'frontend'],
        owns: ['docs/**', 'CONTRACT.json', 'AGENTS.md'],
        mustNotTouch: ['tests/**'],
        brief: '你是系统架构师，负责冻结接口契约（CONTRACT.json）、目录边界与关键不变量。完成后在留言板用简体中文汇总契约并 @coordinator。'
      },
      {
        name: 'backend',
        role: MEMBER_ROLES.AUTHOR,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'backend'],
        owns: ['src/server/**', 'src/api/**', 'src/core/**'],
        mustNotTouch: ['src/web/**', 'web/**', 'tests/**'],
        brief: '你是后端工程师，拥有 src/server/、src/api/ 与 src/core/ 的独占写权限。在独立 Git Worktree 内开发并自测通过后提交 commit，用简体中文向 @coordinator 汇报。'
      },
      {
        name: 'frontend',
        role: MEMBER_ROLES.AUTHOR,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'frontend'],
        owns: ['src/web/**', 'web/**'],
        mustNotTouch: ['src/server/**', 'src/api/**', 'tests/**'],
        brief: '你是前端与 UX 工程师，拥有 web/ 与 src/web/ 的独占写权限。严格遵守零幽灵点击与响应式安全区不变量，完成后用简体中文向 @coordinator 和 @qa 汇报可审计 DOM 选择器。'
      },
      {
        name: 'qa',
        role: MEMBER_ROLES.VERIFIER,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'qa'],
        owns: ['tests/**', 'docs/benchmarks/**'],
        mustNotTouch: ['src/**', 'web/**'],
        brief: '你是独立自动化 QA 验证官。严禁修改 src/ 与 web/ 业务代码！负责编写与执行自动化测试；发现缺陷直接 @ 对应作者提交结构化 P0/P1 缺陷单；全部绿灯后向 @coordinator 与 @release 汇报。'
      },
      {
        name: 'release',
        role: MEMBER_ROLES.RELEASE,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main'],
        owns: ['CHANGELOG.md', 'README.md', '.gitlab-ci.yml', 'package.json'],
        mustNotTouch: ['src/core/**'],
        brief: '你是发布工程师，负责在 QA 全部绿灯后创建/更新 GitLab Merge Request、同步 CHANGELOG 与 README 实测数据，并确认 CI Pipeline 状态。'
      }
    ]
  },

  'heterogeneous-cli': {
    id: 'heterogeneous-cli',
    name: '异构多模型 CLI 混编团队（Claude + Codex + Gemini）',
    description: '将 Claude Code、OpenAI Codex CLI、Gemini CLI、DeepSeek/Ollama 与人类工程师接入同一共享看板并发协作。',
    channels: [
      { name: 'design', topic: '架构评审与接口设计' },
      { name: 'dev', topic: '核心功能研发与 Worktree 提交' }
    ],
    globalForbidden: ['dist/**'],
    members: [
      {
        name: 'coordinator',
        role: MEMBER_ROLES.COORDINATOR,
        driver: 'human',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'design', 'dev'],
        owns: [],
        mustNotTouch: ['src/**']
      },
      {
        name: 'claude-arch',
        role: MEMBER_ROLES.ARCHITECT,
        driver: 'cli-agent',
        driverConfig: { preset: 'claude-code' },
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'design'],
        owns: ['docs/**', 'CONTRACT.json']
      },
      {
        name: 'codex-dev',
        role: MEMBER_ROLES.AUTHOR,
        driver: 'cli-agent',
        driverConfig: { preset: 'codex-cli' },
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'dev'],
        owns: ['src/**']
      },
      {
        name: 'gemini-qa',
        role: MEMBER_ROLES.VERIFIER,
        driver: 'cli-agent',
        driverConfig: { preset: 'gemini-cli' },
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'dev'],
        owns: ['tests/**'],
        mustNotTouch: ['src/**']
      }
    ]
  },

  'gitlab-code-review': {
    id: 'gitlab-code-review',
    name: 'GitLab MR 多视角联合审查团队',
    description: '收到 GitLab Merge Request Webhook 后自动并行触发安全审计、性能评审与测试覆盖率验证。',
    channels: [{ name: 'review', topic: 'MR 差异审计与改进建议' }],
    globalForbidden: ['src/**'],
    members: [
      {
        name: 'security-auditor',
        role: MEMBER_ROLES.VERIFIER,
        driver: 'openai-compatible',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'review'],
        owns: ['docs/reviews/**']
      },
      {
        name: 'perf-reviewer',
        role: MEMBER_ROLES.VERIFIER,
        driver: 'openai-compatible',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'review'],
        owns: ['docs/reviews/**']
      },
      {
        name: 'qa-checker',
        role: MEMBER_ROLES.VERIFIER,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'review'],
        owns: ['tests/**']
      }
    ]
  },

  'git-dev-lifecycle': {
    id: 'git-dev-lifecycle',
    name: 'Git 标准研发交付蜂群（开发 → 提交 → 复核 → 验证）',
    description: '覆盖基础 Git 工程全链路：隔离分支编码开发、规范提交与安全推送、只读 Diff 代码复核与独立自动化测试验证。',
    channels: [
      { name: 'dev', topic: '特性编码、分支开发与提交管理' },
      { name: 'review', topic: 'Git Diff 代码复核、规范与安全审计' },
      { name: 'qa', topic: '自动化验证、测试门禁与缺陷工单' }
    ],
    globalForbidden: ['dist/**', 'build/**', 'coverage/**'],
    members: [
      {
        name: 'coordinator',
        role: MEMBER_ROLES.COORDINATOR,
        driver: 'human',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'dev', 'review', 'qa'],
        owns: [],
        mustNotTouch: ['src/**'],
        brief: '总控协调者：拆解需求、统筹 developer / committer / reviewer / verifier 流转并做最终合并决策。'
      },
      {
        name: 'developer',
        role: MEMBER_ROLES.AUTHOR,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'dev'],
        owns: ['src/**', 'web/**'],
        mustNotTouch: ['tests/**'],
        brief: '你是 Git 开发工程师，在独立 Git Worktree 中编写业务代码并本地自测，完成后通知 @committer 规范提交或 @reviewer 复核。'
      },
      {
        name: 'committer',
        role: MEMBER_ROLES.COMMITTER,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'dev'],
        owns: ['CHANGELOG.md', 'docs/**'],
        mustNotTouch: ['src/**', 'web/**'],
        brief: '你是 Git 提交与分支管理官，负责检查 git status / diff、核验 Conventional Commit 规范、受控推送工作分支（严禁强推 main）并组织复核。'
      },
      {
        name: 'reviewer',
        role: MEMBER_ROLES.REVIEWER,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'review'],
        owns: ['docs/reviews/**'],
        mustNotTouch: ['src/**', 'web/**'],
        brief: '你是独立代码复核官（只读禁改业务代码）。使用 git_review_branch / git_diff 审查改动正确性、边界条件与安全隐患，输出 [APPROVE] 或 [CHANGES_REQUESTED] 并 @developer / @verifier。'
      },
      {
        name: 'verifier',
        role: MEMBER_ROLES.VERIFIER,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'qa'],
        owns: ['tests/**'],
        mustNotTouch: ['src/**', 'web/**'],
        brief: '你是独立验证测试官（严禁修改 src/ 与 web/）。编写测试并执行 run_verification，绿灯后汇报 @coordinator；失败则开具结构化 [缺陷单] @developer。'
      }
    ]
  },

  'research-to-delivery': {
    id: 'research-to-delivery',
    name: '全链路情报调研 → Spec 规划 → 并发研发 → 验收交付团队',
    description: '融合 Qoder Spec 驱动与多源信息整合：先由信息搜集与整合 Agent 调研仓库/网页并沉淀共享知识库，再冻结 Spec 拆分子 Issue 并行研发与验收。',
    channels: [
      { name: 'research', topic: '竞品调研、文档采集与知识库整合' },
      { name: 'dev', topic: 'Spec 落地与隔离 Worktree 并发研发' },
      { name: 'qa', topic: 'Diff 复核与自动化验收门禁' }
    ],
    globalForbidden: ['dist/**', 'build/**', 'coverage/**'],
    members: [
      {
        name: 'coordinator',
        role: MEMBER_ROLES.COORDINATOR,
        driver: 'human',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'research', 'dev', 'qa'],
        owns: [],
        mustNotTouch: ['src/**'],
        brief: '项目指挥官：发起调研、审阅并冻结 Issue Spec 与验收标准，并做最终验收拍板。'
      },
      {
        name: 'researcher',
        role: MEMBER_ROLES.RESEARCHER,
        driver: 'research-synthesizer',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'research'],
        owns: ['docs/research/**'],
        mustNotTouch: ['src/**', 'web/**'],
        brief: '你是信息搜集与整合专家（只读禁改源码）。收到主题或参考 URL 后，跨源检索仓库、网页与历史记录，去重整合出带引用编号的中文情报简报并沉淀至共享知识库。'
      },
      {
        name: 'architect',
        role: MEMBER_ROLES.ARCHITECT,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'research', 'dev'],
        owns: ['docs/**', 'CONTRACT.json'],
        mustNotTouch: ['tests/**'],
        brief: '基于调研知识库冻结 Issue Spec、验收标准与 DAG 子任务依赖图。'
      },
      {
        name: 'developer',
        role: MEMBER_ROLES.AUTHOR,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.SHARE,
        channels: ['main', 'dev'],
        owns: ['src/**', 'web/**'],
        mustNotTouch: ['tests/**'],
        brief: '认领就绪（Ready）且无依赖阻塞的 Issue，在隔离 Git Worktree 中按 Spec 实现并提交 commit。'
      },
      {
        name: 'reviewer',
        role: MEMBER_ROLES.REVIEWER,
        driver: 'simulated',
        workspace: WORKSPACE_MODES.INHERIT,
        channels: ['main', 'qa'],
        owns: ['docs/reviews/**'],
        mustNotTouch: ['src/**', 'web/**'],
        brief: '在「待验收」阶段审查作者分支 Git Diff 与验收清单，决定通过或附原因打回返工。'
      }
    ]
  }
});

/**
 * Single-agent role presets for quick recruitment in Web UI, REST API, and MCP.
 */
export const AGENT_PRESETS = Object.freeze({
  'git-developer': {
    id: 'git-developer',
    label: 'Git 开发 Agent',
    nameSuggestion: 'dev-author',
    role: MEMBER_ROLES.AUTHOR,
    driver: 'cli-agent',
    workspace: WORKSPACE_MODES.SHARE,
    owns: ['src/**'],
    mustNotTouch: ['tests/**'],
    channels: ['main', 'dev'],
    brief: '在独立 Git Worktree 分支完成业务编码与单元自测，提交规范 Commit 后通知 @reviewer 与 @verifier。'
  },
  'git-committer': {
    id: 'git-committer',
    label: 'Git 提交/推送 Agent',
    nameSuggestion: 'git-committer',
    role: MEMBER_ROLES.COMMITTER,
    driver: 'openai-compatible',
    workspace: WORKSPACE_MODES.INHERIT,
    owns: ['CHANGELOG.md', 'docs/**'],
    mustNotTouch: ['src/**', 'web/**'],
    channels: ['main', 'dev'],
    brief: '负责审计变更文件、执行规范化 Conventional Commit 提交、受控推送非受保护工作分支并维护变更记录。'
  },
  'git-reviewer': {
    id: 'git-reviewer',
    label: 'Git 代码复核 Agent',
    nameSuggestion: 'code-reviewer',
    role: MEMBER_ROLES.REVIEWER,
    driver: 'openai-compatible',
    workspace: WORKSPACE_MODES.INHERIT,
    owns: ['docs/reviews/**'],
    mustNotTouch: ['src/**', 'web/**'],
    channels: ['main', 'review'],
    brief: '只读复核隔离分支 Git Diff 与文件所有权合规性，重点检查边界漏洞、并发风险与规范一致性，严禁直接修改业务源码。'
  },
  'git-verifier': {
    id: 'git-verifier',
    label: '独立验证/QA Agent',
    nameSuggestion: 'qa-verifier',
    role: MEMBER_ROLES.VERIFIER,
    driver: 'cli-agent',
    workspace: WORKSPACE_MODES.INHERIT,
    owns: ['tests/**'],
    mustNotTouch: ['src/**', 'web/**'],
    channels: ['main', 'qa'],
    brief: '严禁修改 src/ 与 web/ 源码。负责编写回归测试并运行验证门禁，发现缺陷立刻通过 @author 开具结构化缺陷单。'
  },
  'release-publisher': {
    id: 'release-publisher',
    label: '发布/MR Agent',
    nameSuggestion: 'release-bot',
    role: MEMBER_ROLES.RELEASE,
    driver: 'openai-compatible',
    workspace: WORKSPACE_MODES.INHERIT,
    owns: ['CHANGELOG.md', 'README.md', '.gitlab-ci.yml'],
    mustNotTouch: ['src/**'],
    channels: ['main'],
    brief: '在复核与验证双绿灯后创建或更新 GitLab Merge Request、核对 CI 流水线状态并整理发布说明。'
  },
  'personal-twin': {
    id: 'personal-twin',
    label: '个人数字分身 (Digital Twin)',
    nameSuggestion: 'my-twin',
    role: MEMBER_ROLES.DIGITAL_TWIN,
    driver: 'digital-twin',
    workspace: WORKSPACE_MODES.INHERIT,
    owns: ['docs/**'],
    mustNotTouch: ['src/**'],
    channels: ['main'],
    brief: '作为归属人的个人数字分身参与协同：常规咨询按本人风格自动回复并同步 IM，涉及审批、合并或发布时立即通过绑定的 IM/机器人请示本人确认。'
  },
  'info-synthesizer': {
    id: 'info-synthesizer',
    label: '信息搜集与整合 Agent',
    nameSuggestion: 'researcher',
    role: MEMBER_ROLES.RESEARCHER,
    driver: 'research-synthesizer',
    workspace: WORKSPACE_MODES.INHERIT,
    owns: ['docs/research/**'],
    mustNotTouch: ['src/**', 'web/**'],
    channels: ['main', 'research'],
    brief: '专职跨源信息搜集与整合（只读禁改源码）：检索本地仓库、抓取参考网页、汇聚看板与 GitLab 历史，输出带来源引用编号的中文结构化简报并沉淀至共享知识库。'
  }
});

export function listTemplates() {
  return Object.values(TEAM_TEMPLATES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    memberCount: t.members.length,
    channels: t.channels.map((c) => c.name)
  }));
}

export function listAgentPresets() {
  return Object.values(AGENT_PRESETS);
}
