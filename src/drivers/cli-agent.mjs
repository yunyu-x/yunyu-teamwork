import { execFile, spawn } from 'node:child_process';
import { AgentDriver } from './base.mjs';

const SAFE_FLAG_VALUE_RE = /^[A-Za-z0-9._:/-]+$/;
const MAX_CLI_BUFFER_CHARS = 2 * 1024 * 1024;

function assertSafeCliToken(label, val) {
  const s = String(val || '').trim();
  if (!s || !SAFE_FLAG_VALUE_RE.test(s) || s.startsWith('-')) {
    throw new Error(`安全拦截：CLI 参数 ${label} 包含非法字符 "${val}"`);
  }
  return s;
}

export const CLI_PRESETS = Object.freeze({
  'claude-code': {
    bin: process.env.CLAUDE_CLI_BIN || 'claude',
    parser: 'claude-stream-json',
    buildArgs: (prompt) => ['-p', prompt, '--output-format', 'text'],
    buildInvocation({ prompt, member, cfg, sessionId }) {
      const useStream = cfg.outputFormat !== 'text';
      const args = ['-p'];
      if (useStream) {
        args.push('--output-format', 'stream-json', '--verbose');
      } else {
        args.push('--output-format', 'text');
      }
      if (member.model && member.model !== 'default') {
        args.push('--model', assertSafeCliToken('model', member.model));
      }
      if (cfg.permissionMode) {
        args.push('--permission-mode', assertSafeCliToken('permissionMode', cfg.permissionMode));
      }
      if (sessionId && cfg.resumeSession !== false) {
        args.push('--resume', assertSafeCliToken('sessionId', sessionId));
      }
      if (Array.isArray(cfg.extraArgs)) {
        for (const a of cfg.extraArgs) args.push(String(a));
      }
      return {
        args,
        stdin: prompt,
        parser: useStream ? 'claude-stream-json' : 'text'
      };
    }
  },
  'codex-cli': {
    bin: process.env.CODEX_CLI_BIN || 'codex',
    parser: 'codex-json',
    buildArgs: (prompt) => ['exec', prompt],
    buildInvocation({ prompt, member, cfg, sessionId }) {
      const useJson = cfg.outputFormat !== 'text';
      const isResume = Boolean(sessionId && cfg.resumeSession !== false);
      const args = isResume ? ['exec', 'resume'] : ['exec'];
      if (useJson) args.push('--json');
      if (member.model && member.model !== 'default') {
        args.push('--model', assertSafeCliToken('model', member.model));
      }
      if (!isResume && cfg.sandbox !== false) {
        const readOnlyRole =
          member.role === 'verifier' ||
          member.role === 'reviewer' ||
          member.role === 'researcher' ||
          member.role === 'qa';
        const defaultSandbox = readOnlyRole ? 'read-only' : 'workspace-write';
        args.push('--sandbox', assertSafeCliToken('sandbox', cfg.sandbox || defaultSandbox));
      }
      if (cfg.skipGitRepoCheck) {
        args.push('--skip-git-repo-check');
      }
      if (Array.isArray(cfg.extraArgs)) {
        for (const a of cfg.extraArgs) args.push(String(a));
      }
      if (isResume) {
        args.push(assertSafeCliToken('sessionId', sessionId), '-');
      } else {
        args.push('-');
      }
      return {
        args,
        stdin: prompt,
        parser: useJson ? 'codex-json' : 'text'
      };
    }
  },
  'gemini-cli': {
    bin: process.env.GEMINI_CLI_BIN || 'gemini',
    parser: 'text',
    buildArgs: (prompt) => ['-p', prompt],
    buildInvocation({ prompt, cfg }) {
      // Pass prompt via stdin to avoid Windows cmd.exe shell metacharacter injection & CLI length limits
      const args = [];
      if (Array.isArray(cfg.extraArgs)) {
        for (const a of cfg.extraArgs) args.push(String(a));
      }
      return {
        args,
        stdin: prompt,
        parser: 'text'
      };
    }
  }
});

