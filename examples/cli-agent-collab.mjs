#!/usr/bin/env node
/**
 * 本机真实多 CLI Agent（Claude Code + OpenAI Codex CLI）沙盒仓库协同演示脚本。
 *
 * 用法：
 *   node examples/cli-agent-collab.mjs           # 使用本机已安装的 claude + codex 在沙盒 Git 仓库协同开发
 *   node examples/cli-agent-collab.mjs --keep    # 运行完成后保留临时沙盒仓库路径供人工检视
 *
 * 提示：本脚本会实际调用本机 claude / codex CLI（消耗对应账号额度），
 *       不会在 `npm run verify` 离线自动化门禁中自动运行。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MEMBER_ROLES, WORKSPACE_MODES } from '../src/core/constants.mjs';
import { TeamworkManager } from '../src/core/orchestrator.mjs';
import { createDemoGitRepo } from '../src/demo/showcase-scenario.mjs';
import { createDefaultDriverRegistry } from '../src/drivers/registry.mjs';

function checkCli(bin) {
  try {
    return execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

async function main() {
  const keepRepo = process.argv.includes('--keep');
  const claudeVer = checkCli(process.env.CLAUDE_CLI_BIN || 'claude');
  const codexVer = checkCli(process.env.CODEX_CLI_BIN || 'codex');

  console.log('[yunyu cli-collab] 本机 CLI 探测：', { claude: claudeVer || '未安装', codex: codexVer || '未安装' });
  if (!claudeVer || !codexVer) {
    console.error('请先确保本机已安装并登录 claude 与 codex CLI 后再运行实机协同脚本。');
    process.exit(1);
  }

  const repoDir = createDemoGitRepo();
  const manager = new TeamworkManager({
    inMemory: true,
    driverRegistry: createDefaultDriverRegistry(),
    defaultRepoPath: repoDir
  });

  try {
    const swarm = manager.createSwarm({
      id: 'real-cli-collab',
      title: '本机真实 Claude Code + Codex CLI 协同开发演练',
      repoPath: repoDir,
      enableMonitor: false
    });

    swarm.on('agent_log', (log) => {
      console.log(`  [LIVE ${log.member} · ${log.eventType}] ${log.text}`);
    });
    swarm.on('message', (msg) => {
      console.log(`\n=== #${msg.seq} [@${msg.author}] (${msg.channel}) ===\n${msg.text}\n`);
    });

    swarm.addMember({
      name: 'claude-arch',
      role: MEMBER_ROLES.ARCHITECT,
      driver: 'cli-agent',
      workspace: WORKSPACE_MODES.SHARE,
      owns: ['docs/**', 'CONTRACT.json'],
      mustNotTouch: ['src/**', 'tests/**'],
      postBrief: false,
      driverConfig: { preset: 'claude-code', permissionMode: 'acceptEdits', timeoutMs: 120_000 },
      brief: '你是架构师，请在 docs/SPEC.md 中用简洁中文定义 src/slugify.mjs 的函数签名 slugify(text) 并回复 @coordinator。'
    });

    swarm.addMember({
      name: 'codex-dev',
      role: MEMBER_ROLES.AUTHOR,
      driver: 'cli-agent',
      workspace: WORKSPACE_MODES.SHARE,
      owns: ['src/**'],
      mustNotTouch: ['docs/**', 'tests/**'],
      postBrief: false,
      driverConfig: { preset: 'codex-cli', sandbox: 'workspace-write', timeoutMs: 120_000 },
      brief: '你是后端开发作者，请依据 docs/SPEC.md 在 src/slugify.mjs 实现 slugify(text) 并用简体中文回复 @coordinator。'
    });

    console.log(`[yunyu cli-collab] 沙盒仓库：${repoDir}`);
    swarm.postMessage({
      author: 'coordinator',
      text: '@claude-arch 请在 docs/SPEC.md 写一份不超过 15 行的极简接口契约，定义 `src/slugify.mjs` 导出 `slugify(input)`，完成后向 @coordinator 汇报。'
    });
    await swarm.waitIdle({ timeoutMs: 180_000 });

    if (swarm.worktrees.listChangedFiles('claude-arch').length > 0) {
      swarm.worktrees.commitChanges('claude-arch', 'docs(arch): add slugify spec');
      swarm.worktrees.mergeToBase('claude-arch');
    }

    swarm.postMessage({
      author: 'coordinator',
      text: '@codex-dev 架构契约已合并到主分支。请读取 `docs/SPEC.md` 并在 `src/slugify.mjs` 实现 `slugify(input)`，完成后向 @coordinator 汇报。'
    });
    await swarm.waitIdle({ timeoutMs: 180_000 });

    console.log('[yunyu cli-collab] 会话上下文 ID：', {
      claude: swarm.members.get('claude-arch')?.sessionId,
      codex: swarm.members.get('codex-dev')?.sessionId
    });
  } finally {
    manager.disposeAll();
    if (!keepRepo) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    } else {
      console.log(`[yunyu cli-collab] 已保留沙盒仓库：${repoDir}`);
    }
  }
}

main().catch((err) => {
  console.error('[yunyu cli-collab] 失败:', err);
  process.exit(1);
});
