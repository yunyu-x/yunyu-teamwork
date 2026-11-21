import { colorForNode } from '../graph.js';
import { t } from '../i18n.js';
import { $, escapeHtml, formatRichText, formatTime, state } from '../lib/state.js';

function displayBodyForMessage(msg) {
  const hasZh = Boolean(msg.translations && msg.translations['zh-CN']);
  if (state.lang === 'zh-CN' && hasZh && !state.showOriginalMap.has(msg.seq)) {
    return { text: msg.translations['zh-CN'], isTranslated: true, hasTranslation: true };
  }
  return { text: msg.text, isTranslated: false, hasTranslation: hasZh };
}

export function renderMessageCard(msg, { highlight = false } = {}) {
  const membersMap = new Map((state.swarm?.members || []).map((m) => [m.name, m]));
  const role = membersMap.get(msg.author)?.role || (msg.author === 'gitlab' ? 'gitlab' : 'author');
  const col = colorForNode(msg.author, role);
  const initials = msg.author.slice(0, 2).toUpperCase();
  const route = msg.broadcastAll
    ? '→ @all'
    : msg.mentions?.length
      ? `→ ${msg.mentions.map((x) => `@${x}`).join(' ')}`
      : '';
  const bodyObj = displayBodyForMessage(msg);
  const kindBadge =
    msg.kind && msg.kind !== 'post'
      ? `<span class="badge ${escapeHtml(msg.kind)}">${escapeHtml(msg.kind)}</span>`
      : '';
  const sourceBadge =
    msg.metadata?.source === 'im_inbound'
      ? `<span class="badge brief">IM:${escapeHtml(msg.metadata.channelType || 'im')}</span>`
      : '';

  return `
    <article class="msg-card kind-${escapeHtml(msg.kind || 'post')} ${highlight ? 'highlight' : ''}" data-seq="${escapeHtml(msg.seq)}">
      <div class="msg-header">
        <div class="msg-author-row">
          <span class="avatar" style="background:${col}">${escapeHtml(initials)}</span>
          <span class="author-name">@${escapeHtml(msg.author)}</span>
          ${route ? `<span class="mention-route">${escapeHtml(route)}</span>` : ''}
          ${kindBadge}
          ${sourceBadge}
          <span class="badge">#${escapeHtml(msg.channel || 'main')}</span>
        </div>
        <div class="msg-meta">
          <span>#${escapeHtml(msg.seq)}</span>
          <span>·</span>
          <span>${formatTime(msg.time)}</span>
        </div>
      </div>
      <div class="msg-body">${formatRichText(bodyObj.text)}</div>
      ${
        bodyObj.hasTranslation
          ? `<div class="msg-trans-bar">
              <span>${bodyObj.isTranslated ? `🌐 ${t(state.lang, 'translatedTag')}（不篡改不可变原帖）` : '📄 原始不可变消息'}</span>
              <button type="button" class="btn small" data-toggle-trans="${escapeHtml(msg.seq)}">
                ${bodyObj.isTranslated ? t(state.lang, 'showOriginal') : t(state.lang, 'showTranslated')}
              </button>
            </div>`
          : ''
      }
    </article>`;
}

export function renderBoard() {
  const channels = state.swarm?.channels || [{ name: 'main' }];
  $('#channel-pills').innerHTML = [
    `<button type="button" class="pill ${state.filters.channel === 'all' ? 'active' : ''}" data-filter-ch="all">${t(state.lang, 'allChannels')}</button>`,
    ...channels.map(
      (c) => `<button type="button" class="pill ${state.filters.channel === c.name ? 'active' : ''}" data-filter-ch="${escapeHtml(c.name)}">#${escapeHtml(c.name)}</button>`
    )
  ].join('');

  const kinds = [
    ['all', t(state.lang, 'kindAll')],
    ['brief', t(state.lang, 'kindBrief')],
    ['deliverable', t(state.lang, 'kindDeliverable')],
    ['defect', t(state.lang, 'kindDefect')],
    ['gitlab', t(state.lang, 'kindGitlab')],
    ['done', t(state.lang, 'kindDone')]
  ];
  $('#kind-pills').innerHTML = kinds
    .map(
      ([k, lbl]) => `<button type="button" class="pill ${state.filters.kind === k ? 'active' : ''}" data-filter-kind="${k}">${lbl}</button>`
    )
    .join('');

  const q = state.filters.search.trim().toLowerCase();
  const filtered = state.messages.filter((m) => {
    if (state.filters.channel !== 'all' && m.channel !== state.filters.channel) return false;
    if (state.filters.kind !== 'all' && m.kind !== state.filters.kind) return false;
    if (q) {
      const hay = `${m.seq} ${m.author} ${m.text} ${Object.values(m.translations || {}).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const listEl = $('#board-messages');
  listEl.innerHTML = filtered.length
    ? filtered.map((m) => renderMessageCard(m)).join('')
    : `<div class="empty-state">当前筛选条件下暂无留言消息</div>`;

  const activeMembers = (state.swarm?.members || []).filter((m) => !m.killed && m.role !== 'monitor');
  $('#composer-mentions').innerHTML = [
    ...activeMembers.map((m) => `<button type="button" class="mention-chip" data-insert-mention="@${escapeHtml(m.name)}">@${escapeHtml(m.name)}</button>`),
    `<button type="button" class="mention-chip" data-insert-mention="@all">@all</button>`
  ].join('');

  const chSel = $('#composer-channel');
  const prevCh = chSel.value || 'main';
  chSel.innerHTML = channels
    .filter((c) => !c.archived)
    .map((c) => `<option value="${escapeHtml(c.name)}" ${c.name === prevCh ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`)
    .join('');
}
