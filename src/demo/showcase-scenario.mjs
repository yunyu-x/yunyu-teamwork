import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MEMBER_ROLES, MESSAGE_KINDS, WORKSPACE_MODES } from '../core/constants.mjs';
import { GitLabClient, GitLabMockServer, GitLabSyncService } from '../gitlab/index.mjs';

function runGit(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Initialize a real local sandbox Git repository for live end-to-end demonstrations and tests.
 */
export function createDemoGitRepo(targetDir = null) {
  const repoDir = targetDir
    ? path.resolve(targetDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-demo-repo-'));
  fs.mkdirSync(repoDir, { recursive: true });
  runGit(repoDir, ['init', '-b', 'main']);

  fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'web'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });

  fs.writeFileSync(
    path.join(repoDir, 'package.json'),
    JSON.stringify({ name: 'yunyu-order-service', version: '1.0.0', type: 'module' }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'README.md'),
    '# Order Service（云驭协同 GitLab 演示仓库）\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'src', 'index.mjs'),
    'export const SERVICE_NAME = "yunyu-order-service";\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(repoDir, 'web', 'index.mjs'),
    'export const UI_NAME = "yunyu-order-dashboard";\n',
    'utf8'
  );

  runGit(repoDir, ['add', '-A']);
  runGit(repoDir, [
    '-c',
    'user.name=yunyu-init',
    '-c',
    'user.email=init@yunyu-teamwork.local',
    'commit',
    '-m',
    'chore: initial repository scaffold'
  ]);
  return repoDir;
}

/**
 * Run a complete, authentic Chinese-first multi-agent GitLab development & QA scenario
 * using REAL git worktrees, REAL OwnershipGuard enforcement, REAL node --test execution,
 * and a REAL local GitLab API v4 Mock Server!
 */
