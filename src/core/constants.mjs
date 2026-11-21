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
  AUTHOR: 'author',
  VERIFIER: 'verifier',
  RELEASE: 'release',
  MONITOR: 'monitor',
  HUMAN: 'human'
});

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
  'lib/**'
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
