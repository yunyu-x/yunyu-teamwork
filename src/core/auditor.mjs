import fs from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from './constants.mjs';
import { ProjectWorldModel } from './world-model.mjs';

const SECRET_RULES = [
  {
    name: 'GitHub Personal Access Token',
    regex: new RegExp('gh' + 'p_[A-Za-z0-9]{20,}', 'g')
  },
  {
    name: 'GitHub Fine-Grained Token',
    regex: new RegExp('github_' + 'pat_[A-Za-z0-9_]{20,}', 'g')
  },
  {
    name: 'GitLab Personal Access Token',
    regex: new RegExp('gl' + 'pat-[A-Za-z0-9_-]{20,}', 'g')
  },
  {
    name: 'OpenAI / Provider API Key',
    regex: new RegExp('(?<![A-Za-z0-9_-])sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}', 'g')
  },
  {
    name: 'AWS Access Key ID',
    regex: new RegExp('AK' + 'IA[0-9A-Z]{16}', 'g')
  },
  {
    name: 'PEM Private Key Header',
    regex: new RegExp('-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE' + ' KEY-----', 'g')
  }
];

const DANGEROUS_EVAL_RE = new RegExp('\\b(?:ev' + 'al|new\\s+Fun' + 'ction)\\s*\\(', 'g');
const UNSAFE_SHELL_EXEC_RE = /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{/g;

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'case', 'throw', 'delete', 'void', 'typeof', 'instanceof', 'in', 'of', 'new', 'else', 'do', 'yield', 'await'
]);

