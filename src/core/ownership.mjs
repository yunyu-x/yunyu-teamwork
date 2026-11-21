import fs from 'node:fs';
import path from 'node:path';
import { MEMBER_ROLES, VERIFIER_FORBIDDEN_DEFAULT } from './constants.mjs';

const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';

export function normalizeRelPath(filePath) {
  const raw = String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!raw) return '';
  const normalized = path.posix.normalize(raw);
  if (normalized === '.') return '';
  return normalized.replace(/^\.\/+/, '');
}

/**
 * Pure zero-dependency glob matcher supporting **, *, ?, and directory prefixes (e.g. "src/core/").
 */
export function matchGlob(filePath, rawPattern) {
  const file = normalizeRelPath(filePath);
  if (file === '..' || file.startsWith('../')) return false;
  let pattern = normalizeRelPath(rawPattern);
  if (!pattern) return false;
  if (pattern === '*' || pattern === '**' || pattern === '**/*') return true;
  if (pattern.endsWith('/')) {
    pattern = `${pattern}**`;
  }

  let reStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          reStr += '(?:.*/)?';
          i += 2;
        } else {
          reStr += '.*';
          i += 1;
        }
      } else {
        reStr += '[^/]*';
      }
    } else if (ch === '?') {
      reStr += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      reStr += `\\${ch}`;
    } else {
      reStr += ch;
    }
  }
  reStr += '$';
  return new RegExp(reStr, CASE_INSENSITIVE_FS ? 'i' : '').test(file);
}

/**
 * Enforces File Ownership boundaries (CONTRACT.json) and Author/Verifier isolation.
 */
export class OwnershipGuard {
  constructor(contract = null) {
    this.rules = new Map(); // agentName -> { role, owns: [], mustNotTouch: [] }
    this.globalForbidden = [];
    this.auditLog = [];
    if (contract) this.loadContract(contract);
  }

  static fromFile(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new OwnershipGuard(raw);
  }

  loadContract(contract) {
    if (!contract || typeof contract !== 'object') return;
    if (Array.isArray(contract.globalForbidden)) {
      this.globalForbidden = [...contract.globalForbidden];
    }
    const members = contract.ownership || contract.members || {};
    for (const [name, rule] of Object.entries(members)) {
      this.setMemberRule(name, rule);
    }
  }

  setMemberRule(agentName, { role = MEMBER_ROLES.AUTHOR, owns = [], mustNotTouch = [] } = {}) {
    const normRole = String(role || MEMBER_ROLES.AUTHOR).trim().toLowerCase();
    const normName = String(agentName || '').trim().toLowerCase();
    const forbidden = new Set(mustNotTouch);
    const isReadOnlyRole =
      normRole === MEMBER_ROLES.VERIFIER ||
      normRole === MEMBER_ROLES.REVIEWER ||
      normRole === MEMBER_ROLES.RESEARCHER ||
      normRole === 'qa' ||
      normName === 'qa' ||
      normName === 'verifier' ||
      normName === 'reviewer' ||
      normName === 'researcher';
    if (isReadOnlyRole) {
      for (const p of VERIFIER_FORBIDDEN_DEFAULT) forbidden.add(p);
    }
    this.rules.set(agentName, {
      agent: agentName,
      role: normRole,
      isReadOnlyRole,
      owns: [...owns],
      mustNotTouch: [...forbidden]
    });
  }

  removeMemberRule(agentName) {
    this.rules.delete(agentName);
  }

  getMemberRule(agentName) {
    return this.rules.get(agentName) || null;
  }

