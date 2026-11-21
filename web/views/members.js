import { colorForNode } from '../graph.js';
import { I18N, t } from '../i18n.js';
import { $, escapeHtml, formatTime, state } from '../lib/state.js';

export function renderSavedTwinsBar() {
  const bar = $('#saved-twins-bar');
  if (!bar) return;
  if (!state.savedTwins.length) {
    bar.innerHTML = '';
    return;
  }
  const existingNames = new Set((state.swarm?.members || []).filter((m) => !m.killed).map((m) => m.name));
  bar.innerHTML = `
    <div class="panel-card">
      <h3><span>🤖 ${escapeHtml(t(state.lang, 'savedTwinsTitle'))}</span><span class="badge">${state.savedTwins.length}</span></h3>
      <div class="preset-bar" style="margin-bottom:0;">
        ${state.savedTwins
          .map((tw) => {
            const attached = existingNames.has(tw.name);
            const imTag = tw.channel?.type ? ` · ${tw.channel.type}` : '';
            return `
              <button type="button" class="btn small ${attached ? '' : 'primary'}" data-attach-twin="${escapeHtml(tw.id)}" ${attached ? 'disabled' : ''}>
                ${attached ? '✓ 已在蜂群中' : '+ 一键挂载'} @${escapeHtml(tw.name)}（${escapeHtml(tw.ownerName)}${escapeHtml(imTag)}）
              </button>`;
          })
          .join('')}
      </div>
    </div>`;
}

export function renderAgentLogs() {
  const filterSel = $('#logs-member-filter');
  const members = (state.swarm?.members || []).filter((m) => !m.killed && m.role !== 'monitor');
  if (filterSel) {
    const cur = state.logsMemberFilter;
    filterSel.innerHTML = [
      `<option value="">全部成员</option>`,
      ...members.map((m) => `<option value="${escapeHtml(m.name)}" ${m.name === cur ? 'selected' : ''}>@${escapeHtml(m.name)}</option>`)
    ].join('');
  }

  const box = $('#agent-logs-stream');
  if (!box) return;
  const list = state.logsMemberFilter
    ? state.agentLogs.filter((l) => l.member === state.logsMemberFilter)
    : state.agentLogs;

  if (!list.length) {
    box.innerHTML = `<div class="empty-state" style="padding:12px;">等待 CLI / Agent 产生实时日志输出...</div>`;
    return;
  }

  box.innerHTML = list
    .slice(-120)
    .map(
      (l) => `
      <div class="log-line log-${escapeHtml(l.eventType || l.stream || 'log')}">
        <span style="color:var(--text-dim);flex:none;">${formatTime(l.time)}</span>
        <span style="color:var(--accent);flex:none;">[@${escapeHtml(l.member)}]</span>
        <span>${escapeHtml(l.text)}</span>
      </div>`
    )
    .join('');
  box.scrollTop = box.scrollHeight;
}

