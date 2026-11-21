import fs from 'node:fs';
import path from 'node:path';
import { matchGlob, normalizeRelPath } from './ownership.mjs';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.worktrees',
  '.yunyu',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  'tmp',
  '.idea',
  '.vscode'
]);

const CODE_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx']);
const DOC_EXTS = new Set(['.md', '.json', '.html', '.css', '.yml', '.yaml']);

const DOMAIN_LABELS = {
  core: '蜂群核心引擎 (src/core)',
  plugins: 'Agent 插件与生态层 (src/plugins)',
  pluginPacks: '内置插件资产包 (plugins)',
  drivers: '异构 Agent 驱动层 (src/drivers)',
  channels: 'IM 与通信通道层 (src/channels)',
  gitlab: 'GitLab 双向集成层 (src/gitlab)',
  mcp: 'MCP 协议服务端 (src/mcp)',
  server: 'HTTP API 与 SSE 服务 (src/server)',
  demo: '演示与编排场景 (src/demo)',
  web: 'Web 协同看板前端 (web)',
  bin: 'CLI 命令行入口 (bin)',
  tests: '自动化测试与 UI QA (tests)',
  docs: '架构文档与知识沉淀 (docs)',
  examples: '接入示例与脚本 (examples)',
  scripts: '工程脚手架与门禁 (scripts)',
  root: '项目根目录配置'
};

const CRITICAL_CORE_FILES = new Map([
  ['package.json', '修改 package.json 必须坚守零外部运行时依赖铁律（dependencies 为空）。'],
  ['src/core/ownership.mjs', '涉及文件所有权与验证者隔离守卫，变更后必须全量回归所有权与只读隔离单测。'],
  ['src/core/storage.mjs', '涉及 JSONL 追加式不可变持久化，严禁破坏既有 events.jsonl 事件向后兼容性。'],
  ['src/core/board.mjs', '涉及单调递增 #seq 留言板与 @mention 路由，严禁篡改历史消息结构。'],
  ['src/core/orchestrator.mjs', '涉及蜂群总控调度、重启恢复与预算熔断，建议同步跑完集成测试与 demo --once。'],
  ['src/core/worktree.mjs', '涉及 Git Worktree 隔离与合并审计，必须回归真实 Git 仓库隔离集成测试。'],
  ['web/i18n.js', '涉及中英双语字典，新增或调整 key 时须确保 zh-CN 与 en-US 成对完整。']
]);

function classifyDomain(relPath) {
  const norm = normalizeRelPath(relPath);
  const parts = norm.split('/');
  if (parts.length === 1) return 'root';
  if (parts[0] === 'src' && parts.length >= 3) return parts[1];
  if (parts[0] === 'src') return 'core';
  if (parts[0] === 'plugins') return 'pluginPacks';
  if (DOMAIN_LABELS[parts[0]]) return parts[0];
  return parts[0] || 'root';
}

function isTestFile(relPath) {
  const norm = normalizeRelPath(relPath);
  return norm.startsWith('tests/') || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(norm);
}

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'case', 'throw', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'new', 'else', 'do', 'yield', 'await'
]);

/**
 * Context-aware JS lexer stripper:
 * Removes line/block comments, regex literal bodies, and template literal text chunks
 * (preserving string literals on import/export lines) so embedded demo code and regexes
 * containing quotes never desynchronize static module parsing.
 */
