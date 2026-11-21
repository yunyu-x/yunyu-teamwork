import { colorForNode, renderCollaborationGraph } from './graph.js';
import { I18N, t } from './i18n.js';

const state = {
  lang: 'zh-CN',
  tab: 'board',
  swarms: [],
  currentSwarmId: null,
  swarm: null,
  messages: [],
  gitlab: null,
  filters: {
    search: '',
    channel: 'all',
    kind: 'all'
  },
  showOriginalMap: new Set(), // seqs toggled to original text
  graph: {
    upToSeq: null,
    hideInactive: false,
    expandAll: false,
    playing: false,
    speed: 1,
    timer: null,
    data: null
  },
  sse: null
};

const $ = (sel) => document.querySelector(sel);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatRichText(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(（【\[,:;，：；])(@#?[a-z][a-z0-9_-]*)/g, '$1<span class="mention-tok">$2</span>');
  html = html.replace(/(^|[\s(（【\[,:;，：；])#(\d+)\b/g, '$1<span class="seq-link" data-jump-seq="$2">#$2</span>');
  return html;
}

function displayBodyForMessage(msg) {
  const hasZh = Boolean(msg.translations && msg.translations['zh-CN']);
  if (state.lang === 'zh-CN' && hasZh && !state.showOriginalMap.has(msg.seq)) {
    return { text: msg.translations['zh-CN'], isTranslated: true, hasTranslation: true };
  }
  return { text: msg.text, isTranslated: false, hasTranslation: hasZh };
}

function renderMessageCard(msg, { highlight = false } = {}) {
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
  const kindBadge = msg.kind && msg.kind !== 'post'
    ? `<span class="badge ${escapeHtml(msg.kind)}">${escapeHtml(msg.kind)}</span>`
    : '';

  return `
    <article class="msg-card kind-${escapeHtml(msg.kind || 'post')} ${highlight ? 'highlight' : ''}" data-seq="${msg.seq}">
      <div class="msg-header">
        <div class="msg-author-row">
          <span class="avatar" style="background:${col}">${escapeHtml(initials)}</span>
          <span class="author-name">@${escapeHtml(msg.author)}</span>
          ${route ? `<span class="mention-route">${escapeHtml(route)}</span>` : ''}
          ${kindBadge}
          <span class="badge">#${escapeHtml(msg.channel || 'main')}</span>
        </div>
        <div class="msg-meta">
          <span>#${msg.seq}</span>
          <span>·</span>
          <span>${formatTime(msg.time)}</span>
        </div>
      </div>
      <div class="msg-body">${formatRichText(bodyObj.text)}</div>
      ${
        bodyObj.hasTranslation
          ? `<div class="msg-trans-bar">
              <span>${bodyObj.isTranslated ? `🌐 ${t(state.lang, 'translatedTag')}（不篡改不可变原帖）` : '📄 原始不可变消息'}</span>
              <button type="button" class="btn small" data-toggle-trans="${msg.seq}">
                ${bodyObj.isTranslated ? t(state.lang, 'showOriginal') : t(state.lang, 'showTranslated')}
              </button>
            </div>`
          : ''
      }
    </article>`;
}

function applyStaticLabels() {
  const L = state.lang;
  $('#brand-name').textContent = t(L, 'brandName');
  $('#lang-toggle').textContent = L === 'zh-CN' ? 'EN' : '中文';
  $('#btn-new-swarm').textContent = t(L, 'newSwarmBtn');
  $('#btn-add-member').textContent = t(L, 'addMemberBtn');
  $('#tab-label-board').textContent = t(L, 'tabBoard');
  $('#tab-label-graph').textContent = t(L, 'tabGraph');
  $('#tab-label-members').textContent = t(L, 'tabMembers');
  $('#tab-label-gitlab').textContent = t(L, 'tabGitlab');
  $('#tab-label-contract').textContent = t(L, 'tabContract');
  $('#board-search').placeholder = t(L, 'searchPlaceholder');
  $('#composer-text').placeholder = t(L, 'composerPlaceholder');
  $('#composer-send').textContent = t(L, 'sendBtn');
  $('#lbl-hide-inactive').textContent = t(L, 'graphHideInactive');
  $('#lbl-expand-all').textContent = t(L, 'graphExpandAll');
  $('#graph-live-btn').textContent = t(L, 'graphLive');
  $('#legend-mention').textContent = t(L, 'graphLegendMention');
  $('#legend-all').textContent = t(L, 'graphLegendAll');
  $('#legend-active').textContent = t(L, 'graphLegendActive');
  $('#modal-member-title').textContent = t(L, 'modalAddMemberTitle');
  $('#modal-swarm-title').textContent = t(L, 'modalNewSwarmTitle');
}

function renderTopStatus() {
  const s = state.swarm;
  const sel = $('#swarm-select');
  sel.innerHTML = state.swarms
    .map((sw) => `<option value="${escapeHtml(sw.id)}" ${sw.id === state.currentSwarmId ? 'selected' : ''}>${escapeHtml(sw.title)}</option>`)
    .join('');

  const pill = $('#live-status-pill');
  const isDone = Boolean(s?.done);
  pill.className = `live-pill ${isDone ? 'done' : ''}`;
  pill.innerHTML = `<span class="live-dot"></span><span>${isDone ? t(state.lang, 'doneBadge') : t(state.lang, 'liveBadge')}</span>`;

  $('#count-board').textContent = String(state.messages.length);
  $('#count-members').textContent = String((s?.members || []).filter((m) => !m.killed).length);
  $('#count-gitlab').textContent = state.gitlab?.connected
    ? String((state.gitlab.issues?.length || 0) + (state.gitlab.mergeRequests?.length || 0))
    : '0';
}

function renderBoard() {
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

  // Composer quick mention chips & channel selector
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

async function renderGraphView() {
  if (!state.currentSwarmId) return;
  const total = state.messages.length;
  const slider = $('#graph-slider');
  slider.min = total > 0 ? '1' : '0';
  slider.max = String(total);

  if (state.graph.upToSeq === null || state.graph.upToSeq > total) {
    state.graph.upToSeq = total;
  }
  slider.value = String(state.graph.upToSeq);

  const qs = new URLSearchParams();
  if (state.graph.upToSeq > 0) qs.set('upToSeq', String(state.graph.upToSeq));
  if (state.graph.expandAll) qs.set('expandAll', 'true');

  const data = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/graph?${qs.toString()}`);
  state.graph.data = data;

  renderCollaborationGraph($('#graph-svg'), data, { hideInactive: state.graph.hideInactive });

  const cur = data.currentMessage;
  $('#graph-step-label').textContent = cur
    ? I18N[state.lang].graphStepFormat(state.graph.upToSeq, total, cur.seq, formatTime(cur.time))
    : '0 / 0';
  $('#graph-play-btn').textContent = state.graph.playing ? '❚❚' : '▶';

  $('#graph-detail').innerHTML = cur
    ? renderMessageCard(cur, { highlight: true })
    : `<div class="empty-state">选择时间轴上的消息节点查看详细交付内容</div>`;
}

function renderMembers() {
  const members = state.swarm?.members || [];
  const stateLabels = I18N[state.lang].stateLabels;
  const roleLabels = I18N[state.lang].roleLabels;

  $('#members-grid').innerHTML = members
    .map((m) => {
      const col = colorForNode(m.name, m.role);
      return `
        <div class="panel-card">
          <h3>
            <span style="display:inline-flex;align-items:center;gap:8px;">
              <span class="avatar" style="background:${col}">${escapeHtml(m.name.slice(0, 2).toUpperCase())}</span>
              <span>@${escapeHtml(m.name)}</span>
            </span>
            <span class="state-pill state-${escapeHtml(m.state)}">${escapeHtml(stateLabels[m.state] || m.state)}</span>
          </h3>
          <div class="kv-list">
            <div class="kv-row"><span>角色</span><code>${escapeHtml(roleLabels[m.role] || m.role)}</code></div>
            <div class="kv-row"><span>接入驱动</span><code>${escapeHtml(m.driver)}</code></div>
            <div class="kv-row"><span>模型 / 引擎</span><code>${escapeHtml(m.model || 'default')}</code></div>
            <div class="kv-row"><span>工作区模式</span><code>${escapeHtml(m.workspaceMode)}${m.branch ? ` (${escapeHtml(m.branch)})` : ''}</code></div>
            <div class="kv-row"><span>独占所有权</span><code>${escapeHtml(m.owns?.length ? m.owns.join(', ') : '—')}</code></div>
            <div class="kv-row"><span>禁止修改</span><code>${escapeHtml(m.mustNotTouch?.length ? m.mustNotTouch.join(', ') : '—')}</code></div>
            <div class="kv-row"><span>轮次 / 最新发帖</span><code>${m.turns} 轮 / #${m.lastPostSeq || 0}</code></div>
          </div>
          ${
            !m.killed && m.role !== 'monitor'
              ? `<div style="display:flex;gap:8px;margin-top:12px;">
                  <button type="button" class="btn small primary" data-mention-member="${escapeHtml(m.name)}">@${escapeHtml(m.name)} 发消息</button>
                  <button type="button" class="btn small danger" data-kill-member="${escapeHtml(m.name)}">销毁节点</button>
                </div>`
              : ''
          }
        </div>`;
    })
    .join('');
}

function renderGitLab() {
  const el = $('#gitlab-view-body');
  if (!state.gitlab || !state.gitlab.connected) {
    el.innerHTML = `<div class="panel-card"><p>${escapeHtml(t(state.lang, 'gitlabDisconnected'))}</p></div>`;
    return;
  }

  const { project, issues = [], mergeRequests = [], pipelines = [], syncLog = [] } = state.gitlab;
  el.innerHTML = `
    <div class="section-stack">
      <div class="panel-card">
        <h3>
          <span>🦊 GitLab 仓库：<code>${escapeHtml(project?.path_with_namespace || state.gitlab.projectId)}</code></span>
          <span class="badge gitlab">${escapeHtml(state.gitlab.baseUrl)}</span>
        </h3>
        <form id="gitlab-issue-form" class="inline-form">
          <input id="gl-issue-title" type="text" placeholder="输入新 GitLab Issue 标题（提交后将自动唤醒 @coordinator 拆解研发）" style="flex:1 1 280px" required />
          <input id="gl-issue-desc" type="text" placeholder="验收标准 / 需求描述（可选）" style="flex:1 1 240px" />
          <button type="submit" class="btn primary">${escapeHtml(t(state.lang, 'gitlabNewIssue'))}</button>
        </form>
      </div>

      <div class="two-col">
        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabIssues'))}</span><span class="badge">${issues.length}</span></h3>
          ${issues
            .map(
              (iss) => `
            <div class="item-box">
              <div class="item-box-title">#${iss.iid} ${escapeHtml(iss.title)}</div>
              <div style="font-size:12px;color:var(--text-muted);">${escapeHtml((iss.description || '').slice(0, 140))}</div>
              <div class="label-list">
                <span class="badge ${iss.state === 'opened' ? 'deliverable' : ''}">${escapeHtml(iss.state)}</span>
                ${(iss.labels || []).map((lb) => `<span class="badge">${escapeHtml(lb)}</span>`).join('')}
                <span class="badge">💬 ${iss.notes?.length || 0} 条评论</span>
              </div>
            </div>`
            )
            .join('') || '<div class="empty-state">暂无 Issues</div>'}
        </div>

        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabMrs'))}</span><span class="badge">${mergeRequests.length}</span></h3>
          ${mergeRequests
            .map(
              (mr) => `
            <div class="item-box">
              <div class="item-box-title">!${mr.iid} ${escapeHtml(mr.title)}</div>
              <div style="font-size:12px;font-family:var(--mono);color:var(--text-muted);">${escapeHtml(mr.source_branch)} → ${escapeHtml(mr.target_branch)}</div>
              <div class="label-list" style="align-items:center;justify-content:space-between;">
                <span class="badge ${mr.state === 'merged' ? 'done' : 'gitlab'}">${escapeHtml(mr.state)}</span>
                ${
                  mr.state === 'opened'
                    ? `<button type="button" class="btn small primary" data-merge-mr="${mr.iid}">批准并合并 MR</button>`
                    : ''
                }
              </div>
            </div>`
            )
            .join('') || '<div class="empty-state">暂无 Merge Requests</div>'}
        </div>
      </div>

      <div class="two-col">
        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabPipelines'))}</span><span class="badge">${pipelines.length}</span></h3>
          ${pipelines
            .map(
              (p) => `
            <div class="item-box">
              <div class="item-box-title">Pipeline #${p.id} · 分支 <code>${escapeHtml(p.ref)}</code></div>
              <div class="label-list">
                <span class="badge ${p.status === 'success' ? 'done' : 'defect'}">${escapeHtml(p.status)}</span>
                <span class="badge">${p.duration || 0}s</span>
                ${(p.jobs || []).map((j) => `<span class="badge">${escapeHtml(j.stage)}/${escapeHtml(j.name)}</span>`).join('')}
              </div>
            </div>`
            )
            .join('')}
        </div>

        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'gitlabSyncLog'))}</span><span class="badge">${syncLog.length}</span></h3>
          ${syncLog
            .slice()
            .reverse()
            .slice(0, 8)
            .map(
              (s) => `
            <div class="item-box">
              <div style="font-family:var(--mono);font-size:12px;">#${s.seq} · ${formatTime(s.time)}</div>
              <div class="label-list">${s.actions.map((a) => `<span class="badge deliverable">${escapeHtml(a)}</span>`).join('')}</div>
            </div>`
            )
            .join('') || '<div class="empty-state">等待看板阶段交付自动镜像至 GitLab...</div>'}
        </div>
      </div>
    </div>`;

  const issueForm = $('#gitlab-issue-form');
  if (issueForm) {
    issueForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const title = $('#gl-issue-title').value.trim();
      const description = $('#gl-issue-desc').value.trim();
      if (!title) return;
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/issues`, {
        method: 'POST',
        body: JSON.stringify({ title, description, triggerSwarm: true })
      });
      await refreshCurrentSwarm();
    });
  }
}

