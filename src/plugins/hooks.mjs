import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export const HOOK_EVENTS = Object.freeze([
  'SessionStart',
  'PreTurn',
  'PostTurn',
  'PreToolUse',
  'PostToolUse',
  'OnMessage',
  'PreCommit',
  'PreMerge',
  'OnIssueTransition',
  'OnAudit'
]);

const VALID_HOOK_EVENTS = new Set(HOOK_EVENTS);
const SENSITIVE_ENV_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|COOKIE|AUTH|PRIVATE|CREDENTIAL|BEARER|DATABASE_URL|POSTGRES|REDIS|PROXY|SSH_AUTH_SOCK|AWS_SESSION)/i;
const BLOCKED_EXTRA_ENV = new Set(['NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']);
const WIN_SHELL_META_RE = /[&|<>^%!\r\n"`]/;
const MAX_PATTERN_LEN = 512;
const MAX_TARGET_BYTES = 16_384;

function compileSafeRegex(pattern) {
  if (!pattern) return null;
  const s = String(pattern);
  if (s.length > MAX_PATTERN_LEN) {
    throw new Error(`安全拦截：Hook 正则长度超出 ${MAX_PATTERN_LEN} 字符限制`);
  }
  // Reject classic catastrophic backtracking constructs (nested quantifiers & backreferences)
  if (/(?:[+*]|\{\d+,\d*\})\)?[+*?]/.test(s) || /\\\d/.test(s) || /\([^)]*[+*][^)]*\)[+*{]/.test(s)) {
    throw new Error(`安全拦截：Hook 正则疑似存在 ReDoS 嵌套量词风险 "${s.slice(0, 64)}"`);
  }
  return new RegExp(s, 'i');
}

function sanitizeHookEnv(extraEnv = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'NODE_TEST_CONTEXT') continue;
    if (SENSITIVE_ENV_RE.test(k)) continue;
    clean[k] = v;
  }
  for (const [k, v] of Object.entries(extraEnv || {})) {
    if (typeof v === 'string' && !BLOCKED_EXTRA_ENV.has(k.toUpperCase())) clean[k] = v;
  }
  return clean;
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {}
    }
    const hard = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }, 1000);
    if (typeof hard.unref === 'function') hard.unref();
  }
}

