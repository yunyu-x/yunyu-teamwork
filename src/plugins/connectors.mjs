import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SAFE_BIN_RE = /^[A-Za-z0-9._:\\/ -]+$/;
const FORBIDDEN_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function yamlScalar(val) {
  return JSON.stringify(String(val ?? '').replace(/[\r\n]+/g, ' ').trim());
}

function yamlArray(arr) {
  return `[${(Array.isArray(arr) ? arr : []).map((x) => yamlScalar(x)).join(', ')}]`;
}

export const HARNESS_CATALOG = Object.freeze([
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    vendor: 'Anthropic',
    category: 'cli',
    probeBin: process.env.CLAUDE_CLI_BIN || 'claude',
    configDirs: ['.claude', '.mcp.json', 'CLAUDE.md'],
    capabilities: ['cli-stream', 'session-resume', 'mcp', 'skills', 'rules', 'hooks', 'commands', 'agents'],
    description: '支持流式 stream-json、--resume 会话复用、.claude/skills 与 .mcp.json 双向同步'
  },
  {
    id: 'codex-cli',
    name: 'OpenAI Codex CLI',
    vendor: 'OpenAI',
    category: 'cli',
    probeBin: process.env.CODEX_CLI_BIN || 'codex',
    configDirs: ['.codex', 'AGENTS.md'],
    capabilities: ['cli-stream', 'session-resume', 'sandbox', 'mcp', 'skills', 'rules', 'agents'],
    description: '支持 exec --json、exec resume、只读沙箱隔离、AGENTS.md 与 .codex/skills 同步'
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    category: 'cli',
    probeBin: process.env.GEMINI_CLI_BIN || 'gemini',
    configDirs: ['.gemini', 'GEMINI.md'],
    capabilities: ['cli-stdin', 'mcp', 'skills', 'rules'],
    description: '支持 stdin 提示注入、.gemini/settings.json MCP 声明与 GEMINI.md 规则同步'
  },
  {
    id: 'cursor',
    name: 'Cursor IDE',
    vendor: 'Cursor',
    category: 'ide',
    probeBin: 'cursor',
    configDirs: ['.cursor/rules', '.cursor/mcp.json'],
    capabilities: ['mcp', 'rules', 'skills'],
    description: '一键导出 .cursor/rules/*.mdc 规则与 .cursor/mcp.json 团队统一 MCP 连接'
  },
  {
    id: 'opencode',
    name: 'OpenCode CLI',
    vendor: 'OpenCode',
    category: 'cli',
    probeBin: 'opencode',
    configDirs: ['.opencode', 'opencode.json'],
    capabilities: ['cli', 'mcp', 'skills', 'rules'],
    description: '兼容 TeamAI 开源 CLI 生态，同步 opencode.json 与 .opencode/skills'
  },
  {
    id: 'antigravity',
    name: 'Antigravity (AGY)',
    vendor: 'Google DeepMind',
    category: 'ide',
    probeBin: 'agy',
    configDirs: ['.agent', '.gemini/antigravity'],
    capabilities: ['mcp', 'skills', 'rules', 'hooks', 'agents'],
    description: '同步 .agent/skills、.agent/rules 与标准 MCP 插件配置'
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy / TeamAI',
    vendor: 'Tencent',
    category: 'ide',
    probeBin: 'codebuddy',
    configDirs: ['.codebuddy', '.teamai'],
    capabilities: ['mcp', 'skills', 'rules', 'hooks', 'agents'],
    description: '原生兼容 Tencent teamai-cli 资产布局（skills / rules / mcp.yaml / hooks.yaml / agents）'
  },
  {
    id: 'mcp-gateway',
    name: '标准 MCP / Webhook / ACP 网关',
    vendor: 'Open Standard',
    category: 'protocol',
    probeBin: null,
    configDirs: ['bin/yunyu-mcp.mjs'],
    capabilities: ['mcp-server', 'mcp-client', 'webhook', 'im-bridge'],
    description: '内置 MCP JSON-RPC 2.0 双向服务端与客户端、HMAC Webhook 及 6 渠道 IM 网桥'
  }
]);

function safeSlug(raw) {
  const s = String(raw || '').trim();
  const ascii = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  if (ascii && !FORBIDDEN_MAP_KEYS.has(ascii)) return ascii;
  const hash = crypto.createHash('sha1').update(s || 'item').digest('hex').slice(0, 8);
  return `item-${hash}`;
}

