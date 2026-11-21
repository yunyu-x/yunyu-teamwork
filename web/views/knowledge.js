import { t } from '../i18n.js';
import { $, api, escapeHtml, formatRichText, formatTime, safeHttpUrl, showToast, state } from '../lib/state.js';

export function renderKnowledge({ renderTopStatus, refreshCurrentSwarm }) {
  const el = $('#knowledge-view-body');
  if (!el) return;
  const cats = [
    ['all', '全部知识'],
    ['research', '🔍 情报调研'],
    ['spec', '📐 Spec 规格'],
    ['adr', '🏛️ 架构决策'],
    ['pitfall', '⚠️ 踩坑记录']
  ];

  const q = state.knowledgeFilters.q.trim().toLowerCase();
  const filtered = state.knowledge.filter((k) => {
    if (state.knowledgeFilters.category !== 'all' && k.category !== state.knowledgeFilters.category) return false;
    if (q) {
      const hay = `${k.title} ${k.summary} ${k.content} ${(k.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  el.innerHTML = `
    <div class="section-stack">
      <div class="panel-card">
        <h3><span>${escapeHtml(t(state.lang, 'knowledgeTitle'))}</span><span class="badge">${state.knowledge.length} 条</span></h3>
        <form id="research-collect-form" class="inline-form">
          <input id="res-topic" type="text" placeholder="输入调研主题 / 关键词（自动检索仓库源码、蜂群历史与可选外部网页）" style="flex:1 1 260px" required />
          <input id="res-urls" type="text" placeholder="可选参考网页 URL（多个以空格分隔）" style="flex:1 1 220px" />
          <button type="submit" class="btn primary">${escapeHtml(t(state.lang, 'knowledgeCollectBtn'))}</button>
        </form>
      </div>

      <div class="toolbar" style="margin-bottom:0;">
        <input type="search" id="kb-search" class="search-input" value="${escapeHtml(state.knowledgeFilters.q)}" placeholder="搜索知识库标题、正文、引用来源或标签..." />
        <div class="pill-group">
          ${cats
            .map(
              ([id, lbl]) => `<button type="button" class="pill ${state.knowledgeFilters.category === id ? 'active' : ''}" data-kb-cat="${id}">${lbl}</button>`
            )
            .join('')}
        </div>
      </div>

      <div class="msg-list">
        ${
          filtered.length
            ? filtered
                .map(
                  (kb) => `
              <article class="panel-card">
                <h3>
                  <span>${escapeHtml(kb.title)}</span>
                  <span style="display:inline-flex;gap:6px;align-items:center;">
                    <span class="badge brief">${escapeHtml(kb.category)}</span>
                    <span class="badge">@${escapeHtml(kb.author)}</span>
                    <span class="badge">${formatTime(kb.createdAt)}</span>
                  </span>
                </h3>
                ${kb.summary ? `<div style="font-size:13px;color:#cbd5e1;margin-bottom:8px;">${escapeHtml(kb.summary)}</div>` : ''}
                <div class="msg-body" style="background:rgba(9,12,18,0.55);padding:10px;border-radius:7px;border:1px solid var(--border);font-size:12.5px;">${formatRichText(kb.content)}</div>
                ${
                  (kb.sources || []).length
                    ? `<div class="label-list" style="margin-top:8px;">
                        <span style="font-size:11.5px;color:var(--text-muted);">引用来源：</span>
                        ${kb.sources
                          .map((s, idx) => {
                            const href = safeHttpUrl(s.url);
                            return href
                              ? `<a class="badge deliverable" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">[${idx + 1}] ${escapeHtml(s.title)}</a>`
                              : `<span class="badge">[${idx + 1}] ${escapeHtml(s.path || s.title)}</span>`;
                          })
                          .join('')}
                      </div>`
                    : ''
                }
                ${
                  (kb.tags || []).length
                    ? `<div class="label-list">${kb.tags.map((tg) => `<span class="badge">#${escapeHtml(tg)}</span>`).join('')}</div>`
                    : ''
                }
              </article>`
                )
                .join('')
            : '<div class="empty-state">暂无知识库记录，可在上方发起多源情报搜集与整合。</div>'
        }
      </div>
    </div>`;

  $('#kb-search')?.addEventListener('input', (ev) => {
    state.knowledgeFilters.q = ev.target.value;
    renderKnowledge({ renderTopStatus, refreshCurrentSwarm });
    const inp = $('#kb-search');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });

  $('#research-collect-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const topic = $('#res-topic').value.trim();
      const urls = $('#res-urls').value.trim();
      if (!topic || !state.currentSwarmId) return;
      const res = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/research`, {
        method: 'POST',
        body: JSON.stringify({ topic, urls, postToBoard: true })
      });
      if (res.entry) {
        state.knowledge.unshift(res.entry);
        renderTopStatus();
        renderKnowledge({ renderTopStatus, refreshCurrentSwarm });
      }
      await refreshCurrentSwarm();
    } catch (err) {
      showToast(err.message);
    }
  });
}
