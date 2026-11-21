import { matchGlob } from '../core/ownership.mjs';

/**
 * Progressive-Disclosure Skills, Rules & Slash Commands Runtime:
 * Avoids bloating system prompts by matching only relevant `SKILL.md` skills and
 * glob-scoped `rules/*.md` dynamically based on message text, role, and owned files.
 */
export class SkillsRuntime {
  constructor({ registry }) {
    this.registry = registry;
  }

  listSkills({ enabledOnly = true } = {}) {
    return this.registry.listSkills({ enabledOnly });
  }

  getSkill(nameOrId, { enabledOnly = true } = {}) {
    const clean = String(nameOrId || '').trim().toLowerCase();
    return (
      this.listSkills({ enabledOnly }).find(
        (s) => s.id.toLowerCase() === clean || s.name.toLowerCase() === clean
      ) || null
    );
  }

  listRules({ enabledOnly = true } = {}) {
    return this.registry.listRules({ enabledOnly });
  }

  listCommands({ enabledOnly = true } = {}) {
    return this.registry.listCommands({ enabledOnly });
  }

  /**
   * Match a slash command invocation like `/preflight` or `/ship-check arg1`.
   */
  matchCommand(text) {
    const m = String(text || '').trim().match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
    if (!m) return null;
    const cmdName = m[1].toLowerCase();
    const argsText = (m[2] || '').trim();
    const cmd = this.listCommands({ enabledOnly: true }).find((c) => c.name.toLowerCase() === cmdName);
    if (!cmd) return null;
    return { command: cmd, argsText, args: argsText };
  }

  /**
   * Score and return the most relevant skills for a task/message via progressive disclosure.
   */
  matchSkills({ text = '', role = '', member = null, files = [], limit = 3 } = {}) {
    const effectiveRole = role || member?.role || '';
    const raw = String(text || '').toLowerCase();
    const slashMatch = raw.match(/\/([a-z][a-z0-9_-]*)/g) || [];
    const slashNames = new Set(slashMatch.map((s) => s.slice(1)));
    const fileList = [...(Array.isArray(files) ? files : []), ...(member?.owns || [])];

    const scored = [];
    for (const skill of this.listSkills({ enabledOnly: true })) {
      let score = 0;
      const nameLow = skill.name.toLowerCase();

      const containsToken = (haystack, needle) => {
        if (!needle) return false;
        if (/^[a-z0-9_-]{1,3}$/.test(needle)) {
          return new RegExp(`(?:^|[^a-z0-9_])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9_])`).test(haystack);
        }
        return haystack.includes(needle);
      };

      if (slashNames.has(nameLow) || raw.includes(`$${nameLow}`) || containsToken(raw, nameLow)) {
        score += 10;
      }
      for (const tag of skill.tags || []) {
        const tl = String(tag).toLowerCase();
        if (tl.length >= 2 && containsToken(raw, tl)) score += 3;
      }
      for (const kw of skill.triggers || []) {
        const kl = String(kw).toLowerCase();
        if (kl.length >= 2 && containsToken(raw, kl)) score += 4;
      }
      if (effectiveRole && Array.isArray(skill.roles) && skill.roles.includes(effectiveRole)) {
        score += 2;
      }
      if (fileList.length > 0 && Array.isArray(skill.globs) && skill.globs.length > 0) {
        if (fileList.some((f) => skill.globs.some((g) => matchGlob(f, g)))) {
          score += 4;
        }
      }

      if (score > 0) {
        scored.push({ ...skill, score, matchScore: score });
      }
    }

    return scored.sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name)).slice(0, limit);
  }

  /**
   * Resolve all always-apply rules plus rules whose `globs` match the member's files/paths.
   */
  getApplicableRules({ files = [], role = '' } = {}) {
    const fileList = Array.isArray(files) ? files : [];
    const matched = [];
    for (const rule of this.listRules({ enabledOnly: true })) {
      if (rule.roles?.length && role && !rule.roles.includes(role)) continue;
      if (rule.alwaysApply) {
        matched.push(rule);
        continue;
      }
      if (Array.isArray(rule.globs) && rule.globs.length > 0 && fileList.length > 0) {
        if (fileList.some((f) => rule.globs.some((g) => matchGlob(f, g)))) {
          matched.push(rule);
        }
      }
    }
    return matched;
  }

  /**
   * Build a concise, bounded prompt appendix combining active Rules, progressive-disclosure
   * Skill instructions, and available Skill catalog names.
   */
  buildPromptContext({ text = '', member = null, files = [], maxChars = 4200 } = {}) {
    const memberFiles = [...(Array.isArray(files) ? files : []), ...(member?.owns || [])];
    const rules = this.getApplicableRules({ files: memberFiles, role: member?.role || '' });
    const skills = this.matchSkills({ text, role: member?.role || '', files: memberFiles, limit: 2 });
    const allSkills = this.listSkills({ enabledOnly: true });

    const sections = [];
    if (rules.length > 0) {
      sections.push(
        [
          '## 团队工程规则（Plugin Rules）',
          ...rules.slice(0, 5).map((r) => `### [${r.pluginId}] ${r.name}\n${r.content.slice(0, 600)}`)
        ].join('\n\n')
      );
    }

    if (skills.length > 0) {
      sections.push(
        [
          '## 已激活任务技能（Matched Skills）',
          ...skills.map(
            (s) => `### Skill: ${s.name} (${s.pluginId})\n${s.description ? `> ${s.description}\n` : ''}${s.content.slice(0, 1200)}`
          )
        ].join('\n\n')
      );
    }

    if (allSkills.length > 0) {
      const catalog = allSkills
        .slice(0, 12)
        .map((s) => `- \`${s.name}\`: ${s.description || s.pluginId}`)
        .join('\n');
      sections.push(`## 可按需加载技能目录（调用 skill_read 获取详情）\n${catalog}`);
    }

    const combined = sections.join('\n\n').trim();
    return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n... (已按上下文预算截断)` : combined;
  }
}