function stripCommentsAndTemplatesForModuleParse(source) {
  let out = '';
  let i = 0;
  const len = source.length;
  let lastNonWs = '';
  let lastWord = '';

  const canStartRegex = () => {
    if (!lastNonWs) return true;
    if ('([{:;,=!?&|+-*%^~<>'.includes(lastNonWs)) return true;
    if (REGEX_PRECEDING_KEYWORDS.has(lastWord)) return true;
    return false;
  };

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Line comment
    if (ch === '/' && next === '/') {
      while (i < len && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < len) {
        out += '  ';
        i += 2;
      }
      continue;
    }

    // Regex literal
    if (ch === '/' && canStartRegex()) {
      out += ' ';
      i += 1;
      let inClass = false;
      while (i < len && source[i] !== '\n') {
        const c = source[i];
        if (c === '\\' && i + 1 < len) {
          out += '  ';
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) {
          out += ' ';
          i += 1;
          while (i < len && /[a-z]/i.test(source[i])) {
            out += ' ';
            i += 1;
          }
          break;
        }
        out += ' ';
        i += 1;
      }
      lastNonWs = ')';
      lastWord = '';
      continue;
    }

    // Single / double quoted string literals (keep intact so import/export specifiers remain readable)
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < len) {
          out += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === '\n') {
          out += '\n';
          i += 1;
          break;
        }
        out += source[i];
        i += 1;
      }
      if (i < len && source[i] === quote) {
        out += quote;
        i += 1;
      }
      lastNonWs = quote;
      lastWord = '';
      continue;
    }

    // Template literal: blank text content to avoid parsing embedded code templates as imports/exports
    if (ch === '`') {
      out += ' ';
      i += 1;
      let depth = 0;
      while (i < len) {
        const c = source[i];
        if (c === '\\' && i + 1 < len) {
          out += source[i + 1] === '\n' ? ' \n' : '  ';
          i += 2;
          continue;
        }
        if (c === '$' && source[i + 1] === '{') {
          depth += 1;
          out += '  ';
          i += 2;
          continue;
        }
        if (c === '}' && depth > 0) {
          depth -= 1;
          out += ' ';
          i += 1;
          continue;
        }
        if (c === '`' && depth === 0) {
          out += ' ';
          i += 1;
          break;
        }
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
      lastNonWs = '`';
      lastWord = '';
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let w = ch;
      let j = i + 1;
      while (j < len && /[\w$]/.test(source[j])) {
        w += source[j];
        j += 1;
      }
      out += w;
      lastWord = w;
      lastNonWs = w[w.length - 1];
      i = j;
      continue;
    }

    if (!/\s/.test(ch)) {
      lastNonWs = ch;
      lastWord = '';
    }
    out += ch;
    i += 1;
  }
  return out;
}

function parseJsModule(source) {
  const clean = stripCommentsAndTemplatesForModuleParse(source);
  const rawImports = new Set();
  const exportsSet = new Set();

  // Static imports & re-exports: import ... from 'x', export ... from 'x'
  const fromRe = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^;'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = fromRe.exec(clean)) !== null) {
    if (m[1]) rawImports.add(m[1]);
  }

  // Dynamic import('x') & require('x')
  const dynRe = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(clean)) !== null) {
    if (m[1]) rawImports.add(m[1]);
  }

  // Named declarations: export [default] [async] function|class|const|let|var Name
  const declRe = /(?:^|[\n;])\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = declRe.exec(clean)) !== null) {
    if (m[1]) exportsSet.add(m[1]);
  }

  // Export lists: export { a, b as c }
  const listRe = /(?:^|[\n;])\s*export\s*\{([^}]+)\}/g;
  while ((m = listRe.exec(clean)) !== null) {
    const items = m[1].split(',');
    for (const raw of items) {
      const cleaned = raw.trim();
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const exportedName = (parts[1] || parts[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exportedName)) {
        exportsSet.add(exportedName);
      }
    }
  }

  if (/(?:^|[\n;])\s*export\s+default\b/.test(clean) && exportsSet.size === 0) {
    exportsSet.add('default');
  }

  return {
    rawImports: [...rawImports].sort(),
    exports: [...exportsSet].sort()
  };
}

