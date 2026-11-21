import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMBER_ROLES } from '../core/constants.mjs';
import { sanitizeId } from '../core/storage.mjs';
import { parseConfigFile, parseMarkdownAsset } from './parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_PLUGINS_DIR = path.resolve(__dirname, '..', '..', 'plugins');
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype', 'tostring', 'valueof', 'hasownproperty']);
const VALID_ROLES = new Set(Object.values(MEMBER_ROLES));
const SENSITIVE_KEY_RE = /(key|token|secret|password|passwd|authorization|cookie|private|credential|bearer)/i;
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]{1,128}$/;

function yamlScalar(val) {
  return JSON.stringify(String(val ?? '').replace(/[\r\n]+/g, ' ').trim());
}

function yamlArray(arr) {
  return `[${(Array.isArray(arr) ? arr : []).map((x) => yamlScalar(x)).join(', ')}]`;
}

function normalizeAgentRole(rawRole, fallback = 'reviewer') {
  const clean = String(rawRole || '').trim().toLowerCase();
  return VALID_ROLES.has(clean) ? clean : fallback;
}

function redactObjSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactObjSecrets);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'env' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.keys(v).map((ek) => [ek, '***']));
    } else if (k === 'headers' && v && typeof v === 'object') {
      const h = {};
      for (const [hk, hv] of Object.entries(v)) h[hk] = SENSITIVE_KEY_RE.test(hk) ? '***' : hv;
      out[k] = h;
    } else if (SENSITIVE_KEY_RE.test(k) && typeof v === 'string' && v.length > 0) {
      out[k] = '***';
    } else if (v && typeof v === 'object') {
      out[k] = redactObjSecrets(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function redactPluginForPublic(plugin) {
  if (!plugin || typeof plugin !== 'object') return plugin;
  const copy = structuredClone(plugin);
  if (Array.isArray(copy.mcpServers)) {
    copy.mcpServers = copy.mcpServers.map((s) => redactObjSecrets(s));
  }
  if (Array.isArray(copy.hooks)) {
    copy.hooks = copy.hooks.map((h) => redactObjSecrets(h));
  }
  if (Array.isArray(copy.agents)) {
    copy.agents = copy.agents.map((a) => ({ ...a, driverConfig: redactObjSecrets(a.driverConfig || {}) }));
  }
  return copy;
}

function safePluginId(raw) {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!cleaned || FORBIDDEN_IDS.has(cleaned)) throw new Error(`非法插件 ID "${raw}"`);
  return cleaned;
}

function isDir(p) {
  try {
    return fs.existsSync(p) && fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

function assertSafePluginPath(realRoot, targetPath) {
  const absTarget = path.resolve(targetPath);
  const relLex = path.relative(realRoot, absTarget);
  if (relLex.startsWith('..') || path.isAbsolute(relLex)) {
    throw new Error(`安全拦截：插件路径越界 "${targetPath}"`);
  }
  // Reject symlinks on target or any intermediate component inside realRoot
  const parts = relLex ? relLex.split(path.sep).filter(Boolean) : [];
  let probe = realRoot;
  for (const part of parts) {
    probe = path.join(probe, part);
    if (!fs.existsSync(probe)) break;
    if (fs.lstatSync(probe).isSymbolicLink()) {
      throw new Error(`安全拦截：禁止加载插件目录中的符号链接 "${part}"`);
    }
  }
  if (fs.existsSync(absTarget)) {
    const realTarget = fs.realpathSync(absTarget);
    const relReal = path.relative(realRoot, realTarget);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
      throw new Error(`安全拦截：插件真实路径越出根目录 "${targetPath}"`);
    }
  }
  return absTarget;
}

function readSubFiles(realRoot, dirPath, exts) {
  if (!isDir(dirPath)) return [];
  assertSafePluginPath(realRoot, dirPath);
  const out = [];
  for (const e of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (e.isSymbolicLink() || !e.isFile()) continue;
    if (!exts.includes(path.extname(e.name).toLowerCase())) continue;
    const full = path.join(dirPath, e.name);
    try {
      assertSafePluginPath(realRoot, full);
      out.push(full);
    } catch {}
  }
  return out.sort();
}

function normalizeMcpDeclaration(rawDoc, pluginId, trusted) {
  if (!rawDoc || typeof rawDoc !== 'object') return [];
  const list = [];
  const map = rawDoc.mcpServers || rawDoc.servers || (Array.isArray(rawDoc) ? null : null);
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [id, spec] of Object.entries(map)) {
      if (!spec || typeof spec !== 'object') continue;
      list.push({
        id: safePluginId(id),
        pluginId,
        transport: spec.transport || spec.type || (spec.url ? 'http' : 'stdio'),
        description: spec.description || '',
        command: spec.command || null,
        args: Array.isArray(spec.args) ? spec.args.map(String) : [],
        url: spec.url || null,
        headers: spec.headers && typeof spec.headers === 'object' ? { ...spec.headers } : {},
        env: spec.env && typeof spec.env === 'object' ? { ...spec.env } : {},
        trusted,
        enabled: spec.enabled !== false
      });
    }
  } else if (Array.isArray(rawDoc.mcpServers || rawDoc.servers || rawDoc)) {
    const arr = Array.isArray(rawDoc) ? rawDoc : rawDoc.mcpServers || rawDoc.servers;
    for (const spec of arr) {
      if (!spec || !spec.id) continue;
      list.push({
        id: safePluginId(spec.id),
        pluginId,
        transport: spec.transport || spec.type || (spec.url ? 'http' : 'stdio'),
        description: spec.description || '',
        command: spec.command || null,
        args: Array.isArray(spec.args) ? spec.args.map(String) : [],
        url: spec.url || null,
        headers: spec.headers && typeof spec.headers === 'object' ? { ...spec.headers } : {},
        env: spec.env && typeof spec.env === 'object' ? { ...spec.env } : {},
        trusted,
        enabled: spec.enabled !== false
      });
    }
  }
  return list;
}