function renderContract() {
  const ownership = state.swarm?.ownership || { rules: [], globalForbidden: [], collisions: [], auditLog: [] };
  const worktrees = state.swarm?.worktrees || [];
  const members = (state.swarm?.members || []).filter((m) => !m.killed);

  $('#contract-view-body').innerHTML = `
    <div class="section-stack">
      <div class="panel-card">
        <h3>
          <span>${escapeHtml(t(state.lang, 'contractMatrix'))}</span>
          <span class="badge ${ownership.collisions.length ? 'defect' : 'done'}">
            ${ownership.collisions.length ? `⚠️ ${ownership.collisions.length} 处冲突` : `✓ ${t(state.lang, 'noCollisions')}`}
          </span>
        </h3>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">
          全局禁改路径：<code>${escapeHtml(ownership.globalForbidden.join(', ') || '无')}</code>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>成员</th><th>角色</th><th>独占可写路径 (owns)</th><th>严禁触碰路径 (mustNotTouch)</th></tr></thead>
            <tbody>
              ${ownership.rules
                .map(
                  (r) => `<tr>
                    <td><code>@${escapeHtml(r.agent)}</code></td>
                    <td>${escapeHtml(r.role)}</td>
                    <td><code>${escapeHtml(r.owns.join(', ') || '—')}</code></td>
                    <td><code>${escapeHtml(r.mustNotTouch.join(', ') || '—')}</code></td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="two-col">
        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'contractTester'))}</span></h3>
          <form id="ownership-test-form" class="inline-form">
            <select id="own-member">
              ${members.map((m) => `<option value="${escapeHtml(m.name)}">@${escapeHtml(m.name)} (${escapeHtml(m.role)})</option>`).join('')}
            </select>
            <input id="own-path" type="text" value="src/rate-limiter.mjs" placeholder="输入相对文件路径，如 src/index.mjs" style="flex:1 1 180px" />
            <button type="submit" class="btn primary">校验写权限</button>
          </form>
          <div id="own-test-result" style="margin-top:10px;font-size:12.5px;color:var(--text-muted);">
            提示：尝试用 <code>@qa</code> 测试写入 <code>src/rate-limiter.mjs</code>，将立即触发 QA 只读隔离铁律拦截。
          </div>
        </div>

        <div class="panel-card">
          <h3><span>${escapeHtml(t(state.lang, 'contractWorktrees'))}</span><span class="badge">${worktrees.length}</span></h3>
          ${worktrees
            .map(
              (w) => `
            <div class="item-box">
              <div class="item-box-title">@${escapeHtml(w.agent)} · <code>${escapeHtml(w.mode)}</code> ${w.branch ? `(${escapeHtml(w.branch)})` : ''}</div>
              <div style="font-size:11.5px;font-family:var(--mono);color:var(--text-muted);">
                HEAD: ${escapeHtml(w.headSha || '—')} · 已合并: ${w.merged ? '是' : '否'} · 变更文件: ${w.changedFiles?.length || 0}
              </div>
            </div>`
            )
            .join('')}
        </div>
      </div>

      <div class="panel-card">
        <h3><span>${escapeHtml(t(state.lang, 'contractAuditLog'))}</span><span class="badge">${ownership.auditLog.length}</span></h3>
        ${ownership.auditLog
          .slice()
          .reverse()
          .slice(0, 10)
          .map(
            (a) => `
          <div class="item-box">
            <div style="display:flex;justify-content:space-between;gap:8px;font-family:var(--mono);font-size:12px;">
              <span>@${escapeHtml(a.agent)} · 检查 ${a.filesChecked} 个文件</span>
              <span class="badge ${a.passed ? 'done' : 'defect'}">${a.passed ? 'PASS' : 'BLOCKED'}</span>
            </div>
          </div>`
          )
          .join('') || '<div class="empty-state">暂无提交/合并审计记录</div>'}
      </div>
    </div>`;

  const form = $('#ownership-test-form');
  if (form) {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const member = $('#own-member').value;
      const filePath = $('#own-path').value.trim();
      const res = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/ownership/check`, {
        method: 'POST',
        body: JSON.stringify({ member, filePath })
      });
      $('#own-test-result').innerHTML = `<span class="badge ${res.allowed ? 'done' : 'defect'}">${res.allowed ? '✓ 允许写入' : '✕ 守卫拦截'}</span> ${escapeHtml(res.reason)}`;
    });
  }
}

