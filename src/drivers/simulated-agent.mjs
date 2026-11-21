import { MESSAGE_KINDS } from '../core/constants.mjs';
import { AgentDriver, createGuardedWorkspaceTools } from './base.mjs';

/**
 * Deterministic Simulated Agent Driver:
 * Powers zero-API-key interactive demos, dry-run validation, and deterministic E2E tests.
 * Supports custom scripted handlers via `driverConfig.handler(ctx)` or rich built-in role behaviors.
 */
export class SimulatedAgentDriver extends AgentDriver {
  constructor() {
    super('simulated', '内置确定性演练与测试驱动（零 API Key 即可跑通完整 Git Worktree + GitLab 协同交付）');
  }

  async executeTurn(ctx) {
    const { member, triggerMessage } = ctx;
    const cfg = member.driverConfig || {};

    if (typeof cfg.delayMs === 'number' && cfg.delayMs > 0) {
      await new Promise((r) => setTimeout(r, cfg.delayMs));
    }

    if (typeof cfg.handler === 'function') {
      const tools = createGuardedWorkspaceTools(ctx);
      return await cfg.handler({ ...ctx, tools });
    }

    // Default Chinese-first helpful role response for ad-hoc interactive UI experiments
    const roleHint = {
      architect: '已完成接口契约核查与边界冻结',
      author: '已在独立工作区完成对应模块实现并自测通过',
      verifier: '已完成自动化回归审计，未发现越权修改或回归缺陷',
      release: '已核对发布说明、版本号与 GitLab Merge Request 状态',
      coordinator: '已收到阶段交付并完成任务状态同步'
    }[member.role] || '已完成本次响应';

    return {
      reply: `@coordinator 收到 #${triggerMessage.seq}：${roleHint}（成员 \`${member.name}\`，工作区模式 \`${member.workspaceMode}\`）。`,
      channel: triggerMessage.channel,
      kind: MESSAGE_KINDS.DELIVERABLE,
      metadata: { simulated: true, triggerSeq: triggerMessage.seq }
    };
  }
}