function resolveRelativeImport(repoPath, fromRelPath, specifier, knownFiles) {
  if (!specifier.startsWith('.')) return null;
  const absRepo = path.resolve(repoPath);
  const fromDir = path.posix.dirname(normalizeRelPath(fromRelPath));
  const joined = path.posix.normalize(fromDir === '.' ? specifier : `${fromDir}/${specifier}`);
  if (joined === '..' || joined.startsWith('../')) return null;
  const candidates = [
    joined,
    `${joined}.mjs`,
    `${joined}.js`,
    `${joined}.cjs`,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.jsx`,
    `${joined}/index.mjs`,
    `${joined}/index.js`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`
  ];
  for (const c of candidates) {
    const norm = normalizeRelPath(c);
    if (!norm || norm.startsWith('../')) continue;
    if (knownFiles.has(norm)) return norm;
    const absTarget = path.resolve(absRepo, norm);
    const relCheck = path.relative(absRepo, absTarget);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) continue;
    if (fs.existsSync(absTarget) && fs.statSync(absTarget).isFile()) {
      return norm;
    }
  }
  return null;
}

function findCycles(adjacency) {
  const color = new Map(); // 0 = white, 1 = gray, 2 = black
  const stack = [];
  const seenKeys = new Set();
  const cycles = [];

  const nodes = [...adjacency.keys()].sort();

  function dfs(node) {
    color.set(node, 1);
    stack.push(node);
    const neighbors = adjacency.get(node) || [];
    for (const next of neighbors) {
      if (!adjacency.has(next)) continue;
      const state = color.get(next) || 0;
      if (state === 1) {
        const idx = stack.indexOf(next);
        if (idx >= 0) {
          const ring = stack.slice(idx);
          const minNode = [...ring].sort()[0];
          const minIdx = ring.indexOf(minNode);
          const canonical = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
          const key = canonical.join(' -> ');
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cycles.push([...canonical, canonical[0]]);
          }
        }
      } else if (state === 0) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(node, 2);
  }

  for (const n of nodes) {
    if ((color.get(n) || 0) === 0) dfs(n);
  }
  return cycles;
}

/**
 * Project World Model — builds a live structural, ownership, dependency, and runtime
 * mental model of the repository so both humans and autonomous agents understand
 * module boundaries, blast radius, hotspots, and system invariants before editing.
 */
export class ProjectWorldModel {
  constructor({ repoPath, ownershipGuard = null } = {}) {
    if (!repoPath) throw new Error('ProjectWorldModel 需要提供 repoPath');
    this.repoPath = path.resolve(repoPath);
    this.ownershipGuard = ownershipGuard || null;
    this.snapshot = null;
  }