function probeBinary(bin) {
  if (!bin) return { installed: true, version: 'builtin' };
  const clean = String(bin).trim();
  if (!SAFE_BIN_RE.test(clean)) return { installed: false, version: null };
  try {
    const out = execFileSync(clean, ['--version'], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })
      .trim()
      .split(/\r?\n/)[0];
    return { installed: true, version: out || 'installed' };
  } catch {
    return { installed: false, version: null };
  }
}

function probeBinaryAsync(bin) {
  if (!bin) return Promise.resolve({ installed: true, version: 'builtin' });
  const clean = String(bin).trim();
  if (!SAFE_BIN_RE.test(clean)) return Promise.resolve({ installed: false, version: null });
  return new Promise((resolve) => {
    execFile(
      clean,
      ['--version'],
      {
        encoding: 'utf8',
        timeout: 2500,
        shell: process.platform === 'win32',
        windowsHide: true
      },
      (err, stdout) => {
        if (err) {
          resolve({ installed: false, version: null });
          return;
        }
        const first = String(stdout || '').trim().split(/\r?\n/)[0];
        resolve({ installed: true, version: first || 'installed' });
      }
    );
  });
}

function assertInsideRoot(rootDir, targetFile) {
  const absRoot = path.resolve(rootDir);
  const absTarget = path.resolve(targetFile);
  const rel = path.relative(absRoot, absTarget);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`安全拦截：同步目标路径 "${targetFile}" 越出仓库根目录`);
  }
  if (fs.existsSync(absRoot)) {
    const realRoot = fs.realpathSync(absRoot);
    // Reject symlinks on any existing path component under root
    const parts = rel.split(path.sep).filter(Boolean);
    let probe = realRoot;
    for (const part of parts) {
      probe = path.join(probe, part);
      if (!fs.existsSync(probe)) break;
      if (fs.lstatSync(probe).isSymbolicLink()) {
        throw new Error(`安全拦截：同步路径包含符号链接 "${part}"，拒绝越界覆盖`);
      }
    }
    let existing = absTarget;
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    if (fs.existsSync(existing)) {
      const realExisting = fs.realpathSync(existing);
      const realRel = path.relative(realRoot, realExisting);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error(`安全拦截：同步目标真实路径越出仓库根目录 "${targetFile}"`);
      }
    }
  }
  return absTarget;
}