function findLineNumber(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Strip comments, regex bodies, and plain string text while PRESERVING executable `${...}`
 * expressions inside template literals so dynamic code calls like `` `${eval(x)}` `` are still caught.
 */
function stripCommentsAndStringsPreservingTemplateExpr(source, { preserveStrings = false } = {}) {
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

  const scanTemplate = () => {
    out += preserveStrings ? '`' : ' ';
    i += 1;
    while (i < len) {
      const c = source[i];
      if (c === '\\' && i + 1 < len) {
        out += preserveStrings ? c + source[i + 1] : source[i + 1] === '\n' ? ' \n' : '  ';
        i += 2;
        continue;
      }
      if (c === '$' && source[i + 1] === '{') {
        out += preserveStrings ? '${' : '  ';
        i += 2;
        let braceDepth = 1;
        while (i < len && braceDepth > 0) {
          const ec = source[i];
          if (ec === '{') {
            braceDepth += 1;
            out += ec;
            i += 1;
          } else if (ec === '}') {
            braceDepth -= 1;
            out += braceDepth === 0 ? (preserveStrings ? '}' : ' ') : ec;
            i += 1;
          } else if (ec === '`') {
            scanTemplate();
          } else if (ec === "'" || ec === '"') {
            const q = ec;
            out += preserveStrings ? q : ' ';
            i += 1;
            while (i < len && source[i] !== q) {
              if (source[i] === '\\' && i + 1 < len) {
                out += preserveStrings ? source[i] + source[i + 1] : '  ';
                i += 2;
                continue;
              }
              out += preserveStrings ? source[i] : source[i] === '\n' ? '\n' : ' ';
              i += 1;
            }
            if (i < len) {
              out += preserveStrings ? q : ' ';
              i += 1;
            }
          } else {
            out += ec;
            i += 1;
          }
        }
        continue;
      }
      if (c === '`') {
        out += preserveStrings ? '`' : ' ';
        i += 1;
        break;
      }
      out += preserveStrings ? c : c === '\n' ? '\n' : ' ';
      i += 1;
    }
  };

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < len && source[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
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
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += preserveStrings ? quote : ' ';
      i += 1;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < len) {
          out += preserveStrings ? source[i] + source[i + 1] : '  ';
          i += 2;
          continue;
        }
        out += preserveStrings ? source[i] : source[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < len) {
        out += preserveStrings ? quote : ' ';
        i += 1;
      }
      lastNonWs = quote;
      lastWord = '';
      continue;
    }
    if (ch === '`') {
      scanTemplate();
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

/**
 * Multi-perspective automated repository auditor covering:
 * - Hard engineering invariants (zero external runtime deps)
 * - Security hygiene (hardcoded secrets, eval/new Function, interpolated shell exec)
 * - Architectural health (circular dependencies, ownership overlaps, oversized files)
 * - Release & QA readiness (version parity across CLI/Server/MCP, automated tests)
 */
export class ProjectAuditor {
  static run({ repoPath, worldModel = null, swarm = null } = {}) {
    if (!repoPath) throw new Error('ProjectAuditor.run 需要提供 repoPath');
    const absRepo = path.resolve(repoPath);
    const wm = worldModel || new ProjectWorldModel({ repoPath: absRepo, ownershipGuard: swarm?.ownership || null });
    const snap = wm.refresh({ swarm });

    const findings = [];

    // 1. Invariant: Zero External Runtime Dependencies
    const deps = Object.keys(snap.packageInfo?.dependencies || {});
    if (deps.length > 0) {
      findings.push({
        severity: 'P0',
        category: 'invariant',
        file: 'package.json',
        line: 1,
        message: `违反零外部运行时依赖铁律：package.json 包含运行时依赖 [${deps.join(', ')}]`,
        fixHint: '移除 dependencies 中的第三方包，改用 Node.js >= 22 内置模块实现。'
      });
    }

    // 2. Architecture: Circular Dependencies
    for (const cycle of snap.cycles || []) {
      findings.push({
        severity: 'P1',
        category: 'architecture',
        file: cycle[0],
        line: 1,
        message: `检测到模块循环依赖：${cycle.join(' -> ')}`,
        fixHint: '将公共类型/常量抽离至独立底层模块（如 constants.mjs），打破双向 import 环。'
      });
    }

    // 3. Architecture: Ownership Collisions
    for (const col of snap.collisions || []) {
      findings.push({
        severity: 'P1',
        category: 'architecture',
        file: 'AGENTS.md',
        line: 1,
        message: col.message,
        fixHint: '细化成员 owns 路径或为并发作者开启 workspace: "share" 独立工作树。'
      });
    }

    // 4. Security & Maintainability scan across production source & config files
    const prodCodeFiles = (snap.files || []).filter((f) => f.isCode && !f.isTest);
    const secretScanFiles = (snap.files || []).filter(
      (f) => !f.isTest && (f.isCode || ['.json', '.yml', '.yaml'].includes(f.ext))
    );

    for (const file of secretScanFiles) {
      const absPath = path.join(absRepo, file.path);
      if (!fs.existsSync(absPath)) continue;
      let content = '';
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      // Hardcoded secrets scan (all occurrences)
      for (const rule of SECRET_RULES) {
        rule.regex.lastIndex = 0;
        let m;
        while ((m = rule.regex.exec(content)) !== null) {
          findings.push({
            severity: 'P0',
            category: 'security',
            file: file.path,
            line: findLineNumber(content, m.index),
            message: `疑似硬编码敏感凭据（${rule.name}）`,
            fixHint: '立即移除硬编码密钥并改用环境变量（process.env.*）读取，若已泄露请立即轮换凭据。'
          });
        }
      }
    }

    for (const file of prodCodeFiles) {
      const absPath = path.join(absRepo, file.path);
      if (!fs.existsSync(absPath)) continue;
      let content = '';
      try {
        content = fs.readFileSync(absPath, 'utf8');
      } catch {
        continue;
      }

      // Dynamic code execution scan (outside comments/plain strings, preserving `${...}` expressions)
      const stripped = stripCommentsAndStringsPreservingTemplateExpr(content, { preserveStrings: false });
      DANGEROUS_EVAL_RE.lastIndex = 0;
      let evalMatch;
      while ((evalMatch = DANGEROUS_EVAL_RE.exec(stripped)) !== null) {
        findings.push({
          severity: 'P0',
          category: 'security',
          file: file.path,
          line: findLineNumber(stripped, evalMatch.index),
          message: '检测到危险动态代码执行调用（eval / new Function），存在任意代码注入风险',
          fixHint: '替换为显式数据解析（JSON.parse）或白名单映射表逻辑。'
        });
      }

      // Shell template interpolation scan (comment-stripped)
      const noComments = stripCommentsAndStringsPreservingTemplateExpr(content, { preserveStrings: true });
      UNSAFE_SHELL_EXEC_RE.lastIndex = 0;
      let shellMatch;
      while ((shellMatch = UNSAFE_SHELL_EXEC_RE.exec(noComments)) !== null) {
        findings.push({
          severity: 'P1',
          category: 'security',
          file: file.path,
          line: findLineNumber(noComments, shellMatch.index),
          message: '检测到使用模板字符串拼接的 exec/execSync 调用，可能引发命令注入',
          fixHint: '改用 execFileSync / spawn 并将参数以数组形式传递，禁用 shell 拼接。'
        });
      }

      // Oversized file maintainability warning
      if (file.loc > 1400) {
        findings.push({
          severity: 'P2',
          category: 'maintainability',
          file: file.path,
          line: 1,
          message: `单文件体积偏大（${file.loc} 行），建议按子功能模块拆分以降低并发修改冲突`,
          fixHint: '将视图渲染或路由子域按职责拆分为独立模块。'
        });
      }
    }

    // 5. Release: Version Parity across package.json and APP_VERSION / entrypoints
    const pkgVersion = snap.packageInfo?.version;
    if (pkgVersion) {
      const constantsAbs = path.join(absRepo, 'src/core/constants.mjs');
      if (fs.existsSync(constantsAbs)) {
        const txt = fs.readFileSync(constantsAbs, 'utf8');
        const m = /export const APP_VERSION = ['"]([^'"]+)['"]/.exec(txt);
        if (m && m[1] !== pkgVersion) {
          findings.push({
            severity: 'P2',
            category: 'release',
            file: 'src/core/constants.mjs',
            line: findLineNumber(txt, m.index),
            message: `版本号不一致：src/core/constants.mjs 声明为 ${m[1]}，但 package.json 为 ${pkgVersion}`,
            fixHint: `统一更新 APP_VERSION 为 ${pkgVersion}。`
          });
        }
      }
      const versionTargets = [
        { rel: 'bin/yunyu.mjs', re: /const VERSION = ['"]([^'"]+)['"]/ },
        { rel: 'src/server/routes.mjs', re: /version:\s*['"](\d+\.\d+\.\d+[^'"]*)['"]/ },
        { rel: 'src/mcp/server.mjs', re: /version:\s*['"](\d+\.\d+\.\d+[^'"]*)['"]/ }
      ];
      for (const target of versionTargets) {
        const abs = path.join(absRepo, target.rel);
        if (!fs.existsSync(abs)) continue;
        const txt = fs.readFileSync(abs, 'utf8');
        const m = target.re.exec(txt);
        if (m && m[1] !== pkgVersion) {
          findings.push({
            severity: 'P2',
            category: 'release',
            file: target.rel,
            line: findLineNumber(txt, m.index),
            message: `版本号不一致：${target.rel} 声明为 ${m[1]}，但 package.json 为 ${pkgVersion}`,
            fixHint: `统一更新 ${target.rel} 的版本号为 ${pkgVersion}。`
          });
        }
      }
    }

    // 6. QA: Automated test presence
    if (snap.stats.codeFiles > 0 && snap.stats.testFiles === 0) {
      findings.push({
        severity: 'P1',
        category: 'qa',
        file: 'tests/',
        line: 1,
        message: '仓库缺少自动化测试文件（tests/** 或 *.test.mjs）',
        fixHint: '使用 Node 内置 node:test 补充核心逻辑单元与集成测试。'
      });
    }

    const p0 = findings.filter((f) => f.severity === 'P0').length;
    const p1 = findings.filter((f) => f.severity === 'P1').length;
    const p2 = findings.filter((f) => f.severity === 'P2').length;

    const score = Math.max(0, Math.min(100, 100 - p0 * 25 - p1 * 10 - p2 * 3));
    const passed = p0 === 0 && score >= 70;

    return {
      repoPath: absRepo,
      auditedAt: new Date().toISOString(),
      score,
      passed,
      worldHealthScore: snap.healthScore,
      summary: {
        total: findings.length,
        p0,
        p1,
        p2,
        scannedFiles: prodCodeFiles.length
      },
      findings
    };
  }
}