function globMatchLinear(pattern, text) {
  const p = pattern.toLowerCase().replace(/\*+/g, '*');
  const t = text.toLowerCase();
  let pi = 0;
  let ti = 0;
  let starIdx = -1;
  let matchIdx = 0;
  while (ti < t.length) {
    if (pi < p.length && p[pi] === t[ti]) {
      pi += 1;
      ti += 1;
    } else if (pi < p.length && p[pi] === '*') {
      starIdx = pi;
      matchIdx = ti;
      pi += 1;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx += 1;
      ti = matchIdx;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === '*') pi += 1;
  return pi === p.length;
}

function matchesFilter(matcher, target) {
  if (!matcher || matcher === '*' || matcher === 'all') return true;
  if (!target) return false;
  const targetStr = String(target).slice(0, 256);
  const patterns = Array.isArray(matcher) ? matcher : String(matcher).split('|').map((s) => s.trim()).filter(Boolean);
  return patterns.some((pat) => {
    if (pat === '*') return true;
    if (pat.includes('*')) return globMatchLinear(pat, targetStr);
    return targetStr.toLowerCase() === pat.toLowerCase();
  });
}

function runCommandHook(hook, payload, { cwd, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const bin = String(hook.command || '').trim();
    const failDecision = hook.failClosed ? 'deny' : 'allow';
    if (!bin) {
      resolve({ decision: 'allow', skipped: true, reason: 'Hook 缺少 command' });
      return;
    }
    const args = Array.isArray(hook.args) ? hook.args.map(String) : [];
    const lowerBin = bin.toLowerCase();
    const isDirectExe = lowerBin.endsWith('.exe') || lowerBin === process.execPath.toLowerCase();
    const useWinCmdShell = process.platform === 'win32' && !isDirectExe && /\.(cmd|bat)$/.test(lowerBin);

    if (useWinCmdShell && (WIN_SHELL_META_RE.test(bin) || args.some((a) => WIN_SHELL_META_RE.test(a)))) {
      resolve({ decision: 'deny', error: '安全拦截：Windows .cmd/.bat Hook 参数包含非法 Shell 元字符' });
      return;
    }

    let child;
    try {
      child = spawn(bin, args, {
        cwd: cwd || process.cwd(),
        env: sanitizeHookEnv(hook.env),
        shell: useWinCmdShell,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ decision: failDecision, reason: hook.failClosed ? `Hook 启动失败: ${err.message}` : '', error: err.message || String(err) });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, hook.timeoutMs || timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (d) => {
      if (stdout.length < 65_536) stdout += d.toString('utf8').slice(0, 65_536 - stdout.length);
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < 32_768) stderr += d.toString('utf8').slice(0, 32_768 - stderr.length);
    });
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ decision: failDecision, reason: hook.failClosed ? `Hook 执行出错: ${err.message}` : '', error: err.message || String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const msg = `Hook 脚本执行超时 (${hook.timeoutMs || timeoutMs}ms)`;
        resolve({ decision: failDecision, reason: hook.failClosed ? msg : '', error: msg });
        return;
      }
      const trimmed = stdout.trim();
      if (trimmed) {
        let parsed = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          try {
            parsed = JSON.parse(trimmed.split(/\r?\n/).pop());
          } catch {}
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          resolve({
            decision: parsed.decision === 'deny' || parsed.decision === 'block' ? 'deny' : 'allow',
            reason: parsed.reason || parsed.message || '',
            additionalContext: parsed.additionalContext || parsed.context || '',
            exitCode: code ?? 0
          });
          return;
        }
      }
      // Convention (Claude Code / TeamAI): exit code 2 means deterministic block with stderr message
      if (code === 2) {
        resolve({
          decision: 'deny',
          reason: (stderr || stdout || 'Hook 脚本返回拦截退出码 2').trim().slice(0, 300),
          exitCode: 2
        });
        return;
      }
      resolve({
        decision: 'allow',
        additionalContext: trimmed.slice(0, 1000),
        exitCode: code ?? 0,
        stderr: stderr.trim().slice(0, 300)
      });
    });

    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch {}
  });
}

/**
 * Deterministic Lifecycle Hook Engine inspired by Claude Code Hooks, TeamAI `hooks.yaml`,
 * and Routa Guard Hooks. Supports zero-shell `policy` & `builtin` hooks (always safe)
 * plus opt-in trusted `command` hooks with JSON stdin/stdout decisions and append-only audit log.
 */
export class HookEngine extends EventEmitter {
  constructor({ allowExecHooks = false, maxHistory = 200, auditLogPath = null } = {}) {
    super();
    this.allowExecHooks = Boolean(allowExecHooks);
    this.maxHistory = maxHistory;
    this.auditLogPath = auditLogPath ? path.resolve(auditLogPath) : null;
    this.hooks = [];
    this.history = [];
    this._replayAuditLog();
  }