/**
 * External CLI Coding Agent Driver:
 * Spawns Claude Code, OpenAI Codex CLI, Gemini CLI, Aider, or any custom script inside
 * the agent's isolated Git Worktree, streams stdout/stderr JSONL events in real time to SSE,
 * persists session/thread IDs for multi-turn `--resume` / `exec resume`, audits modified
 * files via OwnershipGuard, and posts the reply back to the Swarm Board.
 */
export class CliAgentDriver extends AgentDriver {
  constructor() {
    super('cli-agent', '外部 CLI 编程智能体驱动（支持 Claude Code / Codex CLI / Gemini CLI 实时流式日志与会话复用）');
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

    const activeSessionId = member.sessionId || cfg.sessionId || null;
    let currentSessionId = activeSessionId;
    const runAttempt = async (sessionIdToUse) => {
      const prefixArgs = Array.isArray(cfg.commandPrefixArgs) ? cfg.commandPrefixArgs : [];
      let invArgs;
      let stdinPayload = null;
      let parserMode = cfg.parser || 'text';

      if (Array.isArray(cfg.args)) {
        invArgs = cfg.args.map((a) => a.replaceAll('{{PROMPT}}', prompt));
        stdinPayload = cfg.passPromptViaStdin ? prompt : null;
      } else if (preset && typeof preset.buildInvocation === 'function') {
        const inv = preset.buildInvocation({ prompt, member, cfg, sessionId: sessionIdToUse });
        invArgs = inv.args;
        stdinPayload = inv.stdin;
        parserMode = inv.parser;
      } else {
        invArgs = [prompt];
      }

      const finalArgs = [...prefixArgs, ...invArgs];
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
        YUNYU_SESSION_ID: sessionIdToUse || '',
        YUNYU_PROMPT: prompt
      };

      const timeoutMs = cfg.timeoutMs || 180_000;
      const cwd = member.workspaceDir || swarm.repoPath || process.cwd();
      const parserState = createStreamParserState(parserMode);

      swarm.emitAgentLog?.({
        member: member.name,
        stream: 'system',
        eventType: 'turn_start',
        text: `启动 CLI Agent (${cfg.preset || bin})${sessionIdToUse ? ` · 恢复会话 ${sessionIdToUse}` : ' · 新会话'}`,
        meta: { triggerSeq: triggerMessage.seq, preset: cfg.preset || 'custom', sessionId: sessionIdToUse }
      });

      const procRes = await runProcessStreaming(bin, finalArgs, {
        cwd,
        env,
        stdin: stdinPayload,
        timeoutMs,
        onLine: (stream, line) => {
          const events = feedStreamLine(parserState, stream, line);
          for (const ev of events) {
            swarm.emitAgentLog?.({
              member: member.name,
              stream,
              eventType: ev.eventType,
              text: ev.text,
              meta: ev.meta || null
            });
          }
        }
      });

      return { ...procRes, parserState, parserMode };
    };

    let attempt = await runAttempt(activeSessionId);

    // If resuming an expired/stale CLI session failed, clear session and retry once cleanly
    if (
      attempt.exitCode !== 0 &&
      activeSessionId &&
      cfg.retryFreshSessionOnError !== false
    ) {
      swarm.emitAgentLog?.({
        member: member.name,
        stream: 'stderr',
        eventType: 'session_fallback',
        text: `会话 ${activeSessionId} 恢复失败（exit=${attempt.exitCode}），自动重置并开启新会话重试...`
      });
      member.sessionId = null;
      currentSessionId = null;
      if (member.driverConfig) delete member.driverConfig.sessionId;
      attempt = await runAttempt(null);
    }