function normalizeHooksDeclaration(rawDoc, pluginId, trusted) {
  if (!rawDoc || typeof rawDoc !== 'object') return [];
  const out = [];
  if (Array.isArray(rawDoc.hooks)) {
    for (let i = 0; i < rawDoc.hooks.length; i++) {
      const h = rawDoc.hooks[i];
      if (!h || !h.event) continue;
      out.push({
        ...h,
        id: h.id || `${pluginId}-hook-${i + 1}`,
        pluginId,
        trusted
      });
    }
  } else if (rawDoc.hooks && typeof rawDoc.hooks === 'object') {
    // Claude Code / TeamAI object-by-event format: { hooks: { SessionStart: [...], PreToolUse: [...] } }
    for (const [event, items] of Object.entries(rawDoc.hooks)) {
      if (!Array.isArray(items)) continue;
      items.forEach((h, idx) => {
        if (!h || typeof h !== 'object') return;
        out.push({
          ...h,
          event: h.event || event,
          id: h.id || `${pluginId}-${event.toLowerCase()}-${idx + 1}`,
          pluginId,
          trusted
        });
      });
    }
  }
  return out;
}

function loadPluginDirectory(pluginDir, { sourceType = 'local', sourceUri = null, overrideId = null, stateOverride = {} } = {}) {
  const absDir = path.resolve(pluginDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) throw new Error(`插件目录不存在: ${absDir}`);
  const realRoot = fs.realpathSync(absDir);

  // Manifest discovery: plugin.json | teamai.yaml | teamai.json | fallback folder name
  let manifest = {};
  for (const name of ['plugin.json', 'teamai.json', 'teamai.yaml', 'teamai.yml']) {
    const p = path.join(realRoot, name);
    if (fs.existsSync(p)) {
      assertSafePluginPath(realRoot, p);
      manifest = parseConfigFile(p) || {};
      break;
    }
  }

  const id = safePluginId(overrideId || manifest.id || manifest.name || path.basename(absDir));
  const enabled = stateOverride.enabled !== undefined ? Boolean(stateOverride.enabled) : manifest.enabled !== false;
  // Security invariant: ONLY official built-in packs default to trusted=true.
  // Workspace / local / git / inline plugins NEVER self-declare trust via manifest.trusted!
  const trusted =
    stateOverride.trusted !== undefined
      ? Boolean(stateOverride.trusted)
      : sourceType === 'builtin';

  // 1. Skills: skills/<name>/SKILL.md or skills/*.md
  const skills = [];
  const skillsDir = path.join(realRoot, 'skills');
  if (isDir(skillsDir)) {
    assertSafePluginPath(realRoot, skillsDir);
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      let mdPath = null;
      let fallbackName = entry.name;
      if (entry.isDirectory()) {
        const cand = path.join(skillsDir, entry.name, 'SKILL.md');
        if (fs.existsSync(cand)) mdPath = cand;
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        mdPath = path.join(skillsDir, entry.name);
        fallbackName = path.basename(entry.name, '.md');
      }
      if (!mdPath) continue;
      assertSafePluginPath(realRoot, mdPath);
      const parsed = parseMarkdownAsset(fs.readFileSync(mdPath, 'utf8'));
      const fm = parsed.frontmatter;
      const name = String(fm.name || fallbackName).trim();
      skills.push({
        id: `${id}:${safePluginId(name)}`,
        pluginId: id,
        name,
        description: String(fm.description || '').trim(),
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        triggers: Array.isArray(fm.triggers) ? fm.triggers.map(String) : [],
        globs: Array.isArray(fm.globs) ? fm.globs.map(String) : [],
        roles: Array.isArray(fm.roles) ? fm.roles.map(String) : [],
        content: parsed.body,
        filePath: path.relative(realRoot, mdPath).replace(/\\/g, '/')
      });
    }
  }

  // 2. Rules: rules/*.md
  const rules = [];
  for (const rulePath of readSubFiles(realRoot, path.join(realRoot, 'rules'), ['.md'])) {
    const parsed = parseMarkdownAsset(fs.readFileSync(rulePath, 'utf8'));
    const fm = parsed.frontmatter;
    const name = String(fm.name || path.basename(rulePath, '.md')).trim();
    const globs = Array.isArray(fm.globs) ? fm.globs.map(String) : [];
    const alwaysApply = fm.alwaysApply === true ? true : fm.alwaysApply === false ? false : globs.length === 0;
    rules.push({
      id: `${id}:${safePluginId(name)}`,
      pluginId: id,
      name,
      description: String(fm.description || '').trim(),
      alwaysApply,
      globs,
      roles: Array.isArray(fm.roles) ? fm.roles.map(String) : [],
      content: parsed.body,
      filePath: path.relative(realRoot, rulePath).replace(/\\/g, '/')
    });
  }

  // 3. Commands: commands/*.md
  const commands = [];
  for (const cmdPath of readSubFiles(realRoot, path.join(realRoot, 'commands'), ['.md'])) {
    const parsed = parseMarkdownAsset(fs.readFileSync(cmdPath, 'utf8'));
    const fm = parsed.frontmatter;
    const name = String(fm.name || path.basename(cmdPath, '.md')).trim();
    commands.push({
      id: `${id}:${safePluginId(name)}`,
      pluginId: id,
      name,
      description: String(fm.description || '').trim(),
      content: parsed.body,
      filePath: path.relative(realRoot, cmdPath).replace(/\\/g, '/')
    });
  }

  // 4. Agents: agents/*.{yaml,yml,json,md}
  const agents = [];
  for (const agPath of readSubFiles(realRoot, path.join(realRoot, 'agents'), ['.yaml', '.yml', '.json', '.md'])) {
    const parsed = parseConfigFile(agPath);
    if (!parsed) continue;
    const isMd = agPath.toLowerCase().endsWith('.md');
    const cfg = isMd ? { ...(parsed.frontmatter || {}), brief: parsed.frontmatter?.brief || parsed.body } : parsed;
    const name = String(cfg.name || path.basename(agPath, path.extname(agPath))).trim().toLowerCase();
    // Default omitted plugin agent role to read-only 'reviewer' to uphold Hard Invariant #3
    const role = normalizeAgentRole(cfg.role, 'reviewer');
    agents.push({
      id: `${id}:${safePluginId(name)}`,
      pluginId: id,
      name,
      role,
      driver: cfg.driver || 'simulated',
      model: cfg.model || 'default',
      workspace: cfg.workspace || (role === 'author' ? 'share' : 'inherit'),
      owns: Array.isArray(cfg.owns) ? cfg.owns.map(String) : [],
      mustNotTouch: Array.isArray(cfg.mustNotTouch) ? cfg.mustNotTouch.map(String) : [],
      channels: Array.isArray(cfg.channels) ? cfg.channels.map(String) : ['main'],
      brief: String(cfg.brief || cfg.description || '').trim(),
      driverConfig: cfg.driverConfig && typeof cfg.driverConfig === 'object' ? { ...cfg.driverConfig } : {}
    });
  }

  // 5. MCP Servers: mcp.json | mcp/mcp.yaml | mcp/mcp.json
  const mcpServers = [];
  for (const rel of ['mcp.json', 'mcp.yaml', 'mcp.yml', 'mcp/mcp.json', 'mcp/mcp.yaml', 'mcp/mcp.yml']) {
    const p = path.join(realRoot, rel);
    if (fs.existsSync(p)) {
      assertSafePluginPath(realRoot, p);
      const doc = parseConfigFile(p);
      mcpServers.push(...normalizeMcpDeclaration(doc, id, trusted));
    }
  }

  // 6. Lifecycle Hooks: hooks.json | hooks/hooks.json | hooks/hooks.yaml
  const hooks = [];
  for (const rel of ['hooks.json', 'hooks.yaml', 'hooks.yml', 'hooks/hooks.json', 'hooks/hooks.yaml', 'hooks/hooks.yml']) {
    const p = path.join(realRoot, rel);
    if (fs.existsSync(p)) {
      assertSafePluginPath(realRoot, p);
      const doc = parseConfigFile(p);
      hooks.push(...normalizeHooksDeclaration(doc, id, trusted));
    }
  }

  // 7. Connectors: connectors/*.{json,yaml,yml}
  const connectors = [];
  for (const connPath of readSubFiles(realRoot, path.join(realRoot, 'connectors'), ['.json', '.yaml', '.yml'])) {
    const doc = parseConfigFile(connPath);
    if (doc && typeof doc === 'object') {
      connectors.push({
        ...doc,
        id: safePluginId(doc.id || path.basename(connPath, path.extname(connPath))),
        pluginId: id
      });
    }
  }

  let gitSha = null;
  if (fs.existsSync(path.join(absDir, '.git'))) {
    try {
      gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: absDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim();
    } catch {}
  }

  return {
    id,
    name: String(manifest.displayName || manifest.name || id),
    version: String(manifest.version || '1.0.0'),
    description: String(manifest.description || `${id} 插件包`).trim(),
    author: String(manifest.author || (sourceType === 'builtin' ? 'Yunyu Teamwork' : 'community')),
    tags: Array.isArray(manifest.tags) ? manifest.tags.map(String) : [],
    format: fs.existsSync(path.join(absDir, 'plugin.json')) ? 'agent-plugin' : 'teamai-repo',
    sourceType,
    sourceUri: sourceUri || null,
    dir: absDir,
    gitSha,
    enabled,
    trusted,
    skills,
    rules,
    commands,
    agents,
    mcpServers,
    hooks,
    connectors
  };
}