  _replayAuditLog() {
    if (!this.auditLogPath || !fs.existsSync(this.auditLogPath)) return;
    try {
      const lines = fs.readFileSync(this.auditLogPath, 'utf8').split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-this.maxHistory);
      for (const line of tail) {
        try {
          const rec = JSON.parse(line);
          if (rec && rec.event) this.history.push(rec);
        } catch {}
      }
    } catch {}
  }

  _recordAudit(record) {
    this.history.push(record);
    if (this.history.length > this.maxHistory) this.history.shift();
    if (this.auditLogPath) {
      try {
        fs.mkdirSync(path.dirname(this.auditLogPath), { recursive: true, mode: 0o700 });
        fs.appendFileSync(this.auditLogPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      } catch {}
    }
    this.emit('hook_run', record);
  }

  clearPluginHooks(pluginId = null) {
    if (!pluginId) {
      this.hooks = [];
    } else {
      this.hooks = this.hooks.filter((h) => h.pluginId !== pluginId);
    }
  }

  clearNonCustomHooks() {
    this.hooks = this.hooks.filter((h) => h.pluginId === 'custom');
  }

  registerHook(rawHook) {
    if (!rawHook || !VALID_HOOK_EVENTS.has(rawHook.event)) {
      throw new Error(`不支持的 Hook 生命周期事件 "${rawHook?.event}"，可选：${HOOK_EVENTS.join(', ')}`);
    }
    let compiledPattern = null;
    let patternError = null;
    if (rawHook.pattern) {
      try {
        compiledPattern = compileSafeRegex(rawHook.pattern);
      } catch (err) {
        if (err.message.includes('ReDoS') || err.message.includes('长度超出')) throw err;
        patternError = `非法正则 pattern: ${err.message}`;
      }
    }
    const hook = {
      id: String(rawHook.id || `hook-${this.hooks.length + 1}`),
      pluginId: rawHook.pluginId || 'custom',
      event: rawHook.event,
      matcher: rawHook.matcher || '*',
      type: rawHook.type || (rawHook.command ? 'command' : 'policy'),
      action: rawHook.action || 'deny',
      pattern: rawHook.pattern || null,
      _compiledPattern: compiledPattern,
      _patternError: patternError,
      reason: rawHook.reason || '命中生命周期安全 Hook 策略',
      additionalContext: rawHook.additionalContext || rawHook.context || '',
      command: rawHook.command || null,
      args: Array.isArray(rawHook.args) ? [...rawHook.args] : [],
      env: rawHook.env && typeof rawHook.env === 'object' ? { ...rawHook.env } : {},
      timeoutMs: Number(rawHook.timeoutMs) > 0 ? Number(rawHook.timeoutMs) : 8000,
      failClosed: Boolean(rawHook.failClosed),
      trusted: Boolean(rawHook.trusted),
      enabled: rawHook.enabled !== false,
      description: rawHook.description || ''
    };
    const idx = this.hooks.findIndex((h) => h.pluginId === hook.pluginId && h.id === hook.id);
    if (idx >= 0) this.hooks[idx] = hook;
    else this.hooks.push(hook);
    return this._publicHook(hook);
  }

  _publicHook(h) {
    const { _compiledPattern, _patternError, env, ...rest } = h;
    return {
      ...rest,
      envKeys: Object.keys(env || {})
    };
  }

  listHooks({ event = null } = {}) {
    let list = this.hooks;
    if (event) list = list.filter((h) => h.event === event);
    return list.map((h) => this._publicHook(h));
  }

  getHistory({ limit = 60 } = {}) {
    return limit > 0 ? this.history.slice(-limit) : [...this.history];
  }

  /**
   * Synchronous evaluation of zero-shell `policy` hooks (used inside synchronous workspace tools
   * so policy guardrails enforce immediately without breaking sync tool callers).
   */
  runSyncPolicies(event, payload = {}) {
    if (!VALID_HOOK_EVENTS.has(event)) {
      return { event, allowed: true, reason: '', warnings: [], additionalContext: '', results: [] };
    }
    const targetName = payload.tool || payload.member || payload.channel || payload.status || payload.command || '';
    const candidates = this.hooks.filter(
      (h) => h.enabled && h.type === 'policy' && h.event === event && matchesFilter(h.matcher, targetName)
    );
    if (candidates.length === 0) {
      return { event, allowed: true, reason: '', warnings: [], additionalContext: '', results: [] };
    }

    let allowed = true;
    let blockReason = '';
    const warnings = [];
    const contexts = [];
    const results = [];
    const serializedTarget = JSON.stringify({
      tool: payload.tool,
      input: payload.input,
      text: payload.text,
      command: payload.command,
      files: payload.files,
      member: payload.member
    }).slice(0, MAX_TARGET_BYTES);

    for (const hook of candidates) {
      const res = { hookId: hook.id, pluginId: hook.pluginId, type: hook.type, decision: 'allow', skipped: false };
      let matched = true;
      if (hook.pattern) {
        if (hook._patternError) {
          matched = false;
          res.error = hook._patternError;
        } else {
          matched = Boolean(hook._compiledPattern?.test(serializedTarget));
        }
      }
      if (matched) {
        if (hook.action === 'deny' || hook.action === 'block') {
          res.decision = 'deny';
          res.reason = hook.reason;
          allowed = false;
          if (!blockReason) blockReason = `[Hook:${hook.id}] ${hook.reason}`;
        } else if (hook.action === 'warn') {
          res.decision = 'warn';
          res.reason = hook.reason;
          warnings.push(`[Hook:${hook.id}] ${hook.reason}`);
        } else if (hook.action === 'inject_context' && hook.additionalContext) {
          res.additionalContext = hook.additionalContext;
          contexts.push(hook.additionalContext);
        }
      }
      results.push(res);
    }

    const record = {
      time: new Date().toISOString(),
      event,
      target: targetName || null,
      allowed,
      reason: blockReason || null,
      warnings,
      matchedHooks: results.length,
      results: results.map((r) => ({
        hookId: r.hookId,
        pluginId: r.pluginId,
        decision: r.decision,
        skipped: false,
        reason: r.reason || null
      }))
    };
    this._recordAudit(record);

    return { event, allowed, reason: blockReason, warnings, additionalContext: contexts.join('\n').trim(), results };
  }

  async run(event, payload = {}, { cwd = null, dryRun = false } = {}) {
    if (!VALID_HOOK_EVENTS.has(event)) {
      return { event, allowed: true, reason: '', warnings: [], additionalContext: '', results: [] };
    }
    const targetName = payload.tool || payload.member || payload.channel || payload.status || payload.command || '';
    const candidates = this.hooks.filter(
      (h) => h.enabled && h.event === event && matchesFilter(h.matcher, targetName)
    );

    let allowed = true;
    let blockReason = '';
    const warnings = [];
    const contexts = [];
    const results = [];

    const serializedTarget = JSON.stringify({
      tool: payload.tool,
      input: payload.input,
      text: payload.text,
      command: payload.command,
      files: payload.files,
      member: payload.member
    }).slice(0, MAX_TARGET_BYTES);

    for (const hook of candidates) {
      let res = { hookId: hook.id, pluginId: hook.pluginId, type: hook.type, decision: 'allow', skipped: false };

      if (hook.type === 'policy') {
        let matched = false;
        if (hook.pattern) {
          if (hook._patternError) {
            res.error = hook._patternError;
          } else {
            matched = Boolean(hook._compiledPattern?.test(serializedTarget));
          }
        } else {
          matched = true;
        }

        if (matched) {
          if (hook.action === 'deny' || hook.action === 'block') {
            res.decision = 'deny';
            res.reason = hook.reason;
            allowed = false;
            if (!blockReason) blockReason = `[Hook:${hook.id}] ${hook.reason}`;
          } else if (hook.action === 'warn') {
            res.decision = 'warn';
            res.reason = hook.reason;
            warnings.push(`[Hook:${hook.id}] ${hook.reason}`);
          } else if (hook.action === 'inject_context' && hook.additionalContext) {
            res.additionalContext = hook.additionalContext;
            contexts.push(hook.additionalContext);
          }
        }
      } else if (hook.type === 'builtin') {
        res.decision = 'allow';
        res.builtinAction = hook.action;
        if (hook.additionalContext) contexts.push(hook.additionalContext);
      } else if (hook.type === 'command') {
        if (dryRun) {
          res.skipped = true;
          res.reason = 'Dry-Run 演练模式默认跳过命令型 Hook 进程执行';
        } else if (!this.allowExecHooks || !hook.trusted) {
          res.skipped = true;
          res.reason = !hook.trusted
            ? '未授信插件的命令 Hook 默认跳过执行（请在插件中心开启信任）'
            : '服务端未启用命令型 Hook 执行（YUNYU_ALLOW_EXEC_HOOKS=true）';
        } else {
          const cmdRes = await runCommandHook(hook, { event, ...payload }, { cwd });
          res = { ...res, ...cmdRes };
          if (cmdRes.decision === 'deny') {
            allowed = false;
            if (!blockReason) blockReason = `[Hook:${hook.id}] ${cmdRes.reason || hook.reason}`;
          }
          if (cmdRes.additionalContext) contexts.push(cmdRes.additionalContext);
        }
      }

      results.push(res);
    }

    const record = {
      time: new Date().toISOString(),
      event,
      target: targetName || null,
      allowed,
      reason: blockReason || null,
      warnings,
      matchedHooks: results.length,
      results: results.map((r) => ({
        hookId: r.hookId,
        pluginId: r.pluginId,
        decision: r.decision,
        skipped: Boolean(r.skipped),
        reason: r.reason || null
      }))
    };

    if (results.length > 0 || !allowed) {
      this._recordAudit(record);
    }

    return {
      event,
      allowed,
      reason: blockReason,
      warnings,
      additionalContext: contexts.join('\n').trim(),
      results
    };
  }
}