  checkWrite(agentName, filePath) {
    const rel = normalizeRelPath(filePath);
    if (!rel || rel === '..' || rel.startsWith('../')) {
      return {
        allowed: false,
        path: rel,
        rule: 'path-traversal',
        reason: `安全拦截：路径 "${filePath}" 包含非法路径穿越或越出仓库根目录`
      };
    }

    for (const pat of this.globalForbidden) {
      if (matchGlob(rel, pat)) {
        return {
          allowed: false,
          path: rel,
          rule: pat,
          reason: `全局禁止直接修改生成产物或受保护路径 "${pat}"（请改源码后通过构建生成）`
        };
      }
    }

    const rule = this.rules.get(agentName);
    if (!rule) {
      return { allowed: true, path: rel, reason: '未配置显式限制规则，允许写入' };
    }

    for (const pat of rule.mustNotTouch) {
      if (matchGlob(rel, pat)) {
        const extra =
          rule.role === MEMBER_ROLES.VERIFIER || rule.role === MEMBER_ROLES.REVIEWER
            ? '（铁律：复核者/QA 验证者严禁修改业务源码，请开具复核意见或缺陷单交由对应作者修复）'
            : '';
        return {
          allowed: false,
          path: rel,
          rule: pat,
          reason: `成员 @${agentName} 严禁修改匹配 "${pat}" 的路径${extra}`
        };
      }
    }

    if (rule.owns.length > 0) {
      const matched = rule.owns.find((pat) => matchGlob(rel, pat));
      if (!matched) {
        return {
          allowed: false,
          path: rel,
          rule: rule.owns.join(', '),
          reason: `路径 "${rel}" 不在成员 @${agentName} 的独占所有权列表 [${rule.owns.join(', ')}] 内`
        };
      }
    } else if (rule.role === MEMBER_ROLES.REVIEWER || rule.role === MEMBER_ROLES.RESEARCHER) {
      return {
        allowed: false,
        path: rel,
        rule: 'read-only-no-owns',
        reason: `只读审查/调研角色 @${agentName} (${rule.role}) 未声明显式可写路径 owns，默认禁止写入仓库文件`
      };
    }

    return { allowed: true, path: rel, reason: '通过文件所有权边界校验' };
  }

  /**
   * Audit a list of modified files (e.g., from `git diff --name-only`) for an agent.
   */
  auditChangedFiles(agentName, changedFiles = []) {
    const violations = [];
    for (const f of changedFiles) {
      const res = this.checkWrite(agentName, f);
      if (!res.allowed) violations.push(res);
    }
    const record = {
      time: new Date().toISOString(),
      agent: agentName,
      filesChecked: changedFiles.length,
      passed: violations.length === 0,
      violations
    };
    this.auditLog.push(record);
    if (this.auditLog.length > 200) this.auditLog.shift();
    return record;
  }

  /**
   * Detect potential ownership overlaps between concurrent authors.
   */
  detectCollisions() {
    const collisions = [];
    const authors = [...this.rules.values()].filter(
      (r) => r.role === MEMBER_ROLES.AUTHOR || r.role === MEMBER_ROLES.ARCHITECT
    );
    for (let i = 0; i < authors.length; i++) {
      for (let j = i + 1; j < authors.length; j++) {
        const a = authors[i];
        const b = authors[j];
        for (const pa of a.owns) {
          for (const pb of b.owns) {
            const normA = normalizeRelPath(pa).replace(/\/?\*\*$/, '');
            const normB = normalizeRelPath(pb).replace(/\/?\*\*$/, '');
            if (
              pa === pb ||
              matchGlob(normA, pb) ||
              matchGlob(normB, pa) ||
              (normA && normB && (normA.startsWith(`${normB}/`) || normB.startsWith(`${normA}/`)))
            ) {
              collisions.push({
                agentA: a.agent,
                patternA: pa,
                agentB: b.agent,
                patternB: pb,
                message: `所有权冲突风险：@${a.agent}("${pa}") 与 @${b.agent}("${pb}") 存在重叠，请拆分目录或使用独立 worktree`
              });
            }
          }
        }
      }
    }
    return collisions;
  }

  toJSON() {
    return {
      globalForbidden: [...this.globalForbidden],
      rules: [...this.rules.values()],
      collisions: this.detectCollisions(),
      auditLog: this.auditLog.slice(-30)
    };
  }
}