    if (attempt.exitCode !== 0) {
      throw new Error(`CLI Agent (${bin}) 退出码 ${attempt.exitCode}: ${(attempt.stderr || attempt.stdout).slice(0, 400)}`);
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

    const extractedReply =
      attempt.parserState.finalText?.trim() ||
      attempt.parserState.assistantChunks.join('\n').trim() ||
      attempt.stdout.trim() ||
      `@coordinator 已完成 #${triggerMessage.seq} 处理（无标准输出）。`;

    const discoveredSessionId = attempt.parserState.sessionId || currentSessionId || null;
    if (discoveredSessionId) {
      member.sessionId = discoveredSessionId;
      member.driverConfig = { ...(member.driverConfig || {}), sessionId: discoveredSessionId };
    }

    swarm.emitAgentLog?.({
      member: member.name,
      stream: 'system',
      eventType: 'turn_end',
      text: `执行完成${discoveredSessionId ? ` · 会话 ${discoveredSessionId}` : ''}${attempt.parserState.tokensUsed ? ` · tokens=${attempt.parserState.tokensUsed}` : ''}`,
      meta: { sessionId: discoveredSessionId, tokensUsed: attempt.parserState.tokensUsed, changedFiles: changed }
    });

    return {
      reply: extractedReply,
      channel: triggerMessage.channel,
      sessionId: discoveredSessionId,
      tokensUsed: attempt.parserState.tokensUsed || 0,
      metadata: {
        driver: 'cli-agent',
        preset: cfg.preset || 'custom',
        sessionId: discoveredSessionId,
        changedFiles: changed
      }
    };
  }
}

function createStreamParserState(mode) {
  return {
    mode,
    sessionId: null,
    finalText: '',
    assistantChunks: [],
    tokensUsed: 0
  };
}

function feedStreamLine(state, stream, rawLine) {
  const line = String(rawLine || '').trim();
  if (!line) return [];
  if (stream === 'stderr') {
    return [{ eventType: 'stderr', text: line.slice(0, 600) }];
  }

  if (state.mode === 'claude-stream-json') {
    try {
      const obj = JSON.parse(line);
      if (obj.session_id) state.sessionId = obj.session_id;
      const out = [];

      if (obj.type === 'system') {
        out.push({
          eventType: 'init',
          text: `[Claude ${obj.subtype || 'system'}] session=${obj.session_id || '-'} model=${obj.model || '-'}`
        });
      } else if (obj.type === 'assistant') {
        const blocks = Array.isArray(obj.message?.content) ? obj.message.content : [];
        for (const blk of blocks) {
          if (blk.type === 'tool_use') {
            const summary = blk.input ? JSON.stringify(blk.input).slice(0, 140) : '';
            out.push({ eventType: 'tool_use', text: `🔧 ${blk.name}(${summary})` });
          } else if (blk.type === 'text' && blk.text) {
            state.assistantChunks.push(blk.text);
            out.push({ eventType: 'assistant', text: blk.text.slice(0, 500) });
          } else if (blk.type === 'thinking' && blk.thinking) {
            out.push({ eventType: 'thinking', text: blk.thinking.slice(0, 300) });
          }
        }
      } else if (obj.type === 'result') {
        if (typeof obj.result === 'string' && obj.result.trim()) {
          state.finalText = obj.result;
        }
        const usage = obj.usage || {};
        const toks = (usage.input_tokens || 0) + (usage.output_tokens || 0);
        if (toks > 0) state.tokensUsed += toks;
        out.push({
          eventType: 'result',
          text: (obj.result || '[完成]').slice(0, 500),
          meta: { sessionId: obj.session_id, tokensUsed: toks }
        });
      } else if (obj.type === 'content_block_delta' && obj.delta?.text) {
        out.push({ eventType: 'delta', text: obj.delta.text });
      }
      return out;
    } catch {
      return [{ eventType: 'stdout', text: line.slice(0, 600) }];
    }
  }

  if (state.mode === 'codex-json') {
    try {
      const obj = JSON.parse(line);
      const out = [];
      if (obj.type === 'thread.started' && obj.thread_id) {
        state.sessionId = obj.thread_id;
        out.push({ eventType: 'init', text: `[Codex thread] ${obj.thread_id}` });
      } else if (obj.type === 'item.started' || obj.type === 'item.completed') {
        const item = obj.item || {};
        if (item.type === 'command_execution') {
          const cmd = item.command || '';
          const agg = item.aggregated_output ? ` -> ${String(item.aggregated_output).trim().slice(0, 180)}` : '';
          out.push({ eventType: 'tool_use', text: `$ ${cmd}${agg}` });
        } else if (item.type === 'file_change') {
          const files = (item.changes || []).map((c) => c.path).join(', ');
          out.push({ eventType: 'tool_use', text: `📝 文件变更: ${files || JSON.stringify(item).slice(0, 160)}` });
        } else if (item.type === 'agent_message' && item.text) {
          state.finalText = item.text;
          state.assistantChunks.push(item.text);
          out.push({ eventType: 'assistant', text: item.text.slice(0, 500) });
        } else if (item.type === 'reasoning' && item.text) {
          out.push({ eventType: 'thinking', text: item.text.slice(0, 300) });
        }
      } else if (obj.type === 'turn.completed' && obj.usage) {
        const toks = (obj.usage.input_tokens || 0) + (obj.usage.output_tokens || 0);
        if (toks > 0) state.tokensUsed += toks;
        out.push({ eventType: 'result', text: `[Codex turn.completed] tokens=${toks}` });
      }
      return out;
    } catch {
      return [{ eventType: 'stdout', text: line.slice(0, 600) }];
    }
  }

  return [{ eventType: 'stdout', text: line.slice(0, 600) }];
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    try {
      child.kill('SIGTERM');
    } catch {}
    const hard = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 1500);
    if (typeof hard.unref === 'function') hard.unref();
  }
}