function readExistingJsonSafe(absRoot, relPath) {
  try {
    const absFile = assertInsideRoot(absRoot, path.join(absRoot, relPath));
    if (!fs.existsSync(absFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(absFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Multi-Harness Connector & TeamAI Cross-Client Sync Hub:
 * Probes installed local CLI/IDE harnesses and compiles active Yunyu/TeamAI plugin assets
 * (Skills, Rules, Commands, Hooks, MCP Servers) into each client's native config layout.
 */
export class ConnectorHub {
  constructor() {
    this._probeCache = null;
    this._probeAt = 0;
  }

  listConnectors() {
    return HARNESS_CATALOG.map((c) => ({ ...c }));
  }

  probeConnectors({ repoPath = null, force = false } = {}) {
    const now = Date.now();
    const absRepo = repoPath ? path.resolve(repoPath) : null;
    if (!force && this._probeCache && now - this._probeAt < 30_000 && this._probeCache.repoPath === absRepo) {
      return this._probeCache.items;
    }

    const items = HARNESS_CATALOG.map((c) => {
      const binState = probeBinary(c.probeBin);
      const detectedConfigs = absRepo
        ? c.configDirs.filter((rel) => fs.existsSync(path.join(absRepo, rel)))
        : [];
      return {
        ...c,
        installed: binState.installed,
        version: binState.version,
        detectedConfigs,
        ready: binState.installed || detectedConfigs.length > 0 || c.category === 'protocol'
      };
    });

    this._probeCache = { repoPath: absRepo, items };
    this._probeAt = now;
    return items;
  }

  async probeConnectorsAsync({ repoPath = null, force = false } = {}) {
    const now = Date.now();
    const absRepo = repoPath ? path.resolve(repoPath) : null;
    if (!force && this._probeCache && now - this._probeAt < 30_000 && this._probeCache.repoPath === absRepo) {
      return this._probeCache.items;
    }

    const items = await Promise.all(
      HARNESS_CATALOG.map(async (c) => {
        const binState = await probeBinaryAsync(c.probeBin);
        const detectedConfigs = absRepo
          ? c.configDirs.filter((rel) => fs.existsSync(path.join(absRepo, rel)))
          : [];
        return {
          ...c,
          installed: binState.installed,
          version: binState.version,
          detectedConfigs,
          ready: binState.installed || detectedConfigs.length > 0 || c.category === 'protocol'
        };
      })
    );

    this._probeCache = { repoPath: absRepo, items };
    this._probeAt = now;
    return items;
  }

  /**
   * Compile active Skills, Rules, Commands, Hooks & MCP servers into the target harness format.
   * Preserves existing user config keys (non-destructive merge), excludes untrusted stdio/command
   * executions, and redacts hook/MCP secrets before writing to disk.
   */
  syncToHarness(targetDir, harnessId, assets = {}, { dryRun = false } = {}) {
    const absRoot = path.resolve(targetDir);
    const harness = HARNESS_CATALOG.find((h) => h.id === harnessId);
    if (!harness) {
      throw new Error(`未知连接器 Harness "${harnessId}"，可选：${HARNESS_CATALOG.map((h) => h.id).join(', ')}`);
    }

    const skills = assets.skills || [];
    const rules = assets.rules || [];
    const commands = assets.commands || [];
    const rawHooks = assets.hooks || [];
    const rawMcpServers = assets.mcpServers || [];

    // Security invariant: never export untrusted command hooks or raw env secrets to repo files
    const safeExportHooks = rawHooks
      .filter((h) => h.enabled !== false && (h.type !== 'command' || h.trusted === true))
      .map((h) => ({
        id: h.id,
        pluginId: h.pluginId,
        event: h.event,
        matcher: h.matcher,
        type: h.type,
        action: h.action,
        pattern: h.pattern || undefined,
        reason: h.reason || undefined,
        additionalContext: h.additionalContext || undefined,
        description: h.description || undefined
      }));

    // Security invariant: only export enabled MCP servers, and only trusted stdio commands
    const buildMcpEntries = () => {
      const mcpMap = Object.create(null);
      for (const s of rawMcpServers) {
        if (s.enabled === false) continue;
        if (!s.id || FORBIDDEN_MAP_KEYS.has(String(s.id))) continue;
        if (s.transport === 'http' && s.url) {
          mcpMap[s.id] = { type: 'http', url: s.url };
        } else if (s.command && s.trusted === true) {
          mcpMap[s.id] = { command: s.command, args: Array.isArray(s.args) ? [...s.args] : [] };
        }
      }
      return { ...mcpMap };
    };

    const mergeJsonConfig = (relPath, key, newEntries, defaults = {}) => {
      const existing = readExistingJsonSafe(absRoot, relPath) || { ...defaults };
      const existingSection =
        existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key]) ? existing[key] : {};
      return {
        ...existing,
        [key]: {
          ...existingSection,
          ...newEntries
        }
      };
    };

    const planned = []; // Array<{ relPath, content }>

    const renderSkillMd = (sk) =>
      [
        '---',
        `name: ${yamlScalar(sk.name)}`,
        `description: ${yamlScalar(sk.description || sk.name)}`,
        sk.tags?.length ? `tags: ${yamlArray(sk.tags)}` : null,
        '---',
        '',
        sk.content || ''
      ]
        .filter((x) => x !== null)
        .join('\n');

    const renderRulesDigest = (title) =>
      [
        `# ${title}（由云驭协同 Yunyu Teamwork 自动同步）`,
        '',
        ...rules.map((r) => `## ${r.name}\n${r.description ? `> ${r.description}\n\n` : ''}${r.content}\n`)
      ].join('\n');

    const mcpEntries = buildMcpEntries();

    if (harnessId === 'claude-code') {
      for (const sk of skills) {
        planned.push({ relPath: `.claude/skills/${safeSlug(sk.name)}/SKILL.md`, content: renderSkillMd(sk) });
      }
      for (const cmd of commands) {
        planned.push({ relPath: `.claude/commands/${safeSlug(cmd.name)}.md`, content: cmd.content || '' });
      }
      if (rules.length > 0) {
        planned.push({ relPath: '.claude/rules/yunyu-team-rules.md', content: renderRulesDigest('团队工程规则') });
      }
      planned.push({
        relPath: '.mcp.json',
        content: `${JSON.stringify(mergeJsonConfig('.mcp.json', 'mcpServers', mcpEntries), null, 2)}\n`
      });
      planned.push({
        relPath: '.claude/yunyu-hooks.json',
        content: `${JSON.stringify({ hooks: safeExportHooks }, null, 2)}\n`
      });
    } else if (harnessId === 'codex-cli') {
      for (const sk of skills) {
        planned.push({ relPath: `.codex/skills/${safeSlug(sk.name)}/SKILL.md`, content: renderSkillMd(sk) });
      }
      if (rules.length > 0) {
        planned.push({ relPath: '.codex/rules/yunyu-team-rules.md', content: renderRulesDigest('Codex 团队规则') });
      }
      planned.push({
        relPath: '.codex/mcp.json',
        content: `${JSON.stringify(mergeJsonConfig('.codex/mcp.json', 'mcpServers', mcpEntries), null, 2)}\n`
      });
    } else if (harnessId === 'cursor') {
      for (const r of rules) {
        const mdc = [
          '---',
          `description: ${yamlScalar(r.description || r.name)}`,
          r.globs?.length ? `globs: ${yamlScalar(r.globs.join(', '))}` : null,
          `alwaysApply: ${Boolean(r.alwaysApply)}`,
          '---',
          '',
          r.content || ''
        ]
          .filter((x) => x !== null)
          .join('\n');
        planned.push({ relPath: `.cursor/rules/${safeSlug(r.name)}.mdc`, content: mdc });
      }
      for (const sk of skills) {
        planned.push({ relPath: `.cursor/skills/${safeSlug(sk.name)}/SKILL.md`, content: renderSkillMd(sk) });
      }
      planned.push({
        relPath: '.cursor/mcp.json',
        content: `${JSON.stringify(mergeJsonConfig('.cursor/mcp.json', 'mcpServers', mcpEntries), null, 2)}\n`
      });
    } else if (harnessId === 'gemini-cli') {
      for (const sk of skills) {
        planned.push({ relPath: `.gemini/skills/${safeSlug(sk.name)}/SKILL.md`, content: renderSkillMd(sk) });
      }
      if (rules.length > 0) {
        planned.push({ relPath: '.gemini/GEMINI.team.md', content: renderRulesDigest('Gemini 团队规则') });
      }
      planned.push({
        relPath: '.gemini/settings.json',
        content: `${JSON.stringify(mergeJsonConfig('.gemini/settings.json', 'mcpServers', mcpEntries), null, 2)}\n`
      });
    } else if (harnessId === 'opencode') {
      for (const sk of skills) {
        planned.push({ relPath: `.opencode/skills/${safeSlug(sk.name)}/SKILL.md`, content: renderSkillMd(sk) });
      }
      planned.push({
        relPath: 'opencode.json',
        content: `${JSON.stringify(
          mergeJsonConfig('opencode.json', 'mcp', mcpEntries, { $schema: 'https://opencode.ai/config.json' }),
          null,
          2
        )}\n`
      });
    } else {
      // antigravity / codebuddy / mcp-gateway -> standardized TeamAI / Agent Plugin export
      const baseDir = harnessId === 'antigravity' ? '.agent' : harnessId === 'codebuddy' ? '.codebuddy' : '.teamai';
      for (const sk of skills) {
        planned.push({ relPath: `${baseDir}/skills/${safeSlug(sk.name)}/SKILL.md`, content: renderSkillMd(sk) });
      }
      for (const r of rules) {
        planned.push({ relPath: `${baseDir}/rules/${safeSlug(r.name)}.md`, content: r.content || '' });
      }
      for (const cmd of commands) {
        planned.push({ relPath: `${baseDir}/commands/${safeSlug(cmd.name)}.md`, content: cmd.content || '' });
      }
      planned.push({
        relPath: `${baseDir}/mcp.json`,
        content: `${JSON.stringify(mergeJsonConfig(`${baseDir}/mcp.json`, 'mcpServers', mcpEntries), null, 2)}\n`
      });
      planned.push({
        relPath: `${baseDir}/hooks.json`,
        content: `${JSON.stringify({ hooks: safeExportHooks }, null, 2)}\n`
      });
    }

    const writtenFiles = [];
    if (!dryRun) {
      for (const item of planned) {
        const absFile = assertInsideRoot(absRoot, path.join(absRoot, item.relPath));
        fs.mkdirSync(path.dirname(absFile), { recursive: true });
        fs.writeFileSync(absFile, item.content, 'utf8');
        writtenFiles.push(item.relPath);
      }
    }

    return {
      harnessId,
      harnessName: harness.name,
      targetDir: absRoot,
      dryRun: Boolean(dryRun),
      plannedFiles: planned.map((p) => p.relPath),
      writtenFiles,
      counts: {
        skills: skills.length,
        rules: rules.length,
        commands: commands.length,
        hooks: safeExportHooks.length,
        mcpServers: Object.keys(mcpEntries).length
      }
    };
  }
}