/**
 * Multi-Root Agent Plugin & TeamAI Asset Registry:
 * Discovers built-in, project-local, and installed plugins (supporting both Agent Plugin
 * Standard `plugin.json` and Tencent `teamai-cli` Git repository layouts).
 */
export class PluginRegistry {
  constructor({ dataDir = null, inMemory = false, repoPath = null, pluginRoots = null } = {}) {
    this.inMemory = Boolean(inMemory || !dataDir);
    this.dataDir = dataDir ? path.resolve(dataDir) : null;
    this.repoPath = repoPath ? path.resolve(repoPath) : null;
    this.pluginRoots = pluginRoots;
    this.plugins = new Map();
    this._builtinIds = new Set();
    this._memoryInline = new Map();
    this._tempCloneRoot = null;
    this._state = { overrides: Object.create(null), installed: Object.create(null) };

    this._loadState();
    this.reload();
  }

  _statePath() {
    return this.dataDir ? path.join(this.dataDir, 'plugins-state.json') : null;
  }

  _installedDir() {
    if (this.dataDir && !this.inMemory) return path.join(this.dataDir, 'plugins');
    if (!this._tempCloneRoot) {
      this._tempCloneRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yunyu-mem-plugins-'));
    }
    return this._tempCloneRoot;
  }