export async function runShowcaseDemo({ manager, repoPath = null, gitlabMock = null, keepOpen = true } = {}) {
  const ownedRepo = !repoPath;
  const targetRepo = repoPath || createDemoGitRepo();
  const mock = gitlabMock || new GitLabMockServer({ projectPath: 'yunyu/order-service' });
  const mockUrl = mock.baseUrl || (await mock.start(0));
  const glClient = new GitLabClient({ baseUrl: mockUrl, token: 'demo-token' });
  const glSync = new GitLabSyncService({ client: glClient, projectId: 'yunyu/order-service', issueIid: 1 });

  let backendAttempts = 0;
  let qaRounds = 0;

  const swarm = manager.createSwarm({
    id: 'gitlab-order-rate-limit',
    title: '云驭协同实战：GitLab Issue #1 订单限流器与监控面板交付',
    repoPath: targetRepo,
    contract: {
      globalForbidden: ['dist/**', 'build/**']
    },
    gitlab: {
      client: glClient,
      sync: glSync,
      projectId: 'yunyu/order-service',
      linkedIssueIid: 1
    },
    enableMonitor: true,
    monitorIntervalMs: 60_000,
    stallThresholdMs: 120_000
  });

  swarm.board.createChannel({ name: 'backend', topic: '后端令牌桶限流算法与核心 API' });
  swarm.board.createChannel({ name: 'frontend', topic: '监控指标卡片与前端可视化组件' });
  swarm.board.createChannel({ name: 'qa', topic: '自动化单元测试、越权审计与缺陷工单' });

  // 1. Add coordinator (human-assisted)
  swarm.addMember({
    name: 'coordinator',
    role: MEMBER_ROLES.COORDINATOR,
    driver: 'human',
    model: 'Human + Swarm Orchestrator',
    workspace: WORKSPACE_MODES.INHERIT,
    channels: ['main', 'backend', 'frontend', 'qa'],
    owns: [],
    mustNotTouch: ['src/**'],
    brief: '总控协调者：接收 GitLab Issue，拆分互斥文件边界，合入 Worktree 分支并把关交付。',
    postBrief: false
  });

  // 2. Add heterogeneous members
  swarm.addMember({
    name: 'architect',
    role: MEMBER_ROLES.ARCHITECT,
    driver: 'simulated',
    model: 'Claude 3.7 / Architect',
    workspace: WORKSPACE_MODES.SHARE,
    channels: ['main', 'backend', 'frontend'],
    owns: ['docs/**', 'CONTRACT.json'],
    mustNotTouch: ['src/**', 'tests/**'],
    brief: '请先冻结订单限流器的模块接口契约 `CONTRACT.json` 与 `docs/DESIGN.md`，明确导出符号 `TokenBucketLimiter` 与 `renderRateLimitCard`，提交至隔离 worktree 后汇报。',
    driverConfig: {
      handler: async ({ tools }) => {
        tools.write_file({
          path: 'CONTRACT.json',
          content: JSON.stringify(
            {
              project: 'yunyu/order-service',
              issueIid: 1,
              exports: {
                backend: ['src/rate-limiter.mjs -> TokenBucketLimiter(capacity, refillPerSec)'],
                frontend: ['web/dashboard-widget.mjs -> renderRateLimitCard(metrics)']
              },
              ownership: {
                backend: ['src/rate-limiter.mjs'],
                frontend: ['web/dashboard-widget.mjs'],
                qa: ['tests/**']
              }
            },
            null,
            2
          )
        });
        tools.write_file({
          path: 'docs/DESIGN.md',
          content: '# 订单限流器设计契约\n- 后端：`src/rate-limiter.mjs` 导出 `TokenBucketLimiter`\n- 前端：`web/dashboard-widget.mjs` 导出 `renderRateLimitCard`\n'
        });
        const commit = tools.git_commit({ message: 'docs(arch): freeze CONTRACT.json and rate limiter design' });
        return {
          reply: `@coordinator 架构契约已冻结并提交至隔离分支 \`${commit.branch}\`（Commit \`${commit.sha}\`）：\n- 交付文件：\`CONTRACT.json\`、\`docs/DESIGN.md\`\n- 接口约定：\`TokenBucketLimiter({ capacity, refillPerSec })\` 提供 \`allow(cost)\` 与 \`getStats()\`；\`renderRateLimitCard(stats)\` 输出中文状态卡片。\n请合并后通知 backend 与 frontend 并行开发。`,
          channel: 'main',
          kind: MESSAGE_KINDS.DELIVERABLE,
          metadata: { commitSha: commit.sha, files: commit.files }
        };
      }
    }
  });

  swarm.addMember({
    name: 'backend',
    role: MEMBER_ROLES.AUTHOR,
    driver: 'simulated',
    model: 'Codex CLI / Backend',
    workspace: WORKSPACE_MODES.SHARE,
    channels: ['main', 'backend'],
    owns: ['src/**'],
    mustNotTouch: ['web/**', 'tests/**'],
    brief: '你独占拥有 `src/**`（严禁修改 `web/` 与 `tests/`）。请在独立 Git Worktree 实现 `src/rate-limiter.mjs` 的令牌桶限流算法，自测并 commit 后汇报。',
    postBrief: false,
    driverConfig: {
      handler: async ({ tools, triggerMessage }) => {
        backendAttempts++;
        // Round 1 intentionally ships an edge-case bug (allows cost <= 0 without rejecting & miscomputes remaining on burst)
        // Round 2 fixes it cleanly after QA defect ticket!
        const isFixRound = backendAttempts >= 2;
        const code = isFixRound
          ? `export class TokenBucketLimiter {
  constructor({ capacity = 10, refillPerSec = 5 } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.allowed = 0;
    this.rejected = 0;
    this.lastRefill = null;
  }
  refill(now = Date.now()) {
    if (this.lastRefill === null) {
      this.lastRefill = now;
      return;
    }
    const elapsedSec = Math.max(0, (now - this.lastRefill) / 1000);
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.lastRefill = now;
    }
  }
  allow(cost = 1, now = Date.now()) {
    if (cost <= 0) throw new RangeError('cost must be positive');
    this.refill(now);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      this.allowed++;
      return true;
    }
    this.rejected++;
    return false;
  }
  getStats() {
    return {
      capacity: this.capacity,
      remaining: Math.floor(this.tokens),
      allowed: this.allowed,
      rejected: this.rejected
    };
  }
}
`
          : `export class TokenBucketLimiter {
  constructor({ capacity = 10, refillPerSec = 5 } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.tokens = capacity;
    this.allowed = 0;
    this.rejected = 0;
  }
  allow(cost = 1) {
    if (this.tokens >= cost) {
      this.tokens -= cost;
      this.allowed++;
      return true;
    }
    this.rejected++;
    return false;
  }
  getStats() {
    return { capacity: this.capacity, remaining: this.tokens, allowed: this.allowed, rejected: this.rejected };
  }
}
`;
        tools.write_file({ path: 'src/rate-limiter.mjs', content: code });
        const commit = tools.git_commit({
          message: isFixRound
            ? 'fix(backend): add time-based token refill and reject non-positive cost'
            : 'feat(backend): initial TokenBucketLimiter implementation'
        });

        if (isFixRound) {
          return {
            reply: `@coordinator 已响应缺陷单 #${triggerMessage.seq} 完成修复（Commit \`${commit.sha}\`）：\n- 补齐基于时间戳的 \`refill(now)\` 令牌回充逻辑；\n- 对 \`cost <= 0\` 抛出 \`RangeError\` 参数保护。\n请合并分支后通知 qa 复测！`,
            channel: 'backend',
            kind: MESSAGE_KINDS.DELIVERABLE,
            metadata: { commitSha: commit.sha, files: commit.files, round: 2 }
          };
        }
        return {
          reply: `@coordinator 后端限流器初版已提交至隔离分支 \`${commit.branch}\`（Commit \`${commit.sha}\`）：\n- 新增 \`src/rate-limiter.mjs\`（导出 \`TokenBucketLimiter\`）。\n等待与前端合并后进入 QA 验收。`,
          channel: 'backend',
          kind: MESSAGE_KINDS.DELIVERABLE,
          metadata: { commitSha: commit.sha, files: commit.files, round: 1 }
        };
      }
    }
  });

  swarm.addMember({
    name: 'frontend',
    role: MEMBER_ROLES.AUTHOR,
    driver: 'simulated',
    model: 'Gemini / Frontend',
    workspace: WORKSPACE_MODES.SHARE,
    channels: ['main', 'frontend'],
    owns: ['web/**'],
    mustNotTouch: ['src/**', 'tests/**'],
    brief: '你独占拥有 `web/**`（严禁修改 `src/` 与 `tests/`）。请在独立 Git Worktree 实现中文限流监控面板卡片 `web/dashboard-widget.mjs` 并提交 commit。',
    postBrief: false,
    driverConfig: {
      handler: async ({ tools }) => {
        tools.write_file({
          path: 'web/dashboard-widget.mjs',
          content: `export function renderRateLimitCard(stats) {
  const pct = stats.capacity > 0 ? Math.round((stats.remaining / stats.capacity) * 100) : 0;
  return \`<section class="rate-card" data-status="\${pct < 20 ? 'warn' : 'ok'}">
  <h4>订单限流监控</h4>
  <p>剩余令牌：\${stats.remaining}/\${stats.capacity}（\${pct}%）</p>
  <p>已放行：\${stats.allowed} · 已拦截：\${stats.rejected}</p>
</section>\`;
}
`
        });
        const commit = tools.git_commit({ message: 'feat(frontend): add Chinese rate-limit dashboard widget' });
        return {
          reply: `@coordinator 前端中文监控卡片已提交至隔离分支 \`${commit.branch}\`（Commit \`${commit.sha}\`）：\n- 新增 \`web/dashboard-widget.mjs\`（导出 \`renderRateLimitCard\`，支持低水位告警标记 \`data-status="warn"\`）。`,
          channel: 'frontend',
          kind: MESSAGE_KINDS.DELIVERABLE,
          metadata: { commitSha: commit.sha, files: commit.files }
        };
      }
    }
  });

  swarm.addMember({
    name: 'qa',
    role: MEMBER_ROLES.VERIFIER,
    driver: 'simulated',
    model: 'DeepSeek-R1 / QA Verifier',
    workspace: WORKSPACE_MODES.INHERIT,
    channels: ['main', 'qa'],
    owns: ['tests/**'],
    mustNotTouch: ['src/**', 'web/**'],
    brief: '你是独立 QA 验证官，严禁修改 `src/` 与 `web/`！负责在 `tests/` 编写自动化回归用例并实测；发现缺陷直接 @ 对应作者提单。',
    postBrief: false,
    driverConfig: {
      handler: async ({ tools }) => {
        qaRounds++;
        // Verify QA truly cannot write to src/ (Hard Invariant demonstration)
        const guardCheck = tools.write_file({ path: 'src/hack.mjs', content: '// should fail' });
        const guardBlocked = Boolean(guardCheck.error);

        tools.write_file({
          path: 'tests/rate-limiter.test.mjs',
          content: `import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenBucketLimiter } from '../src/rate-limiter.mjs';
import { renderRateLimitCard } from '../web/dashboard-widget.mjs';

test('TokenBucketLimiter enforces capacity, time refill, and positive cost', () => {
  const lim = new TokenBucketLimiter({ capacity: 2, refillPerSec: 2 });
  assert.equal(lim.allow(1, 1000), true);
  assert.equal(lim.allow(1, 1000), true);
  assert.equal(lim.allow(1, 1000), false);
  // After 1 second, 2 tokens should refill
  assert.equal(lim.allow(1, 2000), true);
  assert.throws(() => lim.allow(0, 2000), RangeError);
  const html = renderRateLimitCard(lim.getStats());
  assert.ok(html.includes('订单限流监控'));
});
`
        });

        const testRes = tools.run_command({ command: 'node --test tests/rate-limiter.test.mjs' });
        if (!testRes.ok) {
          return {
            reply: `@backend [缺陷单][P1] 自动化测试第 ${qaRounds} 轮失败（QA 只读守卫校验：写入 \`src/\` 拦截=${guardBlocked}）：\n- 复现命令：\`node --test tests/rate-limiter.test.mjs\`\n- 问题定位：\`TokenBucketLimiter\` 缺少按时间窗口回充令牌（\`refill\`）且未校验 \`cost <= 0\`。\n请 backend 在隔离分支修复后通知 coordinator 合并复测。`,
            channel: 'qa',
            kind: MESSAGE_KINDS.DEFECT,
            metadata: { round: qaRounds, passed: false, guardBlocked }
          };
        }
        return {
          reply: `@coordinator @release 第 ${qaRounds} 轮独立 QA 全量验收通过（✅ 100% 绿灯）：\n- 实测命令：\`node --test tests/rate-limiter.test.mjs\`（退出码 0）\n- 验证项：令牌桶突发限流、时间回充、非法 \`cost<=0\` 拦截、前端中文状态卡片渲染、QA 禁止写 \`src/\` 守卫拦截=${guardBlocked}。\n可以创建 GitLab Merge Request 并进入发布门禁。`,
          channel: 'qa',
          kind: MESSAGE_KINDS.DELIVERABLE,
          metadata: { round: qaRounds, passed: true, guardBlocked }
        };
      }
    }
  });

  swarm.addMember({
    name: 'release',
    role: MEMBER_ROLES.RELEASE,
    driver: 'simulated',
    model: 'Release Publisher',
    workspace: WORKSPACE_MODES.INHERIT,
    channels: ['main'],
    owns: ['CHANGELOG.md', 'README.md'],
    mustNotTouch: ['src/**'],
    brief: '发布工程师：QA 通过后自动创建 GitLab MR、核对 CI 流水线并同步发布说明。',
    postBrief: false,
    driverConfig: {
      handler: async ({ tools }) => {
        const mr = await tools.gitlab_create_mr({
          sourceBranch: 'yunyu/gitlab-order-rate-limit/backend',
          targetBranch: 'main',
          title: 'feat(order): 实现令牌桶订单限流中间件与监控面板 (Closes #1)',
          description: '由 Yunyu Teamwork 蜂群自动协同交付：包含架构契约、前后端隔离分支开发与 2 轮独立 QA 回归验收。'
        });
        return {
          reply: `@coordinator 已在 GitLab 仓库 \`yunyu/order-service\` 创建 Merge Request **!${mr.iid}**（${mr.webUrl}），并同步关联 Issue #1 进展评论。待最终确认后即可合并归档。`,
          channel: 'main',
          kind: MESSAGE_KINDS.DELIVERABLE,
          metadata: { gitlabMrIid: mr.iid, webUrl: mr.webUrl }
        };
      }
    }
  });

  // Step A: Wait for architect brief triggered on addMember to complete, then merge architect
  await swarm.waitIdle();
  swarm.worktrees.mergeToBase('architect');

  // Step B: Simulate incoming GitLab Issue #1 dispatch to @backend and @frontend in parallel
  swarm.postMessage({
    author: 'gitlab',
    text: '@backend @frontend [GitLab Issue #1 · open] 架构契约已落地主分支（详见 #1、#2）。请依据 `CONTRACT.json` 在各自隔离 Git Worktree 中并行完成后端限流器与前端监控卡片！',
    channel: 'main',
    kind: MESSAGE_KINDS.GITLAB,
    metadata: { gitlabEvent: 'issue', gitlabIssueIid: 1 }
  });
  await swarm.waitIdle();

  // Merge Round 1 backend + frontend into main & trigger QA
  swarm.worktrees.mergeToBase('backend');
  swarm.worktrees.mergeToBase('frontend');
  swarm.postMessage({
    author: 'coordinator',
    text: '@qa 已将 backend 与 frontend 第一轮隔离分支通过 OwnershipGuard 审计并合并至 `main`，请运行完整回归测试并验收。',
    channel: 'qa',
    kind: MESSAGE_KINDS.POST
  });
  await swarm.waitIdle();

  // Step C: QA caught P1 defect and backend fixed it automatically! Now merge Round 2 backend fix and re-run QA
  swarm.worktrees.mergeToBase('backend');
  swarm.postMessage({
    author: 'coordinator',
    text: '@qa 已合并 backend 的修复提交，请复测 `tests/rate-limiter.test.mjs` 并汇报结果。',
    channel: 'qa',
    kind: MESSAGE_KINDS.POST
  });
  await swarm.waitIdle();

  // Step D: Demonstrate external English CI bot post + non-destructive Chinese display translation overlay
  const ciBotMsg = swarm.postMessage({
    author: 'gitlab',
    text: '[GitLab Pipeline #501 · SUCCESS] All stages passed (lint/syntax-check, test/integration-tests, verify/ownership-audit) in 14s on branch main.',
    channel: 'main',
    kind: MESSAGE_KINDS.GITLAB,
    metadata: { gitlabEvent: 'pipeline', pipelineId: 501, pipelineStatus: 'success' }
  });
  swarm.board.annotateTranslation(
    ciBotMsg.seq,
    'zh-CN',
    '[GitLab CI 流水线 #501 · 成功] 主分支 `main` 全部阶段绿灯通过（语法检查、集成测试、文件所有权审计），总耗时 14 秒。'
  );

  // Step E: Merge GitLab MR !1 and post [done]
  if (swarm.gitlab?.linkedMrIid) {
    await glClient.mergeMergeRequest('yunyu/order-service', swarm.gitlab.linkedMrIid);
  } else {
    const mrs = await glClient.listMergeRequests('yunyu/order-service');
    if (mrs[0]) {
      swarm.gitlab.linkedMrIid = mrs[0].iid;
      await glClient.mergeMergeRequest('yunyu/order-service', mrs[0].iid);
    }
  }

  swarm.postMessage({
    author: 'coordinator',
    text: '[done] GitLab Issue #1 全流程多 Agent 协同交付完成：架构冻结 → 双作者独立 Worktree 并行开发 → QA 第 1 轮拦截缺陷并触发自动返工 → 第 2 轮测试 100% 通过 → GitLab MR !1 合并与 CI 绿灯归档。',
    channel: 'main',
    kind: MESSAGE_KINDS.DONE
  });

  // Wait briefly for final GitLab bidirectional sync
  await new Promise((r) => setTimeout(r, 80));

  return {
    swarm,
    gitlabMock: mock,
    repoDir: targetRepo,
    cleanup: async () => {
      swarm.dispose();
      if (!keepOpen && !gitlabMock) await mock.close();
      if (ownedRepo && !keepOpen) {
        try {
          fs.rmSync(targetRepo, { recursive: true, force: true });
        } catch {}
      }
    }
  };
}
