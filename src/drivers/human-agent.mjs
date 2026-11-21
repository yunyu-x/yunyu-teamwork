import { AgentDriver } from './base.mjs';

/**
 * Human-in-the-loop Member Driver:
 * Handled interactively via the Web UI composer, CLI, or GitLab Issue/MR comments.
 */
export class HumanAgentDriver extends AgentDriver {
  constructor() {
    super('human', '人类工程师/项目经理接入（在 Web 看板或 GitLab 评论区接收 @ 提醒并审批门禁）');
  }

  async executeTurn() {
    return { alreadyPosted: true };
  }
}
