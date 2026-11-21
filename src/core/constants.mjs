export const APP_VERSION = '0.5.0';

export const MEMBER_STATES = Object.freeze({
  WAITING: 'waiting',
  WORKING: 'working',
  WAITING_HUMAN: 'waiting_human',
  STOPPED: 'stopped',
  KILLED: 'killed',
  ERROR: 'error'
});

export const WORKSPACE_MODES = Object.freeze({
  INHERIT: 'inherit',
  SHARE: 'share',
  BRANCH: 'branch'
});

export const MEMBER_ROLES = Object.freeze({
  COORDINATOR: 'coordinator',
  ARCHITECT: 'architect',
  RESEARCHER: 'researcher',
  AUTHOR: 'author',
  COMMITTER: 'committer',
  REVIEWER: 'reviewer',
  VERIFIER: 'verifier',
  RELEASE: 'release',
  DIGITAL_TWIN: 'digital_twin',
  MONITOR: 'monitor',
  HUMAN: 'human'
});

export const TASK_STATUSES = Object.freeze({
  BACKLOG: 'backlog',
  PLANNING: 'backlog',
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  REVIEW: 'review',
  QA: 'review',
  BLOCKED: 'blocked',
  DONE: 'done',
  CANCELLED: 'cancelled'
});

export const QODER_ISSUE_COLUMNS = Object.freeze([
  'backlog',
  'ready',
  'in_progress',
  'review',
  'done',
  'cancelled'
]);

export const KNOWLEDGE_CATEGORIES = Object.freeze({
  RESEARCH: 'research',
  SPEC: 'spec',
  ADR: 'adr',
  PITFALL: 'pitfall',
  BENCHMARK: 'benchmark'
});

export const AUTONOMY_MODES = Object.freeze({
  HYBRID: 'hybrid',
  AUTO_REPLY: 'auto_reply',
  RELAY_HUMAN: 'relay_human'
});

export const PROTECTED_BRANCHES_DEFAULT = Object.freeze([
  'main',
  'master',
  'production',
  'release/*'
]);

export const MESSAGE_KINDS = Object.freeze({
  BRIEF: 'brief',
  POST: 'post',
  DELIVERABLE: 'deliverable',
  DEFECT: 'defect',
  GITLAB: 'gitlab',
  SYSTEM: 'system',
  HUMAN_GATE: 'human_gate',
  DONE: 'done'
});

export const RESERVED_NAMES = Object.freeze(new Set(['all', 'everyone', 'system']));

export const VERIFIER_FORBIDDEN_DEFAULT = Object.freeze([
  'src/**',
  'web/**',
  'app/**',
  'lib/**',
  'bin/**',
  'scripts/**',
  'plugins/**',
  'package.json',
  'package-lock.json',
  '.git/**',
  '.claude/**',
  '.codex/**',
  '.cursor/**'
]);

export const GITLAB_STATUS_LABELS = Object.freeze({
  planning: 'teamwork::planning',
  developing: 'teamwork::developing',
  qa: 'teamwork::qa',
  review: 'teamwork::review',
  blocked: 'teamwork::blocked',
  done: 'teamwork::done'
});

export const DEFAULT_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 4310,
  defaultLang: 'zh-CN',
  monitorIntervalMs: 15_000,
  stallThresholdMs: 30_000,
  maxTurnsPerWake: 8,
  defaultChannels: [
    {
      name: 'main',
      topic: '主频道：全局决策、跨领域交接、阶段里程碑与最终交付',
      creator: 'system',
      archived: false
    }
  ]
});