  _walkFiles(dirPath, relPrefix = '', acc = []) {
    if (!fs.existsSync(dirPath)) return acc;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = path.join(dirPath, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        this._walkFiles(abs, rel, acc);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTS.has(ext) || DOC_EXTS.has(ext)) {
          acc.push({ abs, rel: normalizeRelPath(rel), ext });
        }
      }
    }
    return acc;
  }

  _computeOwners(relPath, ownershipGuard) {
    if (!ownershipGuard || !ownershipGuard.rules) return [];
    const matched = [];
    for (const [agent, rule] of ownershipGuard.rules.entries()) {
      const forbidden = (rule.mustNotTouch || []).some((pat) => matchGlob(relPath, pat));
      if (forbidden) continue;
      if (Array.isArray(rule.owns) && rule.owns.length > 0) {
        if (rule.owns.some((pat) => matchGlob(relPath, pat))) {
          matched.push(agent);
        }
      }
    }
    return matched.sort();
  }

  _readPackageInfo() {
    const pkgPath = path.join(this.repoPath, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return {
        name: pkg.name || path.basename(this.repoPath),
        version: pkg.version || '0.0.0',
        description: pkg.description || '',
        type: pkg.type || 'commonjs',
        engines: pkg.engines || {},
        scripts: pkg.scripts || {},
        bin: pkg.bin || {},
        dependencies: pkg.dependencies || {},
        devDependencies: pkg.devDependencies || {}
      };
    } catch {
      return null;
    }
  }

  refresh({ swarm = null, ownershipGuard = null } = {}) {
    const guard = ownershipGuard || swarm?.ownership || this.ownershipGuard;
    if (guard) this.ownershipGuard = guard;

    const walked = this._walkFiles(this.repoPath).sort((a, b) => a.rel.localeCompare(b.rel));
    const knownFiles = new Set(walked.map((f) => f.rel));

    const fileMap = new Map();
    const adjacency = new Map();
    const reverseAdj = new Map();
    const externalDeps = new Set();
    const builtinDeps = new Set();

    let totalLoc = 0;
    let totalBytes = 0;
    let totalExports = 0;
    let codeFileCount = 0;
    let testFileCount = 0;
    let docFileCount = 0;

    for (const item of walked) {
      let content = '';
      let bytes = 0;
      try {
        const stat = fs.statSync(item.abs);
        bytes = stat.size;
        if (bytes <= 512 * 1024) {
          content = fs.readFileSync(item.abs, 'utf8');
        }
      } catch {
        continue;
      }

      const loc = content ? content.split('\n').length : 0;
      const domain = classifyDomain(item.rel);
      const isCode = CODE_EXTS.has(item.ext);
      const isTest = isTestFile(item.rel);
      const isDoc = item.ext === '.md' || domain === 'docs';

      let exportsList = [];
      let resolvedImports = [];
      let rawImports = [];

      if (isCode) {
        codeFileCount += 1;
        if (content) {
          const parsed = parseJsModule(content);
          exportsList = parsed.exports;
          rawImports = parsed.rawImports;
          const localSet = new Set();
          for (const spec of rawImports) {
            if (spec.startsWith('node:')) {
              builtinDeps.add(spec);
            } else if (spec.startsWith('.')) {
              const target = resolveRelativeImport(this.repoPath, item.rel, spec, knownFiles);
              if (target && target !== item.rel) localSet.add(target);
            } else if (spec.startsWith('@')) {
              externalDeps.add(spec.split('/').slice(0, 2).join('/'));
            } else {
              externalDeps.add(spec.split('/')[0]);
            }
          }
          resolvedImports = [...localSet].sort();
        }
      }
      if (isTest) testFileCount += 1;
      if (isDoc) docFileCount += 1;

      totalLoc += loc;
      totalBytes += bytes;
      totalExports += exportsList.length;

      const node = {
        path: item.rel,
        domain,
        ext: item.ext,
        isCode,
        isTest,
        isDoc,
        loc,
        bytes,
        exports: exportsList,
        imports: resolvedImports,
        importedBy: [],
        owners: this._computeOwners(item.rel, guard)
      };

      fileMap.set(item.rel, node);
      if (isCode) {
        adjacency.set(item.rel, resolvedImports);
        if (!reverseAdj.has(item.rel)) reverseAdj.set(item.rel, []);
      }
    }

    // Build reverse dependency index & file edges
    const edges = [];
    for (const [fromPath, targets] of adjacency.entries()) {
      for (const toPath of targets) {
        edges.push({ from: fromPath, to: toPath });
        if (!reverseAdj.has(toPath)) reverseAdj.set(toPath, []);
        reverseAdj.get(toPath).push(fromPath);
      }
    }

    for (const [filePath, node] of fileMap.entries()) {
      node.importedBy = [...new Set(reverseAdj.get(filePath) || [])].sort();
      node.fanIn = node.importedBy.length;
      node.fanOut = node.imports.length;
    }

    // Domain summaries & inter-domain edges
    const domainMap = new Map();
    for (const node of fileMap.values()) {
      if (!domainMap.has(node.domain)) {
        domainMap.set(node.domain, {
          id: node.domain,
          label: DOMAIN_LABELS[node.domain] || node.domain,
          fileCount: 0,
          codeFileCount: 0,
          totalLoc: 0,
          exportsCount: 0,
          files: [],
          ownersSet: new Set()
        });
      }
      const d = domainMap.get(node.domain);
      d.fileCount += 1;
      if (node.isCode) d.codeFileCount += 1;
      d.totalLoc += node.loc;
      d.exportsCount += node.exports.length;
      d.files.push(node.path);
      for (const o of node.owners) d.ownersSet.add(o);
    }

    const domains = [...domainMap.values()]
      .map((d) => ({
        id: d.id,
        label: d.label,
        fileCount: d.fileCount,
        codeFileCount: d.codeFileCount,
        totalLoc: d.totalLoc,
        exportsCount: d.exportsCount,
        owners: [...d.ownersSet].sort(),
        sampleFiles: d.files.slice(0, 8)
      }))
      .sort((a, b) => b.totalLoc - a.totalLoc);

    const domainEdgeCounts = new Map();
    for (const edge of edges) {
      const fromNode = fileMap.get(edge.from);
      const toNode = fileMap.get(edge.to);
      if (!fromNode || !toNode || fromNode.domain === toNode.domain) continue;
      const kind = fromNode.isTest ? 'test' : 'runtime';
      const key = `${fromNode.domain}=>${toNode.domain}:${kind}`;
      domainEdgeCounts.set(key, (domainEdgeCounts.get(key) || 0) + 1);
    }

    const domainEdges = [...domainEdgeCounts.entries()]
      .map(([key, weight]) => {
        const [pair, kind] = key.split(':');
        const [from, to] = pair.split('=>');
        return { from, to, weight, kind };
      })
      .sort((a, b) => b.weight - a.weight);

    const cycles = findCycles(adjacency);

    const hubs = [...fileMap.values()]
      .filter((f) => f.isCode && !f.isTest)
      .sort((a, b) => b.fanIn - a.fanIn || b.loc - a.loc)
      .slice(0, 12)
      .map((f) => ({
        path: f.path,
        domain: f.domain,
        fanIn: f.fanIn,
        fanOut: f.fanOut,
        loc: f.loc,
        exportsCount: f.exports.length,
        owners: f.owners
      }));

    const packageInfo = this._readPackageInfo();
    const runtimeDepsCount = Object.keys(packageInfo?.dependencies || {}).length;
    const collisions = guard ? guard.detectCollisions() : [];

    // Live runtime fusion from swarm (if connected)
    let runtime = null;
    if (swarm) {
      const tasks = swarm.tasks?.listTasks ? swarm.tasks.listTasks() : [];
      const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
      const members = swarm.members ? [...swarm.members.values()] : [];
      runtime = {
        swarmId: swarm.id,
        title: swarm.title,
        memberCount: members.length,
        activeMembers: members.filter((m) => m.state === 'working').map((m) => m.name),
        totalTasks: tasks.length,
        openTasks: openTasks.length,
        readyTasks: swarm.tasks?.listReadyTasks ? swarm.tasks.listReadyTasks().length : 0,
        knowledgeCount: swarm.knowledge?.listEntries ? swarm.knowledge.listEntries().length : 0,
        wikiCount: swarm.wiki?.listPages ? swarm.wiki.listPages().length : 0,
        budgetStatus: swarm.budget?.getSummary ? swarm.budget.getSummary() : null,
        ownershipCollisions: collisions.length
      };
    }

    // Health score calculation (0-100)
    let healthScore = 100;
    healthScore -= Math.min(30, cycles.length * 10);
    if (runtimeDepsCount > 0) healthScore -= 25;
    healthScore -= Math.min(20, collisions.length * 10);
    if (testFileCount === 0 && codeFileCount > 0) healthScore -= 15;
    const hugeFiles = [...fileMap.values()].filter((f) => f.isCode && f.loc > 1400);
    healthScore -= Math.min(15, hugeFiles.length * 3);
    healthScore = Math.max(0, Math.min(100, healthScore));

    this.snapshot = {
      repoPath: this.repoPath,
      generatedAt: new Date().toISOString(),
      packageInfo,
      healthScore,
      stats: {
        totalFiles: fileMap.size,
        codeFiles: codeFileCount,
        testFiles: testFileCount,
        docFiles: docFileCount,
        totalLoc,
        totalBytes,
        totalExports,
        dependencyEdges: edges.length,
        domainsCount: domains.length,
        cyclesCount: cycles.length,
        runtimeDependencies: runtimeDepsCount,
        builtinModules: [...builtinDeps].sort(),
        externalPackagesImported: [...externalDeps].sort()
      },
      domains,
      domainEdges,
      hubs,
      cycles,
      collisions,
      runtime,
      files: [...fileMap.values()]
    };

    return this.getSnapshot();
  }

  getSnapshot() {
    if (!this.snapshot) return this.refresh();
    return structuredClone(this.snapshot);
  }

  /**
   * Compact overview suitable for dashboards, API responses, and LLM agent prompts.
   */
  getOverview() {
    const snap = this.getSnapshot();
    const { files, ...rest } = snap;
    return {
      ...rest,
      fileIndex: files.map((f) => ({
        path: f.path,
        domain: f.domain,
        loc: f.loc,
        fanIn: f.fanIn,
        fanOut: f.fanOut,
        isCode: f.isCode,
        isTest: f.isTest,
        exports: f.exports,
        owners: f.owners
      }))
    };
  }

  /**
   * Simulate blast radius (downstream dependents, affected domains, impacted tests,
   * owners to notify, and invariant warnings) before modifying one or more files.
   */
  simulateChangeImpact(targetPaths = []) {
    const snap = this.getSnapshot();
    const rawTargets = Array.isArray(targetPaths) ? targetPaths : [targetPaths];
    const fileByPath = new Map(snap.files.map((f) => [f.path, f]));

    const resolvedTargets = [];
    const missingTargets = [];
    for (const raw of rawTargets) {
      const norm = normalizeRelPath(raw);
      if (!norm) continue;
      if (fileByPath.has(norm)) {
        resolvedTargets.push(norm);
      } else {
        // Allow partial suffix or directory prefix match for ergonomic CLI/UI queries
        const matched = snap.files
          .filter((f) => f.path.endsWith(`/${norm}`) || f.path.startsWith(`${norm.replace(/\/+$/, '')}/`))
          .map((f) => f.path);
        if (matched.length > 0) {
          resolvedTargets.push(...matched);
        } else {
          missingTargets.push(norm);
        }
      }
    }

    const targets = [...new Set(resolvedTargets)].sort();
    const targetSet = new Set(targets);

    // BFS over reverse dependency graph (importedBy)
    const depthMap = new Map();
    const queue = [];
    for (const t of targets) {
      depthMap.set(t, 0);
      queue.push(t);
    }

    while (queue.length > 0) {
      const curr = queue.shift();
      const currDepth = depthMap.get(curr);
      const node = fileByPath.get(curr);
      if (!node) continue;
      for (const dep of node.importedBy || []) {
        if (!depthMap.has(dep)) {
          depthMap.set(dep, currDepth + 1);
          queue.push(dep);
        }
      }
    }

    const directDependents = [];
    const transitiveImpacted = [];
    const impactedTests = [];
    const affectedDomains = new Set();
    const notifiedOwners = new Set();

    for (const [p, depth] of depthMap.entries()) {
      const node = fileByPath.get(p);
      if (!node) continue;
      affectedDomains.add(node.domain);
      for (const o of node.owners || []) notifiedOwners.add(o);

      if (depth === 0) continue;
      if (node.isTest) {
        impactedTests.push(p);
      } else if (depth === 1) {
        directDependents.push(p);
      } else {
        transitiveImpacted.push(p);
      }
    }

    // Also include tests that match target domain/basename even if they execute via CLI/HTTP rather than static import
    const targetBasenames = targets.map((t) => path.posix.basename(t, path.posix.extname(t)).toLowerCase());
    for (const f of snap.files) {
      if (!f.isTest || impactedTests.includes(f.path)) continue;
      const lower = f.path.toLowerCase();
      if (targetBasenames.some((b) => b.length >= 4 && lower.includes(b))) {
        impactedTests.push(f.path);
        for (const o of f.owners || []) notifiedOwners.add(o);
      }
    }

    directDependents.sort();
    transitiveImpacted.sort();
    impactedTests.sort();

    const invariantWarnings = [];
    for (const t of targets) {
      if (CRITICAL_CORE_FILES.has(t)) {
        invariantWarnings.push(`${t}: ${CRITICAL_CORE_FILES.get(t)}`);
      }
      const inCycle = snap.cycles.find((c) => c.includes(t));
      if (inCycle) {
        invariantWarnings.push(`${t} 当前位于循环依赖环中 (${inCycle.join(' -> ')})，修改时需防初始化时序问题。`);
      }
    }

    const nonTargetCodeCount = directDependents.length + transitiveImpacted.length;
    const targetDomains = new Set(targets.map((t) => fileByPath.get(t)?.domain).filter(Boolean));
    const crossDomainCount = [...affectedDomains].filter((d) => !targetDomains.has(d) && d !== 'tests').length;

    let riskLevel = 'low';
    if (
      nonTargetCodeCount >= 12 ||
      crossDomainCount >= 3 ||
      (invariantWarnings.length > 0 && nonTargetCodeCount >= 4)
    ) {
      riskLevel = 'critical';
    } else if (nonTargetCodeCount >= 5 || crossDomainCount >= 2 || invariantWarnings.length > 0) {
      riskLevel = 'high';
    } else if (nonTargetCodeCount >= 2 || crossDomainCount >= 1 || impactedTests.length >= 1) {
      riskLevel = 'medium';
    }

    return {
      targetPaths: targets,
      missingTargets,
      directDependents,
      transitiveImpacted,
      impactedTests,
      affectedDomains: [...affectedDomains].sort(),
      notifiedOwners: [...notifiedOwners].sort(),
      invariantWarnings,
      totalImpactedFiles: directDependents.length + transitiveImpacted.length + impactedTests.length,
      riskLevel
    };
  }

  /**
   * Generate a concise contextual world-model briefing for a specific agent member.
   */
  getAgentBriefing(memberName) {
    const snap = this.getSnapshot();
    const ownedFiles = snap.files.filter((f) => f.owners.includes(memberName));
    const impact = ownedFiles.length > 0 ? this.simulateChangeImpact(ownedFiles.slice(0, 12).map((f) => f.path)) : null;

    const lines = [
      `## 项目世界模型上下文（成员 @${memberName}）`,
      `- 仓库健康度：**${snap.healthScore}/100** · 文件 ${snap.stats.totalFiles} · 代码行 ${snap.stats.totalLoc} · 依赖边 ${snap.stats.dependencyEdges} · 循环依赖 ${snap.stats.cyclesCount}`,
      `- 你的管辖文件数：${ownedFiles.length} 个${ownedFiles.length > 0 ? `（示例：${ownedFiles.slice(0, 5).map((f) => `\`${f.path}\``).join(', ')}）` : '（未绑定窄范围目录）'}`
    ];

    if (impact && impact.notifiedOwners.length > 0) {
      const peers = impact.notifiedOwners.filter((o) => o !== memberName);
      if (peers.length > 0) {
        lines.push(`- 变更联动协作成员：${peers.map((p) => `@${p}`).join(' ')}`);
      }
      if (impact.impactedTests.length > 0) {
        lines.push(`- 必跑关联测试：${impact.impactedTests.slice(0, 6).map((t) => `\`${t}\``).join(', ')}`);
      }
    }

    if (snap.hubs.length > 0) {
      lines.push(
        `- 全仓高扇入核心枢纽：${snap.hubs
          .slice(0, 4)
          .map((h) => `\`${h.path}\` (fanIn=${h.fanIn})`)
          .join(' · ')}`
      );
    }

    return lines.join('\n');
  }
}
