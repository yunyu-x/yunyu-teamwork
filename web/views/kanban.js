import { I18N, t } from '../i18n.js';
import { $, KANBAN_ORDER, api, escapeHtml, showToast, state } from '../lib/state.js';

export function formatUnifiedDiff(diffText) {
  const raw = String(diffText || '').trim();
  if (!raw) return '<span class="diff-ctx">当前分支暂无相对主干的文件差异</span>';
  return raw
    .split(/\r?\n/)
    .slice(0, 260)
    .map((line) => {
      const esc = escapeHtml(line);
      if (line.startsWith('@@')) return `<span class="diff-hunk">${esc}</span>`;
      if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="diff-add">${esc}</span>`;
      if (line.startsWith('-') && !line.startsWith('---')) return `<span class="diff-del">${esc}</span>`;
      return `<span class="diff-ctx">${esc}</span>`;
    })
    .join('');
}

function getFilteredIssues() {
  const f = state.issueFilters;
  let list = [...state.tasks];
  if (f.scope === 'mine') {
    list = list.filter((tk) => tk.reporter === 'coordinator' || tk.assignee === 'coordinator' || tk.reviewer === 'coordinator');
  }
  if (f.status !== 'all') {
    list = list.filter((tk) => tk.status === f.status);
  }
  if (f.readyOnly) {
    list = list.filter((tk) => tk.isReady);
  }
  const q = f.search.trim().toLowerCase();
  if (q) {
    list = list.filter((tk) =>
      `${tk.issueKey || ''} ${tk.title} ${tk.description || ''} ${tk.spec || ''} ${tk.assignee || ''} ${(tk.labels || []).join(' ')}`
        .toLowerCase()
        .includes(q)
    );
  }
  const prioRank = { P0: 0, P1: 1, P2: 2 };
  if (f.sortBy === 'updated') {
    list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } else if (f.sortBy === 'key') {
    const num = (k) => Number(String(k || '').replace(/^ISS-/, '')) || 0;
    list.sort((a, b) => num(a.issueKey) - num(b.issueKey));
  } else {
    list.sort((a, b) => (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9));
  }
  return list;
}

export function renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers }) {
  const el = $('#kanban-view-body');
  if (!el) return;
  const colLabels = I18N[state.lang].kanbanColumns;
  const activeMembers = (state.swarm?.members || []).filter((m) => !m.killed && m.role !== 'monitor');
  const filteredTasks = getFilteredIssues();
  const visibleCols = state.issueFilters.status === 'all' ? KANBAN_ORDER : [state.issueFilters.status];

  const countByCol = (colKey) => state.tasks.filter((tk) => tk.status === colKey).length;

  el.innerHTML = `
    <div class="section-stack">
      <div class="panel-card" style="padding:12px 14px;">
        <div class="qoder-bar">
          <div class="qoder-tabs-group">
            <button type="button" class="pill ${state.issueFilters.scope === 'all' ? 'active' : ''}" data-issue-scope="all">${escapeHtml(t(state.lang, 'issueScopeAll'))} (${state.tasks.length})</button>
            <button type="button" class="pill ${state.issueFilters.scope === 'mine' ? 'active' : ''}" data-issue-scope="mine">${escapeHtml(t(state.lang, 'issueScopeMine'))}</button>
            <span class="qoder-divider"></span>
            <button type="button" class="pill ${state.issueFilters.status === 'all' ? 'active' : ''}" data-issue-status="all">全部状态</button>
            ${KANBAN_ORDER.map(
              (colKey) => `<button type="button" class="pill ${state.issueFilters.status === colKey ? 'active' : ''}" data-issue-status="${colKey}">${escapeHtml(colLabels[colKey])} ${countByCol(colKey)}</button>`
            ).join('')}
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <input type="search" id="issue-search" class="composer-input" style="width:170px;padding:5px 9px;font-size:12px;" value="${escapeHtml(state.issueFilters.search)}" placeholder="搜索 Issue / ISS-..." />
            <select id="issue-sort" class="composer-select" style="padding:5px 7px;font-size:12px;" aria-label="排序方式">
              <option value="priority" ${state.issueFilters.sortBy === 'priority' ? 'selected' : ''}>按优先级</option>
              <option value="key" ${state.issueFilters.sortBy === 'key' ? 'selected' : ''}>按编号</option>
              <option value="updated" ${state.issueFilters.sortBy === 'updated' ? 'selected' : ''}>按最新更新</option>
            </select>
            <label class="graph-toggle" style="font-size:12px;">
              <input type="checkbox" id="issue-ready-only" ${state.issueFilters.readyOnly ? 'checked' : ''} />
              <span>仅看就绪(Ready)</span>
            </label>
            <button type="button" class="btn small" id="btn-issue-invite">${escapeHtml(t(state.lang, 'issueInviteBtn'))}</button>
          </div>
        </div>

        <form id="kanban-create-form" class="inline-form" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
          <input id="kb-title" type="text" placeholder="${escapeHtml(t(state.lang, 'kanbanTitlePlaceholder'))}" style="flex:1 1 220px" required />
          <select id="kb-assignee">
            <option value="">未指派</option>
            ${activeMembers.map((m) => `<option value="${escapeHtml(m.name)}">@${escapeHtml(m.name)}</option>`).join('')}
          </select>
          <select id="kb-priority">
            <option value="P0">P0</option>
            <option value="P1" selected>P1</option>
            <option value="P2">P2</option>
          </select>
          <select id="kb-status">
            ${KANBAN_ORDER.map((st) => `<option value="${st}">${escapeHtml(colLabels[st])}</option>`).join('')}
          </select>
          <label class="graph-toggle" style="font-size:12px;">
            <input type="checkbox" id="kb-notify" />
            <span>唤醒负责人</span>
          </label>
          <button type="submit" class="btn primary">${escapeHtml(t(state.lang, 'kanbanNewTask'))}</button>
        </form>
      </div>

      <div class="kanban-grid" ${visibleCols.length === 1 ? 'style="grid-template-columns:1fr;"' : ''}>
        ${visibleCols
          .map((colKey) => {
            const cards = filteredTasks.filter((tk) => tk.status === colKey);
            return `
            <div class="kanban-col" data-col="${colKey}">
              <div class="kanban-col-head">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                  <span>${escapeHtml(colLabels[colKey])}</span>
                  <span class="badge">${cards.length}</span>
                </span>
                <button type="button" class="kanban-col-add" data-col-quick-add="${colKey}" title="在「${escapeHtml(colLabels[colKey])}」新建 Issue">+</button>
              </div>
              ${
                cards.length
                  ? cards
                      .map((tk) => {
                        const idx = KANBAN_ORDER.indexOf(tk.status);
                        const prevStatus = idx > 0 ? KANBAN_ORDER[idx - 1] : null;
                        const nextStatus = idx < KANBAN_ORDER.length - 1 ? KANBAN_ORDER[idx + 1] : null;
                        const acTotal = tk.acceptanceCriteria?.length || 0;
                        const acDone = (tk.acceptanceCriteria || []).filter((c) => c.checked).length;
                        return `
                          <div class="kanban-card ${tk.blocked || tk.blockedByDeps ? 'is-blocked' : ''}" data-task-id="${escapeHtml(tk.id)}" data-open-issue="${escapeHtml(tk.id)}">
                            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                              <span class="issue-key">${escapeHtml(tk.issueKey || tk.id)}</span>
                              <span class="badge priority-${escapeHtml(tk.priority || 'P1')}">${escapeHtml(tk.priority || 'P1')}</span>
                            </div>
                            <div class="kanban-card-title">${escapeHtml(tk.title)}</div>
                            ${tk.description ? `<div class="kanban-card-desc">${escapeHtml(tk.description.slice(0, 95))}</div>` : ''}
                            <div class="label-list">
                              ${tk.assignee ? `<span class="badge">@${escapeHtml(tk.assignee)}</span>` : ''}
                              ${tk.specStatus === 'approved' ? `<span class="badge deliverable">Spec冻结</span>` : ''}
                              ${tk.isReady ? `<span class="badge brief">Ready</span>` : ''}
                              ${tk.blockedByDeps ? `<span class="badge defect">依赖阻塞(${tk.unresolvedDeps.length})</span>` : ''}
                              ${tk.blocked ? `<span class="badge defect">返工/阻塞</span>` : ''}
                              ${tk.claimedBy ? `<span class="badge">🔒@${escapeHtml(tk.claimedBy)}</span>` : ''}
                              ${acTotal > 0 ? `<span class="badge">☑ ${acDone}/${acTotal}</span>` : ''}
                              ${tk.gitlabIssueIid ? `<span class="badge gitlab">#${escapeHtml(tk.gitlabIssueIid)}</span>` : ''}
                              ${tk.gitlabMrIid ? `<span class="badge done">!${escapeHtml(tk.gitlabMrIid)}</span>` : ''}
                              ${(tk.deliverableSeqs || [])
                                .slice(-2)
                                .map((seq) => `<span class="badge deliverable seq-link" data-jump-seq="${escapeHtml(seq)}">#${escapeHtml(seq)}</span>`)
                                .join('')}
                            </div>
                            <div class="kanban-card-actions" data-stop-card-open="true">
                              <div style="display:flex;gap:4px;">
                                ${prevStatus ? `<button type="button" class="btn small" data-move-task="${escapeHtml(tk.id)}" data-move-to="${prevStatus}" title="移至${escapeHtml(colLabels[prevStatus])}">←</button>` : ''}
                                ${nextStatus ? `<button type="button" class="btn small primary" data-move-task="${escapeHtml(tk.id)}" data-move-to="${nextStatus}" title="移至${escapeHtml(colLabels[nextStatus])}">→</button>` : ''}
                              </div>
                              <button type="button" class="btn small" data-open-issue-btn="${escapeHtml(tk.id)}">Spec / 验收</button>
                            </div>
                          </div>`;
                      })
                      .join('')
                  : `<div class="empty-state" style="padding:14px 6px;font-size:12px;">${escapeHtml(t(state.lang, 'kanbanEmptyCol'))}</div>`
              }
            </div>`;
          })
          .join('')}
      </div>
    </div>`;

  const kbForm = $('#kanban-create-form');
  if (kbForm) {
    kbForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const title = $('#kb-title').value.trim();
        if (!title || !state.currentSwarmId) return;
        const created = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks`, {
          method: 'POST',
          body: JSON.stringify({
            title,
            assignee: $('#kb-assignee').value || null,
            priority: $('#kb-priority').value || 'P1',
            status: $('#kb-status').value || 'backlog',
            gitlabIssueIid: state.swarm?.gitlab?.linkedIssueIid || null,
            notifyAssignee: $('#kb-notify').checked
          })
        });
        if (created?.id && !state.tasks.some((x) => x.id === created.id)) {
          state.tasks.push(created);
          renderTopStatus();
          renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
        }
        await refreshCurrentSwarm();
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  $('#issue-search')?.addEventListener('input', (ev) => {
    state.issueFilters.search = ev.target.value;
    renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
    const inp = $('#issue-search');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });
  $('#issue-sort')?.addEventListener('change', (ev) => {
    state.issueFilters.sortBy = ev.target.value;
    renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
  });
  $('#issue-ready-only')?.addEventListener('change', (ev) => {
    state.issueFilters.readyOnly = ev.target.checked;
    renderKanban({ renderTopStatus, refreshCurrentSwarm, renderMemberModalHelpers });
  });
  $('#btn-issue-invite')?.addEventListener('click', () => {
    renderMemberModalHelpers();
    $('#modal-member').classList.add('open');
  });
}

export function closeIssueDrawer() {
  state.activeIssueId = null;
  state.activeIssueDiff = null;
  $('#issue-drawer')?.classList.remove('open');
}

export async function openIssueDrawer(taskId, { refreshCurrentSwarm }) {
  state.activeIssueId = taskId;
  state.activeIssueDiff = null;
  $('#issue-drawer')?.classList.add('open');
  renderIssueDrawer({ refreshCurrentSwarm });

  const tk = state.tasks.find((x) => x.id === taskId);
  if (tk?.assignee && state.currentSwarmId) {
    try {
      const diffData = await api(
        `/api/swarms/${encodeURIComponent(state.currentSwarmId)}/worktrees/${encodeURIComponent(tk.assignee)}/diff`
      );
      if (state.activeIssueId === taskId) {
        state.activeIssueDiff = diffData;
        renderIssueDrawer({ refreshCurrentSwarm });
      }
    } catch {
      state.activeIssueDiff = { diff: '', status: null, commits: [] };
      if (state.activeIssueId === taskId) renderIssueDrawer({ refreshCurrentSwarm });
    }
  }
}

export function renderIssueDrawer({ refreshCurrentSwarm }) {
  const wrap = $('#issue-drawer-body');
  if (!wrap || !state.activeIssueId) return;
  const tk = state.tasks.find((x) => x.id === state.activeIssueId);
  if (!tk) {
    closeIssueDrawer();
    return;
  }

  const colLabels = I18N[state.lang].kanbanColumns;
  const activeMembers = (state.swarm?.members || []).filter((m) => !m.killed && m.role !== 'monitor');
  const depItems = (tk.dependsOn || []).map((depId) => {
    const d = state.tasks.find((x) => x.id === depId);
    return d
      ? `<span class="badge ${d.status === 'done' ? 'done' : 'defect'}">${escapeHtml(d.issueKey || d.id)} (${escapeHtml(colLabels[d.status] || d.status)})</span>`
      : `<span class="badge">${escapeHtml(depId)}</span>`;
  });

  const linkedKbs = (tk.linkedKnowledgeIds || [])
    .map((kid) => state.knowledge.find((k) => k.id === kid))
    .filter(Boolean);

  wrap.innerHTML = `
    <div class="drawer-head">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
          <span class="badge brief">${escapeHtml(tk.issueKey || tk.id)}</span>
          <span class="badge priority-${escapeHtml(tk.priority)}">${escapeHtml(tk.priority)}</span>
          <span class="badge">${escapeHtml(colLabels[tk.status] || tk.status)}</span>
          ${tk.specStatus === 'approved' ? '<span class="badge deliverable">Spec 已冻结</span>' : '<span class="badge">Spec 草稿</span>'}
          ${tk.claimedBy ? `<span class="badge">🔒 已认领 @${escapeHtml(tk.claimedBy)}</span>` : ''}
        </div>
        <h3 style="margin:0;font-size:16px;color:#fff;">${escapeHtml(tk.title)}</h3>
      </div>
      <button type="button" class="btn small" id="btn-close-drawer">✕ 关闭</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="btn small" data-drawer-action="research" data-task-id="${escapeHtml(tk.id)}">🔍 派发情报调研</button>
      <button type="button" class="btn small primary" data-drawer-action="approve-spec" data-task-id="${escapeHtml(tk.id)}">📋 批准 Spec → 待开始</button>
      <button type="button" class="btn small primary" data-drawer-action="start" data-task-id="${escapeHtml(tk.id)}">▶ 启动 Agent 执行</button>
      <button type="button" class="btn small" style="border-color:rgba(52,211,153,0.5);color:var(--green);" data-drawer-action="accept" data-task-id="${escapeHtml(tk.id)}">✓ 验收通过</button>
      ${
        tk.claimedBy
          ? `<button type="button" class="btn small" data-drawer-action="release" data-task-id="${escapeHtml(tk.id)}">🔓 释放认领锁</button>`
          : `<button type="button" class="btn small" data-drawer-action="claim" data-task-id="${escapeHtml(tk.id)}">🔒 认领租约</button>`
      }
    </div>

    <form id="drawer-reject-form" class="inline-form">
      <input id="drawer-reject-reason" type="text" placeholder="若需打回返工，输入具体修改意见（将自动 @负责人 并切回进行中）..." style="flex:1 1 220px" />
      <button type="submit" class="btn small danger">✕ 打回返工</button>
    </form>

    <div class="panel-card" style="padding:10px 12px;">
      <div class="kv-list">
        <div class="kv-row">
          <span>状态 / 负责人</span>
          <div style="display:flex;gap:6px;">
            <select id="drawer-status-sel" class="composer-select" style="padding:3px 6px;font-size:12px;">
              ${KANBAN_ORDER.map((st) => `<option value="${st}" ${st === tk.status ? 'selected' : ''}>${escapeHtml(colLabels[st])}</option>`).join('')}
            </select>
            <select id="drawer-assignee-sel" class="composer-select" style="padding:3px 6px;font-size:12px;">
              <option value="">未指派</option>
              ${activeMembers.map((m) => `<option value="${escapeHtml(m.name)}" ${m.name === tk.assignee ? 'selected' : ''}>@${escapeHtml(m.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="kv-row">
          <span>前置 DAG 依赖</span>
          <div>${depItems.length ? depItems.join(' ') : '<span style="color:var(--text-dim);">无前置阻塞（可随时就绪）</span>'}</div>
        </div>
        ${
          tk.blockedReason
            ? `<div class="kv-row"><span style="color:var(--red);">阻塞 / 打回原因</span><code style="color:var(--red);">${escapeHtml(tk.blockedReason)}</code></div>`
            : ''
        }
      </div>
    </div>

    <div class="panel-card" style="padding:10px 12px;">
      <h3><span>📐 Spec 规格说明（Spec-Driven）</span><button type="button" class="btn small primary" id="btn-save-spec">保存 Spec</button></h3>
      <textarea id="drawer-spec-input" rows="5" style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:7px;padding:8px;font-family:var(--mono);font-size:12px;">${escapeHtml(tk.spec || '')}</textarea>
    </div>

    <div class="panel-card" style="padding:10px 12px;">
      <h3><span>☑ 验收标准清单（Acceptance Criteria）</span><span class="badge">${(tk.acceptanceCriteria || []).filter((c) => c.checked).length} / ${(tk.acceptanceCriteria || []).length}</span></h3>
      <div class="ac-list">
        ${
          (tk.acceptanceCriteria || []).length
            ? (tk.acceptanceCriteria || [])
                .map(
                  (c) => `
              <label class="ac-item ${c.checked ? 'checked' : ''}">
                <input type="checkbox" data-toggle-criterion="${escapeHtml(c.id)}" ${c.checked ? 'checked' : ''} />
                <span>${escapeHtml(c.text)}</span>
              </label>`
                )
                .join('')
            : '<div style="font-size:12px;color:var(--text-dim);">尚未添加验收标准条目</div>'
        }
      </div>
      <form id="drawer-add-ac-form" class="inline-form" style="margin-top:8px;">
        <input id="drawer-ac-text" type="text" placeholder="追加一条验收标准（如：单元测试 100% 绿灯）" style="flex:1 1 200px" />
        <button type="submit" class="btn small">+ 添加</button>
      </form>
    </div>

    ${
      linkedKbs.length
        ? `<div class="panel-card" style="padding:10px 12px;">
            <h3><span>📚 关联情报调研知识</span><span class="badge">${linkedKbs.length}</span></h3>
            ${linkedKbs
              .map(
                (kb) => `<div class="item-box"><div class="item-box-title">${escapeHtml(kb.title)}</div><div style="font-size:12px;color:var(--text-muted);">${escapeHtml(kb.summary)}</div></div>`
              )
              .join('')}
          </div>`
        : ''
    }

    <div class="panel-card" style="padding:10px 12px;">
      <h3>
        <span>🔀 在线分支 Git Diff 审查${tk.assignee ? `（@${escapeHtml(tk.assignee)}）` : ''}</span>
        <span class="badge">${escapeHtml(state.activeIssueDiff?.status?.branch || tk.branch || 'inherit')}</span>
      </h3>
      <div class="diff-box">${
        state.activeIssueDiff === null
          ? '<span class="diff-ctx">正在加载分支 Git Diff...</span>'
          : formatUnifiedDiff(state.activeIssueDiff.diff)
      }</div>
    </div>
  `;

  $('#btn-close-drawer')?.addEventListener('click', closeIssueDrawer);
  $('#drawer-status-sel')?.addEventListener('change', async (ev) => {
    try {
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(tk.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: ev.target.value })
      });
      await refreshCurrentSwarm();
      renderIssueDrawer({ refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });
  $('#drawer-assignee-sel')?.addEventListener('change', async (ev) => {
    try {
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(tk.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ assignee: ev.target.value || null })
      });
      await refreshCurrentSwarm();
      openIssueDrawer(tk.id, { refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });
  $('#btn-save-spec')?.addEventListener('click', async () => {
    try {
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(tk.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ spec: $('#drawer-spec-input').value })
      });
      await refreshCurrentSwarm();
      renderIssueDrawer({ refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });
  $('#drawer-add-ac-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const text = $('#drawer-ac-text').value.trim();
      if (!text) return;
      const nextList = [...(tk.acceptanceCriteria || []), { text, checked: false }];
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(tk.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ acceptanceCriteria: nextList })
      });
      await refreshCurrentSwarm();
      renderIssueDrawer({ refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });
  $('#drawer-reject-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const reason = $('#drawer-reject-reason').value.trim() || '未满足验收清单，请按规范返工修复';
      await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/tasks/${encodeURIComponent(tk.id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reviewer: 'coordinator', reason, postToBoard: true })
      });
      await refreshCurrentSwarm();
      renderIssueDrawer({ refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });
}
