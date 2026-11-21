import { spawn } from 'node:child_process';
import { AgentDriver } from './base.mjs';

export const CLI_PRESETS = Object.freeze({
  'claude-code': {
    bin: process.env.CLAUDE_CLI_BIN || 'claude',
    buildArgs: (prompt) => ['-p', prompt, '--output-format', 'text']
  },
  'codex-cli': {
    bin: process.env.CODEX_CLI_BIN || 'codex',
    buildArgs: (prompt) => ['exec', prompt]
  },
  'gemini-cli': {
    bin: process.env.GEMINI_CLI_BIN || 'gemini',
    buildArgs: (prompt) => ['-p', prompt]
  }
});

/**
 * External CLI Coding Agent Driver:
 * Spawns Claude Code, OpenAI Codex CLI, Gemini CLI, Aider, or any custom script inside
 * the agent's isolated Git Worktree, injects YUNYU_* context variables, audits modified
 * files via OwnershipGuard, and posts the output back to the Swarm Board.
 */
export class CliAgentDriver extends AgentDriver {
  constructor() {
    super('cli-agent', '外部 CLI 编程智能体驱动（支持 Claude Code / Codex CLI / Gemini CLI / 自定义脚本）');
  }

  async executeTurn(ctx) {
    const { swarm, member, triggerMessage, unreadMessages, ownership, worktrees } = ctx;
    const cfg = member.driverConfig || {};
    const preset = cfg.preset ? CLI_PRESETS[cfg.preset] : null;
    const bin = cfg.command || preset?.bin;
    if (!bin) {
      throw new Error('cli-agent 驱动缺少 command 或已知 preset（claude-code / codex-cli / gemini-cli）');
    }

    const prompt = [
      `你是云驭协同（Yunyu Teamwork）蜂群成员 @${member.name}（角色：${member.role}）。`,
      `任务书：${member.brief || '执行分配任务'}`,
      `允许修改路径：${member.owns.join(', ') || '按契约'}；禁止修改路径：${member.mustNotTouch.join(', ') || '无'}。`,
      `触发消息 #${triggerMessage.seq}（来自 ${triggerMessage.author}）：`,
      (unreadMessages.length ? unreadMessages : [triggerMessage])
        .map((m) => `#${m.seq} [${m.channel}] ${m.author}: ${m.text}`)
        .join('\n'),
      '请直接完成任务并输出清晰的简体中文交付汇报（含改动文件、测试命令结果与下一环节 @ 交接）。'
    ].join('\n\n');

    const args = Array.isArray(cfg.args)
      ? cfg.args.map((a) => a.replaceAll('{{PROMPT}}', prompt))
      : preset
        ? preset.buildArgs(prompt)
        : [prompt];

    const env = {
      ...process.env,
      ...(cfg.env || {}),
      YUNYU_SWARM_ID: swarm.id,
      YUNYU_AGENT_NAME: member.name,
      YUNYU_AGENT_ROLE: member.role,
      YUNYU_TRIGGER_SEQ: String(triggerMessage.seq),
      YUNYU_WORKSPACE_DIR: member.workspaceDir || swarm.repoPath || process.cwd(),
      YUNYU_OWNED_PATHS: member.owns.join(','),
      YUNYU_FORBIDDEN_PATHS: member.mustNotTouch.join(','),
      YUNYU_PROMPT: prompt
    };

    const timeoutMs = cfg.timeoutMs || 180_000;
    const cwd = member.workspaceDir || swarm.repoPath || process.cwd();

    const { exitCode, stdout, stderr } = await runProcess(bin, args, {
      cwd,
      env,
      stdin: cfg.passPromptViaStdin ? prompt : null,
      timeoutMs
    });

    if (exitCode !== 0) {
      throw new Error(`CLI Agent (${bin}) 退出码 ${exitCode}: ${(stderr || stdout).slice(0, 400)}`);
    }

    // Post-execution OwnershipGuard verification on any changed files in the agent's worktree
    const changed = worktrees.listChangedFiles(member.name);
    if (changed.length > 0) {
      const audit = ownership.auditChangedFiles(member.name, changed);
      if (!audit.passed) {
        const msg = audit.violations.map((v) => `${v.path}（${v.reason}）`).join('；');
        throw new Error(`CLI Agent 越权修改文件被拦截：${msg}`);
      }
    }

    const reply = stdout.trim() || `@coordinator 已完成 #${triggerMessage.seq} 处理（无标准输出）。`;
    return {
      reply,
      channel: triggerMessage.channel,
      metadata: {
        driver: 'cli-agent',
        preset: cfg.preset || 'custom',
        changedFiles: changed
      }
    };
  }
}

function runProcess(bin, args, { cwd, env, stdin, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env,
      shell: process.platform === 'win32' && !bin.endsWith('.exe'),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        reject(new Error(`CLI Agent 执行超时 (${timeoutMs}ms)`));
      } else {
        resolve({ exitCode: code ?? 0, stdout, stderr });
      }
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