async function refreshAll() {
  const { swarms } = await api('/api/swarms');
  state.swarms = swarms;
  if (!state.currentSwarmId || !swarms.some((s) => s.id === state.currentSwarmId)) {
    state.currentSwarmId = swarms[0]?.id || null;
  }
  await refreshCurrentSwarm();
}

async function refreshCurrentSwarm() {
  if (!state.currentSwarmId) return;
  const [swarm, msgData, glData] = await Promise.all([
    api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}`),
    api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/messages?limit=300`),
    api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/overview`)
  ]);
  state.swarm = swarm;
  state.messages = msgData.messages || [];
  state.gitlab = glData;

  renderTopStatus();
  renderBoard();
  renderMembers();
  renderGitLab();
  renderContract();
  if (state.tab === 'graph') {
    await renderGraphView();
  }
}

function setActiveTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  $('#composer-bar').style.display = tab === 'board' ? 'block' : 'none';
  if (tab === 'graph') {
    renderGraphView();
  }
}

function toggleGraphPlay() {
  if (state.graph.playing) {
    state.graph.playing = false;
    clearInterval(state.graph.timer);
    state.graph.timer = null;
    $('#graph-play-btn').textContent = '▶';
    return;
  }
  if (state.messages.length === 0) return;
  if (state.graph.upToSeq >= state.messages.length) {
    state.graph.upToSeq = 1;
  }
  state.graph.playing = true;
  $('#graph-play-btn').textContent = '❚❚';
  const interval = Math.round(1100 / state.graph.speed);
  state.graph.timer = setInterval(async () => {
    if (state.graph.upToSeq >= state.messages.length) {
      toggleGraphPlay();
      return;
    }
    state.graph.upToSeq += 1;
    await renderGraphView();
  }, interval);
}

function connectSse() {
  if (state.sse) state.sse.close();
  const es = new EventSource('/api/events');
  const handleUpdate = () => refreshCurrentSwarm().catch(() => {});
  es.addEventListener('message', handleUpdate);
  es.addEventListener('status', handleUpdate);
  es.addEventListener('translation', handleUpdate);
  es.addEventListener('swarm_created', () => refreshAll().catch(() => {}));
  state.sse = es;
}

function bindEvents() {
  $('#lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'zh-CN' ? 'en-US' : 'zh-CN';
    applyStaticLabels();
    renderTopStatus();
    renderBoard();
    renderMembers();
    renderGitLab();
    renderContract();
    if (state.tab === 'graph') renderGraphView();
  });

  $('#swarm-select').addEventListener('change', async (ev) => {
    state.currentSwarmId = ev.target.value;
    state.graph.upToSeq = null;
    await refreshCurrentSwarm();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  $('#board-search').addEventListener('input', (ev) => {
    state.filters.search = ev.target.value;
    renderBoard();
  });

  document.addEventListener('click', async (ev) => {
    const chBtn = ev.target.closest('[data-filter-ch]');
    if (chBtn) {
      state.filters.channel = chBtn.dataset.filterCh;
      renderBoard();
      return;
    }

    const kindBtn = ev.target.closest('[data-filter-kind]');
    if (kindBtn) {
      state.filters.kind = kindBtn.dataset.filterKind;
      renderBoard();
      return;
    }

    const transBtn = ev.target.closest('[data-toggle-trans]');
    if (transBtn) {
      const seq = Number(transBtn.dataset.toggleTrans);
      if (state.showOriginalMap.has(seq)) state.showOriginalMap.delete(seq);
      else state.showOriginalMap.add(seq);
      renderBoard();
      if (state.tab === 'graph') renderGraphView();
      return;
    }

    const jumpEl = ev.target.closest('[data-jump-seq]');
    if (jumpEl) {
      const seq = Number(jumpEl.dataset.jumpSeq);
      setActiveTab('board');
      const card = document.querySelector(`.msg-card[data-seq="${seq}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlight');
        setTimeout(() => card.classList.remove('highlight'), 1800);
      }
      return;
    }

    const insMention = ev.target.closest('[data-insert-mention]');
    if (insMention) {
      const inp = $('#composer-text');
      const tok = insMention.dataset.insertMention;
      inp.value = inp.value ? `${inp.value.trimEnd()} ${tok} ` : `${tok} `;
      inp.focus();
      return;
    }

    const mentionMember = ev.target.closest('[data-mention-member]');
    if (mentionMember) {
      setActiveTab('board');
      const inp = $('#composer-text');
      inp.value = `@${mentionMember.dataset.mentionMember} `;
      inp.focus();
      return;
    }

    const killBtn = ev.target.closest('[data-kill-member]');
    if (killBtn) {
      const name = killBtn.dataset.killMember;
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/members/${encodeURIComponent(name)}?force=true`, {
        method: 'DELETE'
      });
      await refreshCurrentSwarm();
      return;
    }

    const mergeMrBtn = ev.target.closest('[data-merge-mr]');
    if (mergeMrBtn) {
      const iid = mergeMrBtn.dataset.mergeMr;
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/mrs/${iid}/merge`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await refreshCurrentSwarm();
      return;
    }
  });

  // Composer submit
  const sendComposer = async () => {
    const text = $('#composer-text').value.trim();
    if (!text || !state.currentSwarmId) return;
    await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        author: 'coordinator',
        text,
        channel: $('#composer-channel').value || 'main'
      })
    });
    $('#composer-text').value = '';
    await refreshCurrentSwarm();
  };
  $('#composer-send').addEventListener('click', sendComposer);
  $('#composer-text').addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') sendComposer();
  });

  // Graph controls
  $('#graph-slider').addEventListener('input', async (ev) => {
    state.graph.upToSeq = Number(ev.target.value);
    await renderGraphView();
  });
  $('#graph-first-btn').addEventListener('click', async () => {
    state.graph.upToSeq = state.messages.length ? 1 : 0;
    await renderGraphView();
  });
  $('#graph-prev-btn').addEventListener('click', async () => {
    state.graph.upToSeq = Math.max(1, (state.graph.upToSeq || 1) - 1);
    await renderGraphView();
  });
  $('#graph-next-btn').addEventListener('click', async () => {
    state.graph.upToSeq = Math.min(state.messages.length, (state.graph.upToSeq || 0) + 1);
    await renderGraphView();
  });
  $('#graph-play-btn').addEventListener('click', toggleGraphPlay);
  $('#graph-live-btn').addEventListener('click', async () => {
    state.graph.upToSeq = state.messages.length;
    await renderGraphView();
  });
  $('#graph-hide-inactive').addEventListener('change', async (ev) => {
    state.graph.hideInactive = ev.target.checked;
    await renderGraphView();
  });
  $('#graph-expand-all').addEventListener('change', async (ev) => {
    state.graph.expandAll = ev.target.checked;
    await renderGraphView();
  });
  $('#graph-speed').addEventListener('change', (ev) => {
    state.graph.speed = Number(ev.target.value) || 1;
  });

  // Modals
  $('#btn-add-member').addEventListener('click', () => $('#modal-member').classList.add('open'));
  $('#btn-close-member').addEventListener('click', () => $('#modal-member').classList.remove('open'));
  $('#form-add-member').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ownsRaw = $('#m-owns').value.trim();
    const forbidRaw = $('#m-forbid').value.trim();
    await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/members`, {
      method: 'POST',
      body: JSON.stringify({
        name: $('#m-name').value.trim(),
        role: $('#m-role').value,
        driver: $('#m-driver').value,
        model: $('#m-model').value.trim() || 'default',
        workspace: $('#m-workspace').value,
        owns: ownsRaw ? ownsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
        mustNotTouch: forbidRaw ? forbidRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
        brief: $('#m-brief').value.trim()
      })
    });
    $('#modal-member').classList.remove('open');
    $('#form-add-member').reset();
    await refreshCurrentSwarm();
  });

  $('#btn-new-swarm').addEventListener('click', () => $('#modal-swarm').classList.add('open'));
  $('#btn-close-swarm').addEventListener('click', () => $('#modal-swarm').classList.remove('open'));
  $('#form-new-swarm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const created = await api('/api/swarms', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#s-title').value.trim(),
        templateId: $('#s-template').value || null
      })
    });
    state.currentSwarmId = created.id;
    $('#modal-swarm').classList.remove('open');
    $('#form-new-swarm').reset();
    await refreshAll();
  });
}

async function boot() {
  applyStaticLabels();
  bindEvents();
  await refreshAll();
  connectSse();
  window.__YUNYU_READY = true;
}

boot().catch((err) => {
  console.error('[Yunyu UI] Boot failed:', err);
});
