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