  _loadState() {
    const p = this._statePath();
    if (!p || !fs.existsSync(p)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        const overrides = Object.create(null);
        for (const [k, v] of Object.entries(parsed.overrides || {})) {
          if (!FORBIDDEN_IDS.has(k.toLowerCase())) overrides[k] = v;
        }
        const installed = Object.create(null);
        for (const [k, v] of Object.entries(parsed.installed || {})) {
          if (!FORBIDDEN_IDS.has(k.toLowerCase())) installed[k] = v;
        }
        this._state = { overrides, installed };
      }
    } catch {}
  }

  _saveState() {
    if (this.inMemory || !this.dataDir) return;
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const p = this._statePath();
    const tmp = `${p}.tmp`;
    const serializable = {
      overrides: { ...this._state.overrides },
      installed: { ...this._state.installed }
    };
    fs.writeFileSync(tmp, `${JSON.stringify(serializable, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, p);
  }

  _assertNotBuiltinShadow(pluginId) {
    if (this._builtinIds.has(pluginId)) {
      throw new Error(`安全拦截：禁止覆盖或冒充官方内置插件 "${pluginId}"`);
    }
  }

  _applyTrustToAssets(plugin) {
    for (const h of plugin.hooks || []) h.trusted = plugin.trusted;
    for (const m of plugin.mcpServers || []) m.trusted = plugin.trusted;
  }

  _discoverRoots() {
    if (Array.isArray(this.pluginRoots)) {
      return this.pluginRoots.map((r) => ({ dir: path.resolve(r), sourceType: 'local' }));
    }
    const roots = [];
    if (isDir(BUILTIN_PLUGINS_DIR)) {
      roots.push({ dir: BUILTIN_PLUGINS_DIR, sourceType: 'builtin' });
    }
    if (this.repoPath) {
      const repoYunyuPlugins = path.join(this.repoPath, '.yunyu', 'plugins');
      const repoPlugins = path.join(this.repoPath, 'plugins');
      if (isDir(repoYunyuPlugins)) roots.push({ dir: repoYunyuPlugins, sourceType: 'workspace' });
      if (isDir(repoPlugins) && path.resolve(repoPlugins) !== BUILTIN_PLUGINS_DIR) {
        roots.push({ dir: repoPlugins, sourceType: 'workspace' });
      }
    }
    return roots;
  }

  reload() {
    this.plugins.clear();
    this._builtinIds.clear();

    // 1. Scan built-in and workspace plugin roots
    for (const root of this._discoverRoots()) {
      for (const entry of fs.readdirSync(root.dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
        const pDir = path.join(root.dir, entry.name);
        try {
          const previewId = safePluginId(entry.name);
          const ovPreview = Object.hasOwn(this._state.overrides, previewId) ? this._state.overrides[previewId] : {};
          const plugin = loadPluginDirectory(pDir, {
            sourceType: root.sourceType,
            stateOverride: ovPreview
          });
          if (root.sourceType !== 'builtin' && this._builtinIds.has(plugin.id)) {
            continue; // Prevent workspace plugins from shadowing official built-in security packs
          }
          if (Object.hasOwn(this._state.overrides, plugin.id)) {
            const ov = this._state.overrides[plugin.id];
            if (ov.enabled !== undefined) plugin.enabled = Boolean(ov.enabled);
            if (ov.trusted !== undefined) plugin.trusted = Boolean(ov.trusted);
            this._applyTrustToAssets(plugin);
          }
          if (root.sourceType === 'builtin') this._builtinIds.add(plugin.id);
          this.plugins.set(plugin.id, plugin);
        } catch {}
      }
    }

    // 2. Load persisted installed plugins (local paths, Git TeamAI clones, or inline bundles)
    for (const [id, rec] of Object.entries(this._state.installed || {})) {
      if (this._builtinIds.has(id)) continue;
      if (!rec?.dir || !isDir(rec.dir)) continue;
      try {
        const ov = Object.hasOwn(this._state.overrides, id) ? this._state.overrides[id] : {};
        const plugin = loadPluginDirectory(rec.dir, {
          sourceType: rec.sourceType || 'installed',
          sourceUri: rec.sourceUri || null,
          overrideId: id,
          stateOverride: ov
        });
        this._applyTrustToAssets(plugin);
        this.plugins.set(plugin.id, plugin);
      } catch {}
    }

    // 3. Preserve in-memory inline plugins across reload()
    for (const [id, memPlugin] of this._memoryInline.entries()) {
      if (this._builtinIds.has(id)) continue;
      const copy = structuredClone(memPlugin);
      if (Object.hasOwn(this._state.overrides, id)) {
        const ov = this._state.overrides[id];
        if (ov.enabled !== undefined) copy.enabled = Boolean(ov.enabled);
        if (ov.trusted !== undefined) copy.trusted = Boolean(ov.trusted);
        this._applyTrustToAssets(copy);
      }
      this.plugins.set(id, copy);
    }

    return this.listPlugins();
  }

  installFromLocal(localDir, { id = null, trusted = false } = {}) {
    const absDir = path.resolve(localDir);
    const plugin = loadPluginDirectory(absDir, {
      sourceType: 'local',
      sourceUri: absDir,
      overrideId: id,
      stateOverride: { enabled: true, trusted: Boolean(trusted) }
    });
    this._assertNotBuiltinShadow(plugin.id);
    this._state.installed[plugin.id] = {
      sourceType: 'local',
      sourceUri: absDir,
      dir: absDir,
      installedAt: new Date().toISOString()
    };
    this._state.overrides[plugin.id] = { enabled: true, trusted: Boolean(trusted) };
    this.plugins.set(plugin.id, plugin);
    this._saveState();
    return structuredClone(plugin);
  }

  /**
   * Clone or update a Git-backed Agent Plugin or TeamAI repository (single source of truth).
   */
  installFromGit(gitUrl, { id = null, branch = null, trusted = false } = {}) {
    const cleanUrl = String(gitUrl || '').trim();
    if (!cleanUrl || cleanUrl.startsWith('-') || /[\r\n\0]/.test(cleanUrl)) {
      throw new Error(`非法 Git 仓库地址 "${gitUrl}"`);
    }
    const cleanBranch = branch ? String(branch).trim() : null;
    if (cleanBranch && (!SAFE_BRANCH_RE.test(cleanBranch) || cleanBranch.startsWith('-') || cleanBranch.includes('..'))) {
      throw new Error(`非法 Git 分支名 "${branch}"`);
    }
    const baseName = path.basename(cleanUrl.replace(/\.git$/i, '')) || 'teamai-plugin';
    const pluginId = safePluginId(id || baseName);
    this._assertNotBuiltinShadow(pluginId);

    const installRoot = this._installedDir();
    fs.mkdirSync(installRoot, { recursive: true, mode: 0o700 });
    const targetDir = path.resolve(installRoot, sanitizeId(pluginId));
    const relCheck = path.relative(path.resolve(installRoot), targetDir);
    if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      throw new Error('安全拦截：目标插件目录越界');
    }

    const isRemote = /^(?:https?:\/\/|ssh:\/\/|git@)/i.test(cleanUrl);
    const gitBaseCfg = [
      '-c', 'protocol.ext.allow=never',
      '-c', 'core.symlinks=false',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false'
    ];
    if (isRemote) gitBaseCfg.unshift('-c', 'protocol.file.allow=never');
    const gitExecOpts = {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    };

    const existingRec = Object.hasOwn(this._state.installed, pluginId) ? this._state.installed[pluginId] : null;
    if (isDir(path.join(targetDir, '.git')) && (!existingRec || existingRec.sourceUri === cleanUrl)) {
      execFileSync('git', [...gitBaseCfg, 'pull', '--ff-only'], { ...gitExecOpts, cwd: targetDir });
    } else {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      const args = [...gitBaseCfg, 'clone', '--depth', '1', '--no-recurse-submodules'];
      if (cleanBranch) args.push('--branch', cleanBranch);
      args.push('--', cleanUrl, targetDir);
      execFileSync('git', args, gitExecOpts);
    }

    const plugin = loadPluginDirectory(targetDir, {
      sourceType: 'git',
      sourceUri: cleanUrl,
      overrideId: pluginId,
      stateOverride: { enabled: true, trusted: Boolean(trusted) }
    });
    this._state.installed[plugin.id] = {
      sourceType: 'git',
      sourceUri: cleanUrl,
      dir: targetDir,
      installedAt: new Date().toISOString()
    };
    this._state.overrides[plugin.id] = { enabled: true, trusted: Boolean(trusted) };
    this.plugins.set(plugin.id, plugin);
    this._saveState();
    return structuredClone(plugin);
  }

  syncGitPlugin(pluginId) {
    const existing = this.plugins.get(pluginId);
    if (!existing || existing.sourceType !== 'git') {
      const err = new Error(`插件 "${pluginId}" 不是 Git 同步仓库`);
      err.statusCode = existing ? 400 : 404;
      throw err;
    }
    const isRemote = /^(?:https?:\/\/|ssh:\/\/|git@)/i.test(String(existing.sourceUri || ''));
    const gitBaseCfg = [
      '-c', 'protocol.ext.allow=never',
      '-c', 'core.symlinks=false',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'core.fsmonitor=false'
    ];
    if (isRemote) gitBaseCfg.unshift('-c', 'protocol.file.allow=never');
    execFileSync('git', [...gitBaseCfg, 'pull', '--ff-only'], {
      cwd: existing.dir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const ov = Object.hasOwn(this._state.overrides, existing.id) ? this._state.overrides[existing.id] : {};
    const refreshed = loadPluginDirectory(existing.dir, {
      sourceType: 'git',
      sourceUri: existing.sourceUri,
      overrideId: existing.id,
      stateOverride: ov
    });
    this._applyTrustToAssets(refreshed);
    this.plugins.set(refreshed.id, refreshed);
    return structuredClone(refreshed);
  }

  /**
   * Create a lightweight inline custom plugin (Skill / Rule / Hook / MCP / Agent) right from UI/API.
   */
  createInlinePlugin({
    id,
    name,
    description = '',
    skill = null,
    skills = [],
    rule = null,
    rules = [],
    commands = [],
    hook = null,
    hooks = [],
    mcpServer = null,
    mcpServers = [],
    agent = null,
    agents = [],
    trusted = false
  }) {
    const pluginId = safePluginId(id || name || `custom-${Date.now()}`);
    this._assertNotBuiltinShadow(pluginId);
    const plugin = {
      id: pluginId,
      name: String(name || pluginId).trim(),
      version: '1.0.0',
      description: String(description || '用户自定义协同插件包').trim(),
      author: 'local-user',
      tags: ['custom'],
      format: 'inline-plugin',
      sourceType: 'inline',
      sourceUri: null,
      dir: null,
      gitSha: null,
      enabled: true,
      trusted: Boolean(trusted),
      skills: [],
      rules: [],
      commands: [],
      agents: [],
      mcpServers: [],
      hooks: [],
      connectors: []
    };

    const allSkills = [...(Array.isArray(skills) ? skills : []), ...(skill ? [skill] : [])];
    for (const sk of allSkills) {
      if (!sk?.name) continue;
      plugin.skills.push({
        id: `${pluginId}:${safePluginId(sk.name)}`,
        pluginId,
        name: String(sk.name).trim(),
        description: String(sk.description || '').trim(),
        tags: Array.isArray(sk.tags) ? sk.tags.map(String) : [],
        triggers: Array.isArray(sk.triggers) ? sk.triggers.map(String) : [],
        globs: Array.isArray(sk.globs) ? sk.globs.map(String) : [],
        roles: Array.isArray(sk.roles) ? sk.roles.map(String) : [],
        content: String(sk.content || '').trim(),
        filePath: `skills/${safePluginId(sk.name)}/SKILL.md`
      });
    }

    const allRules = [...(Array.isArray(rules) ? rules : []), ...(rule ? [rule] : [])];
    for (const r of allRules) {
      if (!r?.name) continue;
      const globs = Array.isArray(r.globs) ? r.globs.map(String) : [];
      const alwaysApply = r.alwaysApply === true ? true : r.alwaysApply === false ? false : globs.length === 0;
      plugin.rules.push({
        id: `${pluginId}:${safePluginId(r.name)}`,
        pluginId,
        name: String(r.name).trim(),
        description: String(r.description || '').trim(),
        alwaysApply,
        globs,
        roles: Array.isArray(r.roles) ? r.roles.map(String) : [],
        content: String(r.content || '').trim(),
        filePath: `rules/${safePluginId(r.name)}.md`
      });
    }

    for (const c of Array.isArray(commands) ? commands : []) {
      if (!c?.name) continue;
      const slug = safePluginId(c.name);
      plugin.commands.push({
        id: `${pluginId}:${slug}`,
        pluginId,
        name: slug,
        slash: `/${slug}`,
        description: String(c.description || '').trim(),
        content: String(c.content || '').trim(),
        filePath: `commands/${slug}.md`
      });
    }

    const allHooks = [...(Array.isArray(hooks) ? hooks : []), ...(hook ? [hook] : [])];
    for (let i = 0; i < allHooks.length; i++) {
      const h = allHooks[i];
      if (!h?.event) continue;
      plugin.hooks.push({
        id: h.id || `${pluginId}-hook-${i + 1}`,
        pluginId,
        event: h.event,
        matcher: h.matcher || '*',
        type: h.type || (h.command ? 'command' : 'policy'),
        action: h.action || 'deny',
        pattern: h.pattern || null,
        reason: h.reason || '自定义插件策略拦截',
        description: h.description || '',
        additionalContext: h.additionalContext || h.context || '',
        command: h.command || null,
        args: Array.isArray(h.args) ? h.args.map(String) : [],
        env: h.env && typeof h.env === 'object' ? { ...h.env } : {},
        timeoutMs: Number(h.timeoutMs) > 0 ? Number(h.timeoutMs) : 8000,
        trusted: Boolean(trusted)
      });
    }

    const allMcp = [...(Array.isArray(mcpServers) ? mcpServers : []), ...(mcpServer ? [mcpServer] : [])];
    for (const ms of allMcp) {
      if (!ms?.id) continue;
      plugin.mcpServers.push({
        id: safePluginId(ms.id),
        pluginId,
        transport: ms.transport || (ms.url ? 'http' : 'stdio'),
        description: ms.description || '',
        command: ms.command || null,
        args: Array.isArray(ms.args) ? ms.args.map(String) : [],
        url: ms.url || null,
        headers: ms.headers || {},
        env: ms.env || {},
        trusted: Boolean(trusted),
        enabled: true
      });
    }

    const allAgents = [...(Array.isArray(agents) ? agents : []), ...(agent ? [agent] : [])];
    for (const ag of allAgents) {
      if (!ag?.name) continue;
      const role = normalizeAgentRole(ag.role, 'reviewer');
      plugin.agents.push({
        id: `${pluginId}:${safePluginId(ag.name)}`,
        pluginId,
        name: String(ag.name).trim().toLowerCase(),
        role,
        driver: ag.driver || 'simulated',
        model: ag.model || 'default',
        workspace: ag.workspace || (role === 'author' ? 'share' : 'inherit'),
        owns: Array.isArray(ag.owns) ? ag.owns.map(String) : [],
        mustNotTouch: Array.isArray(ag.mustNotTouch) ? ag.mustNotTouch.map(String) : [],
        channels: Array.isArray(ag.channels) ? ag.channels.map(String) : ['main'],
        brief: String(ag.brief || '').trim(),
        driverConfig: ag.driverConfig && typeof ag.driverConfig === 'object' ? { ...ag.driverConfig } : {}
      });
    }

    // Persist inline plugin as real directory under dataDir/plugins/<id> when not inMemory
    if (!this.inMemory && this.dataDir) {
      const targetDir = path.resolve(this._installedDir(), sanitizeId(pluginId));
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        path.join(targetDir, 'plugin.json'),
        `${JSON.stringify({ id: pluginId, name: plugin.name, version: plugin.version, description: plugin.description, author: plugin.author, tags: plugin.tags }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
      for (const sk of plugin.skills) {
        const skDir = path.join(targetDir, 'skills', safePluginId(sk.name));
        fs.mkdirSync(skDir, { recursive: true });
        fs.writeFileSync(
          path.join(skDir, 'SKILL.md'),
          `---\nname: ${yamlScalar(sk.name)}\ndescription: ${yamlScalar(sk.description)}\ntags: ${yamlArray(sk.tags)}\ntriggers: ${yamlArray(sk.triggers)}\nglobs: ${yamlArray(sk.globs)}\nroles: ${yamlArray(sk.roles)}\n---\n${sk.content}\n`,
          'utf8'
        );
      }
      for (const r of plugin.rules) {
        fs.mkdirSync(path.join(targetDir, 'rules'), { recursive: true });
        fs.writeFileSync(
          path.join(targetDir, 'rules', `${safePluginId(r.name)}.md`),
          `---\nname: ${yamlScalar(r.name)}\ndescription: ${yamlScalar(r.description)}\nalwaysApply: ${r.alwaysApply}\nglobs: ${yamlArray(r.globs)}\nroles: ${yamlArray(r.roles)}\n---\n${r.content}\n`,
          'utf8'
        );
      }
      for (const c of plugin.commands) {
        fs.mkdirSync(path.join(targetDir, 'commands'), { recursive: true });
        fs.writeFileSync(
          path.join(targetDir, 'commands', `${safePluginId(c.name)}.md`),
          `---\nname: ${yamlScalar(c.name)}\ndescription: ${yamlScalar(c.description)}\n---\n${c.content}\n`,
          'utf8'
        );
      }
      for (const ag of plugin.agents) {
        fs.mkdirSync(path.join(targetDir, 'agents'), { recursive: true });
        fs.writeFileSync(
          path.join(targetDir, 'agents', `${safePluginId(ag.name)}.json`),
          `${JSON.stringify(ag, null, 2)}\n`,
          { encoding: 'utf8', mode: 0o600 }
        );
      }
      if (plugin.hooks.length) {
        fs.writeFileSync(path.join(targetDir, 'hooks.json'), `${JSON.stringify({ hooks: plugin.hooks }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      }
      if (plugin.mcpServers.length) {
        fs.writeFileSync(path.join(targetDir, 'mcp.json'), `${JSON.stringify({ mcpServers: plugin.mcpServers }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      }
      plugin.dir = targetDir;
      this._state.installed[pluginId] = { sourceType: 'inline', sourceUri: null, dir: targetDir, installedAt: new Date().toISOString() };
      this._state.overrides[pluginId] = { enabled: true, trusted: Boolean(trusted) };
      this._saveState();
    } else {
      this._memoryInline.set(plugin.id, structuredClone(plugin));
      this._state.overrides[pluginId] = { enabled: true, trusted: Boolean(trusted) };
    }

    this.plugins.set(plugin.id, plugin);
    return structuredClone(plugin);
  }

  setPluginState(id, { enabled = undefined, trusted = undefined } = {}) {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      const err = new Error(`未找到插件 "${id}"`);
      err.statusCode = 404;
      throw err;
    }
    const prev = Object.hasOwn(this._state.overrides, id) ? { ...this._state.overrides[id] } : {};
    if (enabled !== undefined) {
      plugin.enabled = Boolean(enabled);
      prev.enabled = plugin.enabled;
    }
    if (trusted !== undefined) {
      plugin.trusted = Boolean(trusted);
      prev.trusted = plugin.trusted;
      this._applyTrustToAssets(plugin);
    }
    this._state.overrides[id] = prev;
    if (this._memoryInline.has(id)) {
      this._memoryInline.set(id, structuredClone(plugin));
    }
    this._saveState();
    return structuredClone(plugin);
  }

  getPlugin(id) {
    const p = this.plugins.get(id);
    return p ? structuredClone(p) : null;
  }

  listPlugins() {
    return [...this.plugins.values()].map((p) => structuredClone(p));
  }

  _collect(field, { enabledOnly = true } = {}) {
    const out = [];
    for (const p of this.plugins.values()) {
      if (enabledOnly && !p.enabled) continue;
      for (const item of p[field] || []) out.push(structuredClone(item));
    }
    return out;
  }

  listSkills(opts) {
    return this._collect('skills', opts);
  }

  getSkill(nameOrId, { enabledOnly = true } = {}) {
    const clean = String(nameOrId || '').trim().toLowerCase();
    return this.listSkills({ enabledOnly }).find((s) => s.id.toLowerCase() === clean || s.name.toLowerCase() === clean) || null;
  }

  getCounts() {
    let enabledPlugins = 0;
    let enabledSkills = 0;
    for (const p of this.plugins.values()) {
      if (p.enabled) {
        enabledPlugins += 1;
        enabledSkills += p.skills.length;
      }
    }
    return { totalPlugins: this.plugins.size, enabledPlugins, enabledSkills };
  }

  disposeTemp() {
    if (this._tempCloneRoot && fs.existsSync(this._tempCloneRoot)) {
      try {
        fs.rmSync(this._tempCloneRoot, { recursive: true, force: true });
      } catch {}
      this._tempCloneRoot = null;
    }
  }

  listRules(opts) {
    return this._collect('rules', opts);
  }

  listCommands(opts) {
    return this._collect('commands', opts);
  }

  listAgents(opts) {
    return this._collect('agents', opts);
  }

  listHooks(opts) {
    return this._collect('hooks', opts);
  }

  listMcpServers(opts) {
    return this._collect('mcpServers', opts);
  }
}
