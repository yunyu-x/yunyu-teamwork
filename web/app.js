import { renderCollaborationGraph } from './graph.js';
import { I18N, t } from './i18n.js';
import { $, api, escapeHtml, formatTime, showToast, state } from './lib/state.js';
import { renderBoard, renderMessageCard } from './views/board.js';
import { renderContract } from './views/contract.js';
import { loadIssueNotes, renderGitLab } from './views/gitlab.js';
import { closeIssueDrawer, openIssueDrawer, renderIssueDrawer, renderKanban } from './views/kanban.js';
import { renderKnowledge } from './views/knowledge.js';
import {
  renderAgentLogs,
  renderMemberModalHelpers,
  renderMembers,
  syncMemberModalDynamicFields
} from './views/members.js';
import { renderWorldWikiView } from './world-wiki.js';

function applyStaticLabels() {
  const L = state.lang;
  $('#brand-name').textContent = t(L, 'brandName');
  $('#lang-toggle').textContent = L === 'zh-CN' ? 'EN' : '中文';
  $('#btn-new-swarm').textContent = t(L, 'newSwarmBtn');
  $('#btn-add-member').textContent = t(L, 'addMemberBtn');
  $('#tab-label-board').textContent = t(L, 'tabBoard');
  $('#tab-label-kanban').textContent = t(L, 'tabKanban');
  if ($('#tab-label-knowledge')) $('#tab-label-knowledge').textContent = t(L, 'tabKnowledge');
  if ($('#tab-label-world')) $('#tab-label-world').textContent = t(L, 'tabWorld');
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
  $('#agent-logs-title').textContent = t(L, 'agentLogsTitle');
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
  $('#count-kanban').textContent = String(state.tasks.length);
  if ($('#count-knowledge')) $('#count-knowledge').textContent = String(s?.knowledgeCount ?? state.knowledge.length);
  if ($('#count-wiki')) $('#count-wiki').textContent = String(s?.wikiCount ?? state.wikiPages.length);
  $('#count-members').textContent = String((s?.members || []).filter((m) => !m.killed).length);
  $('#count-gitlab').textContent = state.gitlab?.connected
    ? String((state.gitlab.issues?.length || 0) + (state.gitlab.mergeRequests?.length || 0))
    : '0';
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

function renderWorldWiki() {
  renderWorldWikiView({ state, container: $('#world-view-body') });
  $('#wiki-search-input')?.addEventListener('input', (ev) => {
    state.wikiFilters.q = ev.target.value;
    renderWorldWiki();
    const inp = $('#wiki-search-input');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });
  $('#form-world-impact')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const raw = $('#impact-target-input')?.value.trim();
      if (!raw || !state.currentSwarmId) return;
      state.impactQuery = raw;
      const targets = raw.split(/[,\s]+/).filter(Boolean);
      state.worldImpact = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/world-model/impact`, {
        method: 'POST',
        body: JSON.stringify({ targets })
      });
      renderWorldWiki();
    } catch (err) {
      showToast(err.message);
    }
  });
  $('#form-wiki-edit')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      if (!state.currentSwarmId) return;
      const slug = $('#wiki-edit-slug')?.value.trim();
      const title = $('#wiki-edit-title')?.value.trim();
      const category = $('#wiki-edit-category')?.value || 'custom';
      const summary = $('#wiki-edit-summary')?.value.trim() || '修订 Wiki 文档';
      const content = $('#wiki-edit-content')?.value || '';
      if (!slug || !title) return;
      const saved = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/wiki`, {
        method: 'POST',
        body: JSON.stringify({ slug, title, category, summary, content, author: 'coordinator' })
      });
      state.activeWikiSlug = saved.slug;
      state.wikiEditMode = false;
      state.wikiDraft = null;
      const wikiData = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/wiki`);
      state.wikiPages = wikiData.pages || [];
      renderTopStatus();
      renderWorldWiki();
    } catch (err) {
      showToast(err.message);
    }
  });
}

async function loadWorldWikiData() {
  if (!state.currentSwarmId) return;
  const encId = encodeURIComponent(state.currentSwarmId);
  const [wmData, wikiData] = await Promise.all([
    api(`/api/swarms/${encId}/world-model`),
    api(`/api/swarms/${encId}/wiki`)
  ]);
  state.worldModel = wmData;
  state.wikiPages = wikiData.pages || [];
  if (!state.worldAudit && wmData?.lastAudit) state.worldAudit = wmData.lastAudit;
  renderTopStatus();
  if (!state.wikiEditMode) renderWorldWiki();
}

function stopGraphPlay() {
  if (!state.graph.playing) return;
  state.graph.playing = false;
  clearInterval(state.graph.timer);
  state.graph.timer = null;
  const btn = $('#graph-play-btn');
  if (btn) btn.textContent = '▶';
}

function startGraphPlayTimer() {
  clearInterval(state.graph.timer);
  const interval = Math.round(1100 / state.graph.speed);
  state.graph.timer = setInterval(async () => {
    if (state.graph.upToSeq >= state.messages.length) {
      stopGraphPlay();
      return;
    }
    state.graph.upToSeq += 1;
    await renderGraphView().catch(() => {});
  }, interval);
}

function toggleGraphPlay() {
  if (state.graph.playing) {
    stopGraphPlay();
    return;
  }
  if (state.messages.length === 0) return;
  if (state.graph.upToSeq >= state.messages.length) {
    state.graph.upToSeq = 1;
  }
  state.graph.playing = true;
  $('#graph-play-btn').textContent = '❚❚';
  startGraphPlayTimer();
}

async function refreshMetadata() {
  try {
    const [health, twinsData] = await Promise.all([api('/api/health'), api('/api/twins')]);
    state.presets = health.agentPresets || [];
    state.channelTypes = health.channelTypes || [];
    state.savedTwins = twinsData.twins || [];
    renderMemberModalHelpers();
  } catch {}
}

let _refreshInFlight = null;
let _refreshPending = false;
let _refreshSeq = 0;

function isEditingInside(containerId) {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  const box = document.getElementById(containerId);
  return Boolean(box && box.contains(active));
}

async function refreshCurrentSwarm() {
  if (!state.currentSwarmId) return;
  if (_refreshInFlight) {
    _refreshPending = true;
    return _refreshInFlight;
  }
  const mySeq = ++_refreshSeq;
  const targetSwarmId = state.currentSwarmId;

  const run = async () => {
    const encId = encodeURIComponent(targetSwarmId);
    const [swarm, msgData, glData] = await Promise.all([
      api(`/api/swarms/${encId}`),
      api(`/api/swarms/${encId}/messages?limit=300`),
      api(`/api/swarms/${encId}/gitlab/overview`)
    ]);
    if (mySeq !== _refreshSeq || targetSwarmId !== state.currentSwarmId) return;

    state.swarm = swarm;
    state.messages = msgData.messages || [];
    state.gitlab = glData;
    state.tasks = swarm.tasks || [];

    if (state.tab === 'members') {
      const [logData, twinsData] = await Promise.all([
        api(`/api/swarms/${encId}/logs?limit=120`),
        api('/api/twins')
      ]);
      state.agentLogs = logData.logs || [];
      state.savedTwins = twinsData.twins || [];
    } else if (state.tab === 'knowledge' || state.activeIssueId) {
      const kbData = await api(`/api/swarms/${encId}/knowledge`);
      state.knowledge = kbData.entries || [];
    } else if (state.tab === 'world') {
      const [wmData, wikiData] = await Promise.all([
        api(`/api/swarms/${encId}/world-model`),
        api(`/api/swarms/${encId}/wiki`)
      ]);
      state.worldModel = wmData;
      state.wikiPages = wikiData.pages || [];
      if (!state.worldAudit && wmData?.lastAudit) state.worldAudit = wmData.lastAudit;
    }

    renderTopStatus();
    renderBoard();
    if (!isEditingInside('kanban-create-form')) {
      renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
    }
    if (!isEditingInside('research-collect-form')) {
      renderKnowledge({ renderTopStatus, refreshCurrentSwarm });
    }
    if (state.tab === 'world' && !state.wikiEditMode) renderWorldWiki();
    renderMembers();
    if (!isEditingInside('gitlab-view-body')) renderGitLab({ refreshCurrentSwarm });
    if (!isEditingInside('contract-view-body')) renderContract({ refreshCurrentSwarm });
    if (state.activeIssueId && !isEditingInside('issue-drawer-body')) {
      renderIssueDrawer({ refreshCurrentSwarm });
    }
    if (state.tab === 'graph') {
      await renderGraphView();
    }
  };

  _refreshInFlight = run().finally(() => {
    _refreshInFlight = null;
    if (_refreshPending) {
      _refreshPending = false;
      refreshCurrentSwarm().catch(() => {});
    }
  });
  return _refreshInFlight;
}

async function refreshAll() {
  const { swarms } = await api('/api/swarms');
  state.swarms = swarms;
  if (!state.currentSwarmId || !swarms.some((s) => s.id === state.currentSwarmId)) {
    state.currentSwarmId = swarms[0]?.id || null;
  }
  await refreshCurrentSwarm();
}

function setActiveTab(tab) {
  if (state.tab === 'graph' && tab !== 'graph') stopGraphPlay();
  state.tab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
  $('#composer-bar').style.display = tab === 'board' ? 'block' : 'none';
  if (tab === 'graph') {
    renderGraphView().catch((err) => showToast(err.message));
  } else if (tab === 'world' && state.currentSwarmId) {
    renderWorldWiki();
    loadWorldWikiData().catch((err) => showToast(err.message));
  } else if (tab === 'knowledge' && state.currentSwarmId) {
    api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/knowledge`)
      .then((kbData) => {
        state.knowledge = kbData.entries || [];
        renderKnowledge({ renderTopStatus, refreshCurrentSwarm });
      })
      .catch((err) => showToast(err.message));
  } else if (tab === 'members' && state.currentSwarmId) {
    Promise.all([
      api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/logs?limit=120`),
      api('/api/twins')
    ])
      .then(([logData, twinsData]) => {
        state.agentLogs = logData.logs || [];
        state.savedTwins = twinsData.twins || [];
        renderMembers();
      })
      .catch((err) => showToast(err.message));
  }
}

function connectSse() {
  if (state.sse) state.sse.close();
  const qs = state.currentSwarmId ? `?swarmId=${encodeURIComponent(state.currentSwarmId)}` : '';
  const es = new EventSource(`/api/events${qs}`);
  const handleUpdate = () => refreshCurrentSwarm().catch(() => {});
  es.addEventListener('message', handleUpdate);
  es.addEventListener('status', handleUpdate);
  es.addEventListener('translation', handleUpdate);
  es.addEventListener('task', handleUpdate);
  es.addEventListener('knowledge', handleUpdate);
  es.addEventListener('wiki', handleUpdate);
  es.addEventListener('world_model', handleUpdate);
  es.addEventListener('audit', handleUpdate);
  es.addEventListener('swarm_created', () => refreshAll().catch(() => {}));
  es.addEventListener('agent_log', (ev) => {
    try {
      const parsed = JSON.parse(ev.data);
      const entry = parsed.payload || parsed;
      if (entry.swarmId && entry.swarmId !== state.currentSwarmId) return;
      state.agentLogs.push(entry);
      if (state.agentLogs.length > 200) state.agentLogs.shift();
      renderAgentLogs();
    } catch {}
  });
  state.sse = es;
}

function bindEvents() {
  $('#lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'zh-CN' ? 'en-US' : 'zh-CN';
    applyStaticLabels();
    renderTopStatus();
    renderBoard();
    renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
    renderKnowledge({ renderTopStatus, refreshCurrentSwarm });
    if (state.tab === 'world') renderWorldWiki();
    renderMembers();
    renderGitLab({ refreshCurrentSwarm });
    renderContract({ refreshCurrentSwarm });
    if (state.activeIssueId) renderIssueDrawer({ refreshCurrentSwarm });
    if (state.tab === 'graph') renderGraphView().catch(() => {});
  });

  $('#swarm-select').addEventListener('change', async (ev) => {
    stopGraphPlay();
    state.currentSwarmId = ev.target.value;
    state.graph.upToSeq = null;
    state.openIssueNotes.clear();
    state.issueNotesMap.clear();
    state.worldModel = null;
    state.wikiPages = [];
    state.activeWikiSlug = null;
    state.worldImpact = null;
    state.worldAudit = null;
    state.wikiEditMode = false;
    connectSse();
    await refreshCurrentSwarm().catch((err) => showToast(err.message));
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  $('#board-search').addEventListener('input', (ev) => {
    state.filters.search = ev.target.value;
    renderBoard();
  });

  $('#logs-member-filter')?.addEventListener('change', (ev) => {
    state.logsMemberFilter = ev.target.value;
    renderAgentLogs();
  });

  $('#btn-refresh-logs')?.addEventListener('click', async () => {
    if (!state.currentSwarmId) return;
    try {
      const data = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/logs?limit=120`);
      state.agentLogs = data.logs || [];
      renderAgentLogs();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.addEventListener('change', async (ev) => {
    try {
      const taskSel = ev.target.closest('[data-select-task-status]');
      if (taskSel) {
        const taskId = taskSel.dataset.selectTaskStatus;
        await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(taskId)}`, {
          method: 'PUT',
          body: JSON.stringify({ status: taskSel.value })
        });
        await refreshCurrentSwarm();
        return;
      }

      const critChk = ev.target.closest('[data-toggle-criterion]');
      if (critChk && state.activeIssueId) {
        const cid = critChk.dataset.toggleCriterion;
        const updated = await api(
          `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(state.activeIssueId)}/criteria/${encodeURIComponent(cid)}`,
          {
            method: 'POST',
            body: JSON.stringify({ checked: critChk.checked })
          }
        );
        const idx = state.tasks.findIndex((x) => x.id === updated.id);
        if (idx >= 0) state.tasks[idx] = updated;
        renderIssueDrawer({ refreshCurrentSwarm });
        renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#issue-drawer')?.addEventListener('click', (ev) => {
    if (ev.target === $('#issue-drawer')) closeIssueDrawer();
  });

  document.addEventListener('click', async (ev) => {
    try {
      const scopeBtn = ev.target.closest('[data-issue-scope]');
      if (scopeBtn) {
        state.issueFilters.scope = scopeBtn.dataset.issueScope;
        renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
        return;
      }

      const statusTabBtn = ev.target.closest('[data-issue-status]');
      if (statusTabBtn) {
        state.issueFilters.status = statusTabBtn.dataset.issueStatus;
        renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
        return;
      }

      const colAddBtn = ev.target.closest('[data-col-quick-add]');
      if (colAddBtn) {
        const stSel = $('#kb-status');
        const titleInp = $('#kb-title');
        if (stSel) stSel.value = colAddBtn.dataset.colQuickAdd;
        if (titleInp) titleInp.focus();
        return;
      }

      const kbCatBtn = ev.target.closest('[data-kb-cat]');
      if (kbCatBtn) {
        state.knowledgeFilters.category = kbCatBtn.dataset.kbCat;
        renderKnowledge({ renderTopStatus, refreshCurrentSwarm });
        return;
      }

      if (ev.target.closest('#btn-world-refresh') && state.currentSwarmId) {
        state.worldModel = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/world-model/refresh`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        renderWorldWiki();
        return;
      }

      if (ev.target.closest('#btn-run-audit') && state.currentSwarmId) {
        state.worldAudit = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/audit`, {
          method: 'POST',
          body: JSON.stringify({ createIssues: false })
        });
        renderWorldWiki();
        return;
      }

      if (ev.target.closest('#btn-run-audit-issues') && state.currentSwarmId) {
        state.worldAudit = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/audit`, {
          method: 'POST',
          body: JSON.stringify({ createIssues: true })
        });
        await refreshCurrentSwarm();
        renderWorldWiki();
        return;
      }

      const pickImpactBtn = ev.target.closest('[data-pick-impact-file]');
      if (pickImpactBtn && state.currentSwarmId) {
        const targetFile = pickImpactBtn.dataset.pickImpactFile;
        state.impactQuery = targetFile;
        state.worldImpact = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/world-model/impact`, {
          method: 'POST',
          body: JSON.stringify({ targets: [targetFile] })
        });
        renderWorldWiki();
        return;
      }

      const wikiNavBtn = ev.target.closest('[data-select-wiki-slug]');
      if (wikiNavBtn) {
        state.activeWikiSlug = wikiNavBtn.dataset.selectWikiSlug;
        state.wikiEditMode = false;
        state.wikiDraft = null;
        renderWorldWiki();
        return;
      }

      if (ev.target.closest('#btn-wiki-generate') && state.currentSwarmId) {
        const res = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/wiki/generate`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        state.wikiPages = res.pages || [];
        state.wikiEditMode = false;
        renderTopStatus();
        renderWorldWiki();
        return;
      }

      if (ev.target.closest('#btn-wiki-new')) {
        state.wikiEditMode = true;
        state.wikiDraft = {
          isNew: true,
          slug: '',
          title: '',
          category: 'decision',
          summary: '新建项目档案页',
          content: '# 专题标题\n\n## 背景与目标\n\n## 核心结论\n- '
        };
        renderWorldWiki();
        return;
      }

      if (ev.target.closest('#btn-wiki-edit-current')) {
        const curr = (state.wikiPages || []).find((p) => p.slug === state.activeWikiSlug);
        if (curr) {
          state.wikiEditMode = true;
          state.wikiDraft = {
            isNew: false,
            slug: curr.slug,
            title: curr.title,
            category: curr.category,
            summary: '',
            content: curr.content
          };
          renderWorldWiki();
        }
        return;
      }

      if (ev.target.closest('#btn-wiki-cancel-edit')) {
        state.wikiEditMode = false;
        state.wikiDraft = null;
        renderWorldWiki();
        return;
      }

      const drawerActionBtn = ev.target.closest('[data-drawer-action]');
      if (drawerActionBtn) {
        const action = drawerActionBtn.dataset.drawerAction;
        const taskId = drawerActionBtn.dataset.taskId;
        const encSw = encodeURIComponent(state.currentSwarmId);
        const encTk = encodeURIComponent(taskId);
        if (action === 'approve-spec') {
          await api(`/api/swarms/${encSw}/tasks/${encTk}/approve-spec`, {
            method: 'POST',
            body: JSON.stringify({ spec: $('#drawer-spec-input')?.value, postToBoard: true })
          });
        } else if (action === 'start') {
          await api(`/api/swarms/${encSw}/tasks/${encTk}/start`, {
            method: 'POST',
            body: JSON.stringify({ dispatchBoard: true })
          });
        } else if (action === 'accept') {
          await api(`/api/swarms/${encSw}/tasks/${encTk}/accept`, {
            method: 'POST',
            body: JSON.stringify({ reviewer: 'coordinator', summary: '验收清单核对通过', postToBoard: true })
          });
        } else if (action === 'claim') {
          await api(`/api/swarms/${encSw}/tasks/${encTk}/claim`, {
            method: 'POST',
            body: JSON.stringify({ member: 'coordinator' })
          });
        } else if (action === 'release') {
          await api(`/api/swarms/${encSw}/tasks/${encTk}/release`, {
            method: 'POST',
            body: JSON.stringify({})
          });
        } else if (action === 'research') {
          const tk = state.tasks.find((x) => x.id === taskId);
          await api(`/api/swarms/${encSw}/research`, {
            method: 'POST',
            body: JSON.stringify({ topic: tk?.title || 'Issue 技术调研', linkedIssueId: taskId, postToBoard: true })
          });
          const kbData = await api(`/api/swarms/${encSw}/knowledge`);
          state.knowledge = kbData.entries || [];
        }
        await refreshCurrentSwarm();
        renderIssueDrawer({ refreshCurrentSwarm });
        return;
      }

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
        if (state.tab === 'graph') renderGraphView().catch(() => {});
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

      const moveTaskBtn = ev.target.closest('[data-move-task]');
      if (moveTaskBtn) {
        await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(moveTaskBtn.dataset.moveTask)}`, {
          method: 'PUT',
          body: JSON.stringify({ status: moveTaskBtn.dataset.moveTo })
        });
        await refreshCurrentSwarm();
        return;
      }

      const openIssueBtn = ev.target.closest('[data-open-issue-btn]');
      if (openIssueBtn) {
        await openIssueDrawer(openIssueBtn.dataset.openIssueBtn, { refreshCurrentSwarm });
        return;
      }

      const openIssueCard = ev.target.closest('[data-open-issue]');
      if (openIssueCard && !ev.target.closest('[data-stop-card-open]')) {
        await openIssueDrawer(openIssueCard.dataset.openIssue, { refreshCurrentSwarm });
        return;
      }

      const toggleNotesBtn = ev.target.closest('[data-toggle-issue-notes]');
      if (toggleNotesBtn) {
        const iid = Number(toggleNotesBtn.dataset.toggleIssueNotes);
        if (state.openIssueNotes.has(iid)) {
          state.openIssueNotes.delete(iid);
          renderGitLab({ refreshCurrentSwarm });
        } else {
          state.openIssueNotes.add(iid);
          await loadIssueNotes(iid);
          renderGitLab({ refreshCurrentSwarm });
        }
        return;
      }

      const presetBtn = ev.target.closest('[data-apply-preset]');
      if (presetBtn) {
        const preset = state.presets.find((p) => p.id === presetBtn.dataset.applyPreset);
        if (preset) {
          $('#m-name').value = preset.nameSuggestion || '';
          $('#m-role').value = preset.role;
          $('#m-driver').value = preset.driver;
          $('#m-workspace').value = preset.workspace || 'inherit';
          $('#m-owns').value = (preset.owns || []).join(', ');
          $('#m-forbid').value = (preset.mustNotTouch || []).join(', ');
          $('#m-brief').value = preset.brief || '';
          document.querySelectorAll('.preset-chip').forEach((c) => c.classList.toggle('active', c === presetBtn));
          syncMemberModalDynamicFields();
        }
        return;
      }

      const attachTwinBtn = ev.target.closest('[data-attach-twin]');
      if (attachTwinBtn) {
        await api(
          `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/twins/${encodeURIComponent(attachTwinBtn.dataset.attachTwin)}/attach`,
          { method: 'POST', body: JSON.stringify({}) }
        );
        await refreshCurrentSwarm();
        return;
      }

      const focusLogsBtn = ev.target.closest('[data-focus-logs]');
      if (focusLogsBtn) {
        state.logsMemberFilter = focusLogsBtn.dataset.focusLogs;
        renderAgentLogs();
        $('#agent-logs-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const resetSessBtn = ev.target.closest('[data-reset-session]');
      if (resetSessBtn) {
        await api(
          `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/members/${encodeURIComponent(resetSessBtn.dataset.resetSession)}/session/reset`,
          { method: 'POST', body: JSON.stringify({}) }
        );
        await refreshCurrentSwarm();
        return;
      }

      const testImBtn = ev.target.closest('[data-test-im]');
      if (testImBtn) {
        try {
          await api(
            `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/members/${encodeURIComponent(testImBtn.dataset.testIm)}/channel/test`,
            { method: 'POST', body: JSON.stringify({}) }
          );
          testImBtn.textContent = '✓ 已推送测试';
        } catch (err) {
          testImBtn.textContent = `✕ ${err.message.slice(0, 20)}`;
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
        await api(
          `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/members/${encodeURIComponent(killBtn.dataset.killMember)}?force=true`,
          { method: 'DELETE' }
        );
        await refreshCurrentSwarm();
        return;
      }

      const mergeMrBtn = ev.target.closest('[data-merge-mr]');
      if (mergeMrBtn) {
        await api(
          `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/gitlab/mrs/${encodeURIComponent(mergeMrBtn.dataset.mergeMr)}/merge`,
          { method: 'POST', body: JSON.stringify({}) }
        );
        await refreshCurrentSwarm();
      }
    } catch (err) {
      showToast(err.message);
    }
  });

  const sendComposer = async () => {
    try {
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
    } catch (err) {
      showToast(err.message);
    }
  };
  $('#composer-send').addEventListener('click', sendComposer);
  $('#composer-text').addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') sendComposer();
  });

  $('#graph-slider').addEventListener('input', (ev) => {
    state.graph.upToSeq = Number(ev.target.value);
    renderGraphView().catch(() => {});
  });
  $('#graph-first-btn').addEventListener('click', () => {
    state.graph.upToSeq = state.messages.length ? 1 : 0;
    renderGraphView().catch(() => {});
  });
  $('#graph-prev-btn').addEventListener('click', () => {
    state.graph.upToSeq = Math.max(1, (state.graph.upToSeq || 1) - 1);
    renderGraphView().catch(() => {});
  });
  $('#graph-next-btn').addEventListener('click', () => {
    state.graph.upToSeq = Math.min(state.messages.length, (state.graph.upToSeq || 0) + 1);
    renderGraphView().catch(() => {});
  });
  $('#graph-play-btn').addEventListener('click', toggleGraphPlay);
  $('#graph-live-btn').addEventListener('click', () => {
    state.graph.upToSeq = state.messages.length;
    renderGraphView().catch(() => {});
  });
  $('#graph-hide-inactive').addEventListener('change', (ev) => {
    state.graph.hideInactive = ev.target.checked;
    renderGraphView().catch(() => {});
  });
  $('#graph-expand-all').addEventListener('change', (ev) => {
    state.graph.expandAll = ev.target.checked;
    renderGraphView().catch(() => {});
  });
  $('#graph-speed').addEventListener('change', (ev) => {
    state.graph.speed = Number(ev.target.value) || 1;
    if (state.graph.playing) startGraphPlayTimer();
  });

  $('#m-role').addEventListener('change', () => {
    if ($('#m-role').value === 'digital_twin') $('#m-driver').value = 'digital-twin';
    syncMemberModalDynamicFields();
  });
  $('#m-driver').addEventListener('change', syncMemberModalDynamicFields);
  $('#twin-im-type').addEventListener('change', syncMemberModalDynamicFields);
  $('#m-name').addEventListener('input', syncMemberModalDynamicFields);

  $('#btn-add-member').addEventListener('click', () => {
    renderMemberModalHelpers();
    $('#modal-member').classList.add('open');
  });
  $('#btn-close-member').addEventListener('click', () => $('#modal-member').classList.remove('open'));
  $('#form-add-member').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const ownsRaw = $('#m-owns').value.trim();
      const forbidRaw = $('#m-forbid').value.trim();
      const role = $('#m-role').value;
      const driver = $('#m-driver').value;
      const driverConfig = {};

      if (driver === 'cli-agent') {
        driverConfig.preset = $('#m-cli-preset').value || 'claude-code';
      }

      if (role === 'digital_twin' || driver === 'digital-twin') {
        driverConfig.ownerName = $('#twin-owner').value.trim() || $('#m-name').value.trim();
        driverConfig.autonomyMode = $('#twin-autonomy').value || 'hybrid';
        driverConfig.backendDriver = $('#twin-backend').value || 'builtin';
        driverConfig.persona = $('#twin-persona').value.trim();
        driverConfig.knowledge = $('#twin-knowledge').value.trim();
        const kwRaw = $('#twin-keywords').value.trim();
        if (kwRaw) {
          driverConfig.escalationKeywords = kwRaw.split(/[,，]+/).map((s) => s.trim()).filter(Boolean);
        }
        const imType = $('#twin-im-type').value;
        if (imType) {
          const ch = { type: imType, enabled: true };
          document.querySelectorAll('[data-im-field]').forEach((inp) => {
            const val = inp.value.trim();
            if (val) ch[inp.dataset.imField] = val;
          });
          driverConfig.channel = ch;
        }
      }

      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/members`, {
        method: 'POST',
        body: JSON.stringify({
          name: $('#m-name').value.trim(),
          role,
          driver,
          model: $('#m-model').value.trim() || 'default',
          workspace: $('#m-workspace').value,
          owns: ownsRaw ? ownsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
          mustNotTouch: forbidRaw ? forbidRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
          brief: $('#m-brief').value.trim(),
          driverConfig,
          saveAsTwin: Boolean((role === 'digital_twin' || driver === 'digital-twin') && $('#twin-save-library')?.checked)
        })
      });
      $('#modal-member').classList.remove('open');
      $('#form-add-member').reset();
      syncMemberModalDynamicFields();
      await refreshCurrentSwarm();
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#btn-new-swarm').addEventListener('click', () => $('#modal-swarm').classList.add('open'));
  $('#btn-close-swarm').addEventListener('click', () => $('#modal-swarm').classList.remove('open'));
  $('#form-new-swarm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
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
      connectSse();
      await refreshAll();
    } catch (err) {
      showToast(err.message);
    }
  });
}

async function boot() {
  applyStaticLabels();
  bindEvents();
  await refreshMetadata();
  await refreshAll();
  connectSse();
  window.__YUNYU_READY = true;
}

boot().catch((err) => {
  console.error('[Yunyu UI] Boot failed:', err);
  showToast(err.message || '界面初始化失败');
});