export function renderMembers() {
  renderSavedTwinsBar();
  const members = state.swarm?.members || [];
  const stateLabels = I18N[state.lang].stateLabels;
  const roleLabels = I18N[state.lang].roleLabels;

  $('#members-grid').innerHTML = members
    .map((m) => {
      const col = colorForNode(m.name, m.role);
      const cfg = m.driverConfig || {};
      const isTwin = m.role === 'digital_twin' || m.driver === 'digital-twin';
      const imType = cfg.channel?.type || null;
      const inboundUrl =
        isTwin && imType && state.currentSwarmId
          ? `${window.location.origin}/api/swarms/${encodeURIComponent(state.currentSwarmId)}/channels/inbound/${encodeURIComponent(imType)}/${encodeURIComponent(m.name)}`
          : null;

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
            <div class="kv-row"><span>接入驱动</span><code>${escapeHtml(m.driver)}${cfg.preset ? ` (${escapeHtml(cfg.preset)})` : ''}</code></div>
            <div class="kv-row"><span>模型 / 引擎</span><code>${escapeHtml(m.model || 'default')}</code></div>
            <div class="kv-row"><span>工作区模式</span><code>${escapeHtml(m.workspaceMode)}${m.branch ? ` (${escapeHtml(m.branch)})` : ''}</code></div>
            <div class="kv-row"><span>独占所有权</span><code>${escapeHtml(m.owns?.length ? m.owns.join(', ') : '—')}</code></div>
            <div class="kv-row"><span>禁止修改</span><code>${escapeHtml(m.mustNotTouch?.length ? m.mustNotTouch.join(', ') : '—')}</code></div>
            <div class="kv-row"><span>轮次 / 最新发帖</span><code>${escapeHtml(m.turns)} 轮 / #${escapeHtml(m.lastPostSeq || 0)}</code></div>
            ${m.sessionId ? `<div class="kv-row"><span>CLI 会话 ID</span><code>${escapeHtml(m.sessionId)}</code></div>` : ''}
            ${
              isTwin
                ? `<div class="kv-row"><span>归属人 / 托管</span><code>${escapeHtml(cfg.ownerName || m.name)} · ${escapeHtml(cfg.autonomyMode || 'hybrid')}</code></div>
                   <div class="kv-row"><span>绑定 IM 通道</span><code>${escapeHtml(imType || '仅站内')}</code></div>`
                : ''
            }
          </div>
          ${inboundUrl ? `<div class="inbound-url-box" style="margin-top:8px;">IM 入站回调：${escapeHtml(inboundUrl)}</div>` : ''}
          ${
            !m.killed && m.role !== 'monitor'
              ? `<div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;">
                  <button type="button" class="btn small primary" data-mention-member="${escapeHtml(m.name)}">@${escapeHtml(m.name)} 发消息</button>
                  <button type="button" class="btn small" data-focus-logs="${escapeHtml(m.name)}">查看日志</button>
                  ${m.sessionId ? `<button type="button" class="btn small" data-reset-session="${escapeHtml(m.name)}">重置会话</button>` : ''}
                  ${isTwin && imType ? `<button type="button" class="btn small" data-test-im="${escapeHtml(m.name)}">测试 IM 推送</button>` : ''}
                  <button type="button" class="btn small danger" data-kill-member="${escapeHtml(m.name)}">销毁节点</button>
                </div>`
              : ''
          }
        </div>`;
    })
    .join('');

  renderAgentLogs();
}

export function renderMemberModalHelpers() {
  const bar = $('#member-preset-bar');
  if (bar && state.presets.length) {
    bar.innerHTML = state.presets
      .map((p) => `<button type="button" class="preset-chip" data-apply-preset="${escapeHtml(p.id)}">${escapeHtml(p.label)}</button>`)
      .join('');
  }

  const imSel = $('#twin-im-type');
  if (imSel) {
    const prev = imSel.value;
    imSel.innerHTML = [
      `<option value="">暂不绑定外部 IM（仅站内）</option>`,
      ...state.channelTypes.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === prev ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    ].join('');
  }
  syncMemberModalDynamicFields();
}

export function syncMemberModalDynamicFields() {
  const role = $('#m-role')?.value;
  const driver = $('#m-driver')?.value;
  const isCli = driver === 'cli-agent';
  const isTwin = role === 'digital_twin' || driver === 'digital-twin';

  $('#cli-preset-wrap')?.classList.toggle('hidden', !isCli);
  $('#twin-fields-wrap')?.classList.toggle('hidden', !isTwin);

  const imType = $('#twin-im-type')?.value || '';
  const dynWrap = $('#twin-im-dynamic-fields');
  const previewWrap = $('#twin-inbound-preview-wrap');
  const previewEl = $('#twin-inbound-url');

  if (dynWrap) {
    const meta = state.channelTypes.find((c) => c.id === imType);
    if (!meta) {
      dynWrap.innerHTML = '';
      previewWrap?.classList.add('hidden');
    } else {
      dynWrap.innerHTML = meta.fields
        .map(
          (f) => `
        <div class="form-field">
          <label for="im-field-${escapeHtml(f.key)}">${escapeHtml(f.label)}</label>
          <input id="im-field-${escapeHtml(f.key)}" data-im-field="${escapeHtml(f.key)}" type="${f.type === 'password' ? 'password' : 'text'}" placeholder="${escapeHtml(f.placeholder || '')}" />
        </div>`
        )
        .join('');
      const nameVal = $('#m-name')?.value.trim() || 'my-twin';
      const swId = state.currentSwarmId || 'main-workspace';
      if (previewEl) {
        previewEl.textContent = `${window.location.origin}/api/swarms/${encodeURIComponent(swId)}/channels/inbound/${encodeURIComponent(imType)}/${encodeURIComponent(nameVal)}`;
      }
      previewWrap?.classList.remove('hidden');
    }
  }
}
