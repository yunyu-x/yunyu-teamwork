import { t } from './i18n.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInlineMarkdown(line) {
  let html = escapeHtml(line);
  const codeSpans = [];
  html = html.replace(/`([^`]+)`/g, (_, inner) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${inner}</code>`);
    return `\u0000CODE_${idx}\u0000`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\u0000CODE_(\d+)\u0000/g, (_, i) => codeSpans[Number(i)] || '');
  return html;
}

/**
 * Safe, zero-dependency Markdown renderer (always escapes raw HTML first).
 */
export function renderSafeMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  let inCode = false;
  let codeLines = [];
  let inList = false;
  let tableRows = [];

  const flushList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const rows = tableRows
      .map((r) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
      )
      .filter((cells) => cells.some((c) => c.length > 0));
    tableRows = [];
    if (rows.length === 0) return;
    const header = rows[0];
    const bodyStart = rows.length > 1 && rows[1].every((c) => /^:?-{2,}:?$/.test(c)) ? 2 : 1;
    out.push('<div class="wiki-table-wrap"><table class="contract-table"><thead><tr>');
    for (const h of header) out.push(`<th>${renderInlineMarkdown(h)}</th>`);
    out.push('</tr></thead><tbody>');
    for (let i = bodyStart; i < rows.length; i++) {
      out.push('<tr>');
      for (const c of rows[i]) out.push(`<td>${renderInlineMarkdown(c)}</td>`);
      out.push('</tr>');
    }
    out.push('</tbody></table></div>');
  };

  for (const raw of lines) {
    const line = raw;
    if (line.trim().startsWith('```')) {
      flushList();
      flushTable();
      if (!inCode) {
        inCode = true;
        codeLines = [];
      } else {
        inCode = false;
        out.push(`<pre class="wiki-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      flushList();
      tableRows.push(line);
      continue;
    } else {
      flushTable();
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      flushList();
      out.push(`<h4>${renderInlineMarkdown(h3[1])}</h4>`);
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      flushList();
      out.push(`<h3>${renderInlineMarkdown(h2[1])}</h3>`);
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      flushList();
      out.push(`<h2>${renderInlineMarkdown(h1[1])}</h2>`);
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushList();
      out.push(`<blockquote class="wiki-quote">${renderInlineMarkdown(trimmed.slice(1).trim())}</blockquote>`);
      continue;
    }

    const li = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (li) {
      if (!inList) {
        out.push('<ul class="wiki-list">');
        inList = true;
      }
      out.push(`<li>${renderInlineMarkdown(li[1])}</li>`);
      continue;
    }

    flushList();
    out.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  if (inCode) {
    out.push(`<pre class="wiki-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  flushList();
  flushTable();
  return out.join('');
}

const DOMAIN_COLORS = {
  core: '#38e8ff',
  drivers: '#a78bfa',
  channels: '#f472b6',
  gitlab: '#fb923c',
  mcp: '#34d399',
  server: '#60a5fa',
  web: '#fbbf24',
  bin: '#2dd4bf',
  demo: '#c084fc',
  tests: '#94a3b8',
  docs: '#cbd5e1',
  root: '#64748b'
};

function renderDomainTopologySvg(world) {
  const domains = (world?.domains || []).filter((d) => d.codeFileCount > 0 || d.id === 'docs').slice(0, 10);
  if (domains.length === 0) {
    return '<div class="empty-state" style="padding:18px;">当前仓库尚未扫描出源码模块域</div>';
  }

  const width = 760;
  const height = 240;
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.min(270, 120 + domains.length * 18);
  const ry = 82;

  const posMap = new Map();
  domains.forEach((d, idx) => {
    const angle = (Math.PI * 2 * idx) / domains.length - Math.PI / 2;
    const x = domains.length === 1 ? cx : cx + rx * Math.cos(angle);
    const y = domains.length === 1 ? cy : cy + ry * Math.sin(angle);
    posMap.set(d.id, { x, y, d });
  });

  const edges = (world?.domainEdges || []).filter((e) => posMap.has(e.from) && posMap.has(e.to));
  const edgePaths = edges
    .map((e) => {
      const a = posMap.get(e.from);
      const b = posMap.get(e.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const pad = 34;
      const sx = a.x + (dx / dist) * pad;
      const sy = a.y + (dy / dist) * Math.min(24, pad);
      const ex = b.x - (dx / dist) * pad;
      const ey = b.y - (dy / dist) * Math.min(24, pad);
      const mx = (sx + ex) / 2 + (ey - sy) * 0.14;
      const my = (sy + ey) / 2 + (sx - ex) * 0.14;
      const stroke = e.kind === 'test' ? 'rgba(148,163,184,0.35)' : 'rgba(56,232,255,0.6)';
      const dash = e.kind === 'test' ? 'stroke-dasharray="4 3"' : '';
      const sw = Math.min(3.5, 1.3 + e.weight * 0.35);
      return `<path d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${sw.toFixed(1)}" ${dash} marker-end="url(#wm-arrow)" />`;
    })
    .join('');

  const nodesSvg = domains
    .map((d) => {
      const { x, y } = posMap.get(d.id);
      const color = Object.hasOwn(DOMAIN_COLORS, d.id) ? DOMAIN_COLORS[d.id] : '#38e8ff';
      return `
        <g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)})">
          <rect x="-54" y="-22" width="108" height="44" rx="10" fill="#101827" stroke="${color}" stroke-width="1.6" />
          <text x="0" y="-3" text-anchor="middle" fill="#f8fafc" font-size="12" font-weight="700" font-family="ui-monospace, monospace">${escapeHtml(d.id)}</text>
          <text x="0" y="13" text-anchor="middle" fill="#94a3b8" font-size="10">${d.fileCount} files · ${d.totalLoc}L</text>
        </g>`;
    })
    .join('');

  return `
    <svg class="world-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="项目模块域依赖拓扑图">
      <defs>
        <marker id="wm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(56,232,255,0.85)" />
        </marker>
      </defs>
      ${edgePaths}
      ${nodesSvg}
    </svg>`;
}

export function renderWorldWikiView({ state, container }) {
  if (!container) return;
  const lang = state.lang;
  const world = state.worldModel;
  const wikiPages = state.wikiPages || [];
  const impact = state.worldImpact;
  const audit = state.worldAudit || world?.lastAudit || null;

  if (!world) {
    container.innerHTML = `<div class="empty-state">正在扫描项目世界模型与 Wiki 档案...</div>`;
    return;
  }

  if (world.available === false) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(world.reason || '当前蜂群未绑定本地代码仓库')}</div>`;
    return;
  }

  const stats = world.stats || {};
  const healthCls = world.healthScore >= 85 ? 'done' : world.healthScore >= 65 ? 'brief' : 'defect';
  const hubs = world.hubs || [];

  const activeSlug =
    state.activeWikiSlug && wikiPages.some((p) => p.slug === state.activeWikiSlug)
      ? state.activeWikiSlug
      : wikiPages[0]?.slug || null;
  state.activeWikiSlug = activeSlug;
  const activePage = wikiPages.find((p) => p.slug === activeSlug) || null;

  const q = (state.wikiFilters?.q || '').trim().toLowerCase();
  const filteredPages = wikiPages.filter((p) => {
    if (!q) return true;
    return `${p.slug} ${p.title} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q);
  });

  const impactHtml = impact
    ? `
      <div class="impact-result">
        <div class="impact-head">
          <span class="badge ${impact.riskLevel === 'critical' || impact.riskLevel === 'high' ? 'defect' : impact.riskLevel === 'medium' ? 'brief' : 'done'}">
            风险等级：${escapeHtml(impact.riskLevel.toUpperCase())}
          </span>
          <span style="font-size:12px;color:var(--text-muted);">
            受影响文件总计：<strong>${impact.totalImpactedFiles}</strong> · 涉及域：${(impact.affectedDomains || []).map((d) => `<code>${escapeHtml(d)}</code>`).join(' ') || '无'}
          </span>
        </div>
        ${
          (impact.invariantWarnings || []).length > 0
            ? `<div class="impact-warn">${impact.invariantWarnings.map((w) => `<div>⚠️ ${escapeHtml(w)}</div>`).join('')}</div>`
            : ''
        }
        <div class="impact-cols">
          <div>
            <div class="impact-col-title">直接上游依赖 (${impact.directDependents.length})</div>
            <div class="impact-chips">${impact.directDependents.map((f) => `<span class="badge">${escapeHtml(f)}</span>`).join('') || '<span class="muted">无</span>'}</div>
          </div>
          <div>
            <div class="impact-col-title">传递波及模块 (${impact.transitiveImpacted.length})</div>
            <div class="impact-chips">${impact.transitiveImpacted.map((f) => `<span class="badge">${escapeHtml(f)}</span>`).join('') || '<span class="muted">无</span>'}</div>
          </div>
          <div>
            <div class="impact-col-title">建议回归测试 (${impact.impactedTests.length}) & 联动责任人</div>
            <div class="impact-chips">
              ${impact.impactedTests.map((f) => `<span class="badge done">${escapeHtml(f)}</span>`).join('')}
              ${(impact.notifiedOwners || []).map((o) => `<span class="badge brief">@${escapeHtml(o)}</span>`).join('')}
              ${impact.impactedTests.length === 0 && (impact.notifiedOwners || []).length === 0 ? '<span class="muted">无</span>' : ''}
            </div>
          </div>
        </div>
      </div>`
    : `<div class="empty-state" style="padding:12px;">输入任意源码路径（或点击上方核心枢纽文件），即刻预测变更爆炸半径、关联测试与工程不变量提醒。</div>`;

  const auditHtml = audit
    ? `
      <div class="audit-summary-row">
        <span class="badge ${audit.passed ? 'done' : 'defect'}">审计评分：${audit.score} / 100 · ${audit.passed ? 'PASS' : 'FAIL'}</span>
        <span class="badge">扫描源码 ${audit.summary.scannedFiles}</span>
        <span class="badge ${audit.summary.p0 > 0 ? 'defect' : 'done'}">P0: ${audit.summary.p0}</span>
        <span class="badge ${audit.summary.p1 > 0 ? 'brief' : ''}">P1: ${audit.summary.p1}</span>
        <span class="badge">P2: ${audit.summary.p2}</span>
      </div>
      ${
        (audit.findings || []).length === 0
          ? '<div class="empty-state" style="padding:12px;color:var(--green);">✓ 零缺陷：满足零外部依赖铁律、无硬编码凭据、无危险 eval/注入调用、无循环依赖。</div>'
          : `<div class="audit-findings">${audit.findings
              .map(
                (f) => `
                <div class="audit-finding-item">
                  <span class="badge ${f.severity === 'P0' ? 'defect' : f.severity === 'P1' ? 'brief' : ''}">${escapeHtml(f.severity)}</span>
                  <span class="badge">${escapeHtml(f.category)}</span>
                  <code>${escapeHtml(f.file || 'repo')}:${f.line || 1}</code>
                  <span>${escapeHtml(f.message)}</span>
                </div>`
              )
              .join('')}</div>`
      }`
    : `<div class="empty-state" style="padding:12px;">点击「立即全仓审计」检测零依赖铁律、密钥泄露、危险调用、循环依赖与版本一致性。</div>`;

  const wikiEditorHtml = state.wikiEditMode
    ? `
      <form id="form-wiki-edit" class="wiki-editor-form">
        <div class="two-col" style="gap:10px;">
          <div class="form-field">
            <label for="wiki-edit-slug">页面 Slug（英文标识）</label>
            <input id="wiki-edit-slug" required value="${escapeHtml(state.wikiDraft?.slug || '')}" placeholder="例如：adr-001-world-model" ${state.wikiDraft?.isNew ? '' : 'readonly'} />
          </div>
          <div class="form-field">
            <label for="wiki-edit-category">档案分类</label>
            <select id="wiki-edit-category">
              ${[
                ['overview', '项目总览'],
                ['architecture', '系统架构'],
                ['protocol', '协议与接口'],
                ['operations', '工程与门禁'],
                ['decision', '决策与避坑'],
                ['module', '模块域档案'],
                ['custom', '自定义专题']
              ]
                .map(
                  ([val, label]) =>
                    `<option value="${val}" ${(state.wikiDraft?.category || 'custom') === val ? 'selected' : ''}>${label}</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="two-col" style="gap:10px;">
          <div class="form-field">
            <label for="wiki-edit-title">页面标题</label>
            <input id="wiki-edit-title" required value="${escapeHtml(state.wikiDraft?.title || '')}" placeholder="输入中文或双语标题" />
          </div>
          <div class="form-field">
            <label for="wiki-edit-summary">本次修订说明</label>
            <input id="wiki-edit-summary" value="${escapeHtml(state.wikiDraft?.summary || '')}" placeholder="说明新增或修订要点（写入不可变修订史）" />
          </div>
        </div>
        <div class="form-field">
          <label for="wiki-edit-content">Markdown 正文</label>
          <textarea id="wiki-edit-content" rows="12" required>${escapeHtml(state.wikiDraft?.content || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" class="btn small" id="btn-wiki-cancel-edit">取消</button>
          <button type="submit" class="btn small primary">保存新版本</button>
        </div>
      </form>`
    : activePage
      ? `
        <div class="wiki-doc-head">
          <div>
            <h3 style="margin:0 0 4px;">${escapeHtml(activePage.title)}</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--text-muted);">
              <span class="badge">${escapeHtml(activePage.category)}</span>
              <span class="badge brief">v${activePage.version}</span>
              <span>slug: <code>${escapeHtml(activePage.slug)}</code></span>
              <span>· 作者 @${escapeHtml(activePage.author)}</span>
              <span>· 修订次数 ${activePage.revisions?.length || 1}</span>
            </div>
          </div>
          <button type="button" class="btn small" id="btn-wiki-edit-current">✏️ 修订此页</button>
        </div>
        <div class="wiki-markdown-body">${renderSafeMarkdown(activePage.content)}</div>
        ${
          (activePage.revisions || []).length > 0
            ? `<div class="wiki-revisions">
                <div class="impact-col-title">不可变修订历史（JSONL 追加日志）</div>
                ${activePage.revisions
                  .slice(-5)
                  .reverse()
                  .map(
                    (r) =>
                      `<div class="wiki-rev-row"><code>v${r.version}</code> <span>@${escapeHtml(r.author)}</span> · <span>${escapeHtml(r.summary)}</span> <span style="margin-left:auto;color:var(--text-dim);">${escapeHtml(String(r.updatedAt || '').slice(0, 19).replace('T', ' '))}</span></div>`
                  )
                  .join('')}
              </div>`
            : ''
        }`
      : `<div class="empty-state">尚未生成项目 Wiki 档案，点击左侧「世界模型重建 Wiki」即可一键生成活文档。</div>`;

  container.innerHTML = `
    <div class="section-stack">
      <!-- 1. World Model KPI Header -->
      <div class="panel-card">
        <h3>
          <span>🌐 ${escapeHtml(t(lang, 'worldModelTitle'))}</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn small" id="btn-world-refresh">🔄 刷新世界模型</button>
            <button type="button" class="btn small primary" id="btn-run-audit">🛡️ 立即全仓审计</button>
            <button type="button" class="btn small" id="btn-run-audit-issues">📋 审计并建缺陷单</button>
          </div>
        </h3>
        <div class="world-kpi-grid">
          <div class="world-kpi">
            <div class="world-kpi-label">仓库健康度</div>
            <div class="world-kpi-val"><span class="badge ${healthCls}" style="font-size:15px;padding:4px 10px;">${world.healthScore} / 100</span></div>
          </div>
          <div class="world-kpi">
            <div class="world-kpi-label">扫描文件 / 代码行</div>
            <div class="world-kpi-val">${stats.totalFiles || 0} <small>files · ${stats.totalLoc || 0} LOC</small></div>
          </div>
          <div class="world-kpi">
            <div class="world-kpi-label">导出符号 / 依赖边</div>
            <div class="world-kpi-val">${stats.totalExports || 0} <small>exports · ${stats.dependencyEdges || 0} edges</small></div>
          </div>
          <div class="world-kpi">
            <div class="world-kpi-label">循环依赖 / 外部依赖</div>
            <div class="world-kpi-val">
              <span class="badge ${(stats.cyclesCount || 0) === 0 ? 'done' : 'defect'}">${stats.cyclesCount || 0} 环</span>
              <span class="badge ${(stats.runtimeDependencies || 0) === 0 ? 'done' : 'defect'}">${stats.runtimeDependencies || 0} 外部包</span>
            </div>
          </div>
        </div>
        <div class="two-col" style="margin-top:12px;">
          <div class="world-subbox">
            <div class="impact-col-title">模块域静态依赖拓扑（Domain Dependency Graph）</div>
            ${renderDomainTopologySvg(world)}
          </div>
          <div class="world-subbox">
            <div class="impact-col-title">高扇入核心枢纽（点击路径载入爆炸半径模拟器）</div>
            <div class="hub-list">
              ${
                hubs.length > 0
                  ? hubs
                      .slice(0, 8)
                      .map(
                        (h) => `
                        <button type="button" class="hub-row" data-pick-impact-file="${escapeHtml(h.path)}">
                          <code>${escapeHtml(h.path)}</code>
                          <span style="margin-left:auto;display:flex;gap:5px;">
                            <span class="badge">in:${h.fanIn}</span>
                            <span class="badge">${h.loc}L</span>
                          </span>
                        </button>`
                      )
                      .join('')
                  : '<div class="empty-state" style="padding:12px;">暂无高扇入核心文件</div>'
              }
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Change Blast-Radius Simulator & Live Audit -->
      <div class="two-col">
        <div class="panel-card">
          <h3>🎯 ${escapeHtml(t(lang, 'worldImpactTitle'))}</h3>
          <form id="form-world-impact" class="toolbar" style="margin-bottom:10px;">
            <input id="impact-target-input" class="search-input" value="${escapeHtml(state.impactQuery || hubs[0]?.path || '')}" placeholder="输入待改文件路径，如 src/rate-limiter.mjs 或 src/core/board.mjs" />
            <button type="submit" class="btn small primary" id="btn-run-impact">模拟爆炸半径</button>
          </form>
          ${impactHtml}
        </div>
        <div class="panel-card">
          <h3>🛡️ ${escapeHtml(t(lang, 'worldAuditTitle'))}</h3>
          ${auditHtml}
        </div>
      </div>

      <!-- 3. Living Project Wiki Archive -->
      <div class="panel-card">
        <h3>
          <span>📚 ${escapeHtml(t(lang, 'wikiArchiveTitle'))}</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn small" id="btn-wiki-generate">🔄 世界模型重建 Wiki</button>
            <button type="button" class="btn small primary" id="btn-wiki-new">+ 新建 Wiki 页</button>
          </div>
        </h3>
        <div class="wiki-layout">
          <aside class="wiki-sidebar">
            <input type="search" id="wiki-search-input" class="search-input" style="min-width:0;width:100%;margin-bottom:8px;" value="${escapeHtml(state.wikiFilters?.q || '')}" placeholder="搜索 Wiki 标题、分类或标签..." />
            <div class="wiki-nav-list">
              ${
                filteredPages.length > 0
                  ? filteredPages
                      .map(
                        (p) => `
                        <button type="button" class="wiki-nav-item ${p.slug === activeSlug ? 'active' : ''}" data-select-wiki-slug="${escapeHtml(p.slug)}">
                          <div class="wiki-nav-title">${escapeHtml(p.title)}</div>
                          <div class="wiki-nav-meta">
                            <span>${escapeHtml(p.category)}</span>
                            <span>v${p.version}</span>
                          </div>
                        </button>`
                      )
                      .join('')
                  : '<div class="empty-state" style="padding:12px;">无匹配 Wiki 页面</div>'
              }
            </div>
          </aside>
          <div class="wiki-content-pane">
            ${wikiEditorHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}