function runProcessStreaming(bin, args, { cwd, env, stdin, timeoutMs, onLine }) {
  return new Promise((resolve, reject) => {
    const lowerBin = String(bin || '').toLowerCase();
    const isDirectExe = lowerBin.endsWith('.exe') || lowerBin === process.execPath.toLowerCase();
    const useWinCmdShell = process.platform === 'win32' && !isDirectExe && /\.(cmd|bat)$/.test(lowerBin);

    const child = spawn(bin, args, {
      cwd,
      env,
      shell: useWinCmdShell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let outBuf = '';
    let errBuf = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      killProcessTree(child);
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    const flushLines = (stream, chunkStr) => {
      if (stream === 'stdout') {
        outBuf += chunkStr;
        const parts = outBuf.split(/\r?\n/);
        outBuf = parts.pop() || '';
        for (const p of parts) onLine?.('stdout', p);
      } else {
        errBuf += chunkStr;
        const parts = errBuf.split(/\r?\n/);
        errBuf = parts.pop() || '';
        for (const p of parts) onLine?.('stderr', p);
      }
    };

    child.stdout.on('data', (d) => {
      const s = d.toString('utf8');
      if (stdout.length < MAX_CLI_BUFFER_CHARS) stdout += s.slice(0, MAX_CLI_BUFFER_CHARS - stdout.length);
      flushLines('stdout', s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      if (stderr.length < MAX_CLI_BUFFER_CHARS) stderr += s.slice(0, MAX_CLI_BUFFER_CHARS - stderr.length);
      flushLines('stderr', s);
    });
    child.stdin.on('error', () => {
      // Ignore EPIPE if child process exits before consuming stdin
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (outBuf.trim()) onLine?.('stdout', outBuf);
      if (errBuf.trim()) onLine?.('stderr', errBuf);
      if (killedByTimeout) {
        reject(new Error(`CLI Agent 执行超时 (${timeoutMs}ms)`));
      } else {
        resolve({ exitCode: code ?? 0, stdout, stderr });
      }
    });

    if (stdin !== null && stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
