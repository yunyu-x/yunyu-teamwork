import { $, api, escapeHtml, formatTime, showToast, state } from '../lib/state.js';

const ALL_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PreTurn',
  'PostTurn',
  'SessionStart',
  'OnMessage',
  'PreCommit',
  'PreMerge',
  'OnIssueTransition',
  'OnAudit'
];

function renderConnectorCards(connectors, isEn) {
  if (!connectors.length) {
    return `<div class="empty-state">${isEn ? 'No connectors probed yet.' : '尚未探测到连接器信息。'}</div>`;
  }
  return `
    <div class="plugin-conn-grid">
      ${connectors
        .map((c) => {
          const isProto = c.category === 'protocol';
          const statusCls = isProto ? 'cyan' : c.installed ? 'ok' : c.detectedConfigs?.length ? 'warn' : 'muted';
          const statusText = isProto
            ? (isEn ? 'Built-in Protocol' : '协议内置')
            : c.installed
              ? (isEn ? `CLI Ready (${c.version || 'ok'})` : `CLI 就绪 (${c.version || 'ok'})`)
              : c.detectedConfigs?.length
                ? (isEn ? 'Config Found' : '检测到项目配置')
                : (isEn ? 'Not Installed' : '未安装 CLI');
          return `
            <div class="plugin-conn-card">
              <div class="plugin-conn-head">
                <div>
                  <div class="plugin-conn-name">${escapeHtml(c.name)}</div>
                  <div class="plugin-conn-sub">${escapeHtml(c.vendor || '')} · <code>${escapeHtml(c.id)}</code></div>
                </div>
                <span class="plugin-badge plugin-badge-${statusCls}">${escapeHtml(statusText)}</span>
              </div>
              <div class="plugin-conn-desc">${escapeHtml(c.description || '')}</div>
              <div class="plugin-chip-row">
                ${(c.capabilities || []).slice(0, 6).map((cap) => `<span class="plugin-chip">${escapeHtml(cap)}</span>`).join('')}
              </div>
              ${
                c.detectedConfigs?.length
                  ? `<div class="plugin-conn-foot">📁 ${escapeHtml(c.detectedConfigs.join(', '))}</div>`
                  : ''
              }
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderPluginCards(plugins, isEn) {
  if (!plugins.length) {
    return `<div class="empty-state">${isEn ? 'No plugins discovered.' : '暂未发现任何插件包。'}</div>`;
  }
  return `
    <div class="card-grid">
      ${plugins
        .map((p) => {
          const fmtLabel =
            p.format === 'teamai-repo'
              ? 'TeamAI Git Repo'
              : p.format === 'inline-plugin'
                ? (isEn ? 'Inline Custom Pack' : '自定义内联插件')
                : 'Agent Plugin Standard';
          return `
            <div class="panel-card plugin-item-card ${p.enabled ? '' : 'is-disabled'}">
              <div class="plugin-item-head">
                <div>
                  <div class="plugin-item-title">${escapeHtml(p.name)}</div>
                  <div class="plugin-conn-sub"><code>${escapeHtml(p.id)}</code> · v${escapeHtml(p.version)} · ${escapeHtml(fmtLabel)}</div>
                </div>
                <div class="plugin-badge-row">
                  <span class="plugin-badge ${p.enabled ? 'plugin-badge-ok' : 'plugin-badge-muted'}">
                    ${p.enabled ? (isEn ? 'Enabled' : '已启用') : (isEn ? 'Disabled' : '已停用')}
                  </span>
                  <span class="plugin-badge ${p.trusted ? 'plugin-badge-cyan' : 'plugin-badge-warn'}">
                    ${p.trusted ? (isEn ? 'Trusted' : '已授信') : (isEn ? 'Untrusted' : '未授信')}
                  </span>
                </div>
              </div>
              <p class="plugin-item-desc">${escapeHtml(p.description || '')}</p>
              <div class="plugin-chip-row">
                <span class="plugin-chip">Skills: ${p.counts?.skills || 0}</span>
                <span class="plugin-chip">Rules: ${p.counts?.rules || 0}</span>
                <span class="plugin-chip">Commands: ${p.counts?.commands || 0}</span>
                <span class="plugin-chip">Agents: ${p.counts?.agents || 0}</span>
                <span class="plugin-chip">Hooks: ${p.counts?.hooks || 0}</span>
                <span class="plugin-chip">MCP: ${p.counts?.mcpServers || 0}</span>
              </div>
              <div class="plugin-action-row">
                <button type="button" class="btn small" data-plugin-toggle-enabled="${escapeHtml(p.id)}" data-next-val="${p.enabled ? 'false' : 'true'}">
                  ${p.enabled ? (isEn ? 'Disable' : '停用') : (isEn ? 'Enable' : '启用')}
                </button>
                <button type="button" class="btn small" data-plugin-toggle-trusted="${escapeHtml(p.id)}" data-next-val="${p.trusted ? 'false' : 'true'}">
                  ${p.trusted ? (isEn ? 'Revoke Trust' : '取消授信') : (isEn ? 'Trust Plugin' : '授予信任')}
                </button>
                ${
                  p.sourceType === 'git'
                    ? `<button type="button" class="btn small primary" data-plugin-sync-git="${escapeHtml(p.id)}">${isEn ? 'Git Pull' : '拉取更新'}</button>`
                    : ''
                }
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderMcpClientsSection(servers, isEn) {
  const statusLabel = (st) => {
    if (isEn) return st;
    return st === 'connected' ? '已连接' : st === 'connecting' ? '连接中' : st === 'error' ? '连接异常' : '未连接';
  };
  return `
    <div class="panel-card">
      <h3>
        <span>🔌 ${isEn ? 'External MCP Client Connectors (Stdio / HTTP)' : '外部 MCP 连接器客户端（Stdio / HTTP JSON-RPC 2.0）'}</span>
        <span class="plugin-conn-sub">${servers.length} ${isEn ? 'registered' : '个已声明服务'}</span>
      </h3>
      <div class="plugin-mcp-list">
        ${
          servers.length === 0
            ? `<div class="empty-state" style="padding:12px;">${isEn ? 'No external MCP servers registered yet.' : '暂无外部 MCP Server 声明。'}</div>`
            : servers
                .map((s) => {
                  const stCls = s.status === 'connected' ? 'ok' : s.status === 'error' ? 'err' : 'muted';
                  const endpoint = s.transport === 'http' ? s.url || '-' : `${s.command || ''} ${(s.args || []).join(' ')}`.trim();
                  return `
                    <div class="plugin-mcp-row">
                      <div class="plugin-mcp-info">
                        <div class="plugin-mcp-head">
                          <strong>${escapeHtml(s.id)}</strong>
                          <span class="plugin-chip">${escapeHtml(s.transport)}</span>
                          <span class="plugin-badge plugin-badge-${stCls}">${escapeHtml(statusLabel(s.status))}</span>
                          <span class="plugin-conn-sub">plugin: ${escapeHtml(s.pluginId)}</span>
                        </div>
                        <div class="plugin-conn-sub" style="word-break:break-all;">${escapeHtml(endpoint)}</div>
                        ${s.lastError ? `<div class="plugin-err-line">⚠️ ${escapeHtml(s.lastError)}</div>` : ''}
                        ${
                          s.tools?.length
                            ? `<div class="plugin-chip-row" style="margin-top:6px;">${s.tools.map((tool) => `<span class="plugin-chip">🔧 ${escapeHtml(tool.name)}</span>`).join('')}</div>`
                            : ''
                        }
                      </div>
                      <div class="plugin-action-row">
                        <button type="button" class="btn small primary" data-mcp-connect="${escapeHtml(s.id)}">
                          ${s.status === 'connected' ? (isEn ? 'Reconnect' : '重连发现') : (isEn ? 'Connect' : '连接发现')}
                        </button>
                        ${
                          s.status === 'connected'
                            ? `<button type="button" class="btn small" data-mcp-disconnect="${escapeHtml(s.id)}">${isEn ? 'Disconnect' : '断开'}</button>`
                            : ''
                        }
                      </div>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
      <form id="form-mcp-register" class="plugin-inline-form">
        <input id="mcp-reg-id" class="search-input" placeholder="${isEn ? 'MCP server id (e.g. local-yunyu)' : '自定义 MCP 服务 ID（如 local-yunyu）'}" required />
        <input id="mcp-reg-url" class="search-input" placeholder="${isEn ? 'HTTP JSON-RPC URL (e.g. http://127.0.0.1:4310/api/mcp)' : 'HTTP MCP 地址（如 http://127.0.0.1:4310/api/mcp）'}" required />
        <button type="submit" class="btn small primary">${isEn ? '+ Register HTTP MCP' : '+ 注册外部 HTTP MCP'}</button>
      </form>
    </div>
  `;
}

function renderSkillsAndAgentsSection(data, isEn) {
  const skills = data.skills || [];
  const rules = data.rules || [];
  const commands = data.commands || [];
  const agents = data.agents || [];
  const activeSkill = state.pluginActiveSkill && skills.some((s) => s.id === state.pluginActiveSkill.id) ? state.pluginActiveSkill : null;
  const matchRes = state.pluginSkillMatch;
  const defaultQuery = isEn ? 'Run TDD unit tests and complete security code review' : '请执行 TDD 单元测试并完成安全代码审计';
  const curRole = state.pluginSkillRole || 'author';

  return `
    <div class="two-col">
      <div class="panel-card">
        <h3>
          <span>🧠 ${isEn ? 'Progressive Skills, Rules & Slash Commands' : '渐进式技能（SKILL.md）、工程规则与斜杠命令'}</span>
          <span class="plugin-conn-sub">${skills.length} Skills · ${rules.length} Rules · ${commands.length} Cmds</span>
        </h3>
        <form id="form-skill-match" class="plugin-inline-form" style="margin-top:0;">
          <input id="skill-match-input" class="search-input" value="${escapeHtml(state.pluginSkillQuery || defaultQuery)}" placeholder="${isEn ? 'Enter a task prompt to test progressive skill matching...' : '输入任务提示词测试渐进式技能匹配...'}" />
          <select id="skill-match-role" class="composer-select">
            ${['author', 'reviewer', 'verifier', 'architect']
              .map((r) => `<option value="${r}" ${curRole === r ? 'selected' : ''}>${r}</option>`)
              .join('')}
          </select>
          <button type="submit" class="btn small primary" id="btn-skill-match">${isEn ? 'Match Skills' : '🔍 匹配技能'}</button>
        </form>
        ${
          matchRes
            ? `
              <div class="plugin-result-box" id="skill-match-result">
                <div class="plugin-result-title">
                  <span>${isEn ? `Matched ${matchRes.matched?.length || 0} skill(s) & ${matchRes.rules?.length || 0} rule(s)` : `命中 ${matchRes.matched?.length || 0} 项技能 · 注入 ${matchRes.rules?.length || 0} 条工程规则`}</span>
                </div>
                <div class="plugin-chip-row" style="margin-top:6px;">
                  ${(matchRes.matched || []).map((m) => `<span class="plugin-badge plugin-badge-cyan">${escapeHtml(m.id)} (score=${m.score ?? m.matchScore ?? 0})</span>`).join('')}
                </div>
                ${matchRes.promptBlock ? `<pre class="plugin-code-box">${escapeHtml(matchRes.promptBlock.slice(0, 900))}</pre>` : ''}
              </div>
            `
            : ''
        }
        <div class="plugin-skill-list">
          ${
            skills.length === 0
              ? `<div class="empty-state" style="padding:10px;">${isEn ? 'No active skills available.' : '暂无已启用的插件技能。'}</div>`
              : skills
                  .map(
                    (s) => `
                      <button type="button" class="plugin-skill-btn ${activeSkill?.id === s.id ? 'active' : ''}" data-view-skill="${escapeHtml(s.id)}">
                        <div class="plugin-skill-top">
                          <strong>${escapeHtml(s.name)}</strong>
                          <code>${escapeHtml(s.pluginId)}</code>
                        </div>
                        <div class="plugin-conn-sub">${escapeHtml(s.description || '')}</div>
                        ${s.triggers?.length ? `<div class="plugin-chip-row">${s.triggers.slice(0, 5).map((tr) => `<span class="plugin-chip">#${escapeHtml(tr)}</span>`).join('')}</div>` : ''}
                      </button>
                    `
                  )
                  .join('')
          }
        </div>
        ${
          activeSkill
            ? `
              <div class="plugin-result-box" style="margin-top:10px;" id="skill-detail-box">
                <div class="plugin-result-title">
                  <span>📄 ${escapeHtml(activeSkill.id)} (${escapeHtml(activeSkill.filePath || 'SKILL.md')})</span>
                  <button type="button" class="btn small" data-close-skill-view="1">${isEn ? 'Close' : '收起'}</button>
                </div>
                <pre class="plugin-code-box">${escapeHtml(activeSkill.content || '')}</pre>
              </div>
            `
            : ''
        }
        ${
          commands.length
            ? `<div style="margin-top:10px;"><div class="plugin-conn-sub" style="margin-bottom:6px;">${isEn ? 'Available Slash Commands (usable directly in Board):' : '可用插件斜杠命令（在留言板直接输入即可展开）：'}</div><div class="plugin-chip-row">${commands.map((c) => `<span class="plugin-badge plugin-badge-cyan">/${escapeHtml(c.name)} — ${escapeHtml(c.description || c.pluginId)}</span>`).join('')}</div></div>`
            : ''
        }
      </div>

      <div class="panel-card">
        <h3>
          <span>🤖 ${isEn ? 'Plugin-Declared Specialist Agents' : '插件声明专职智能体（一键招募入群）'}</span>
          <span class="plugin-conn-sub">${agents.length} Agents</span>
        </h3>
        <div class="plugin-agent-list">
          ${
            agents.length === 0
              ? `<div class="empty-state">${isEn ? 'No plugin agents declared.' : '当前插件未声明独立 Agent。'}</div>`
              : agents
                  .map(
                    (a) => `
                      <div class="plugin-agent-card">
                        <div class="plugin-item-head">
                          <div>
                            <strong>@${escapeHtml(a.name)}</strong>
                            <span class="plugin-chip">${escapeHtml(a.role)}</span>
                            <span class="plugin-chip">${escapeHtml(a.driver)}</span>
                          </div>
                          <button type="button" class="btn small primary" data-spawn-plugin-agent="${escapeHtml(a.id)}">
                            ${isEn ? '+ Recruit to Swarm' : '+ 招募入群'}
                          </button>
                        </div>
                        <div class="plugin-conn-sub" style="margin-top:4px;">${escapeHtml(a.brief || '')}</div>
                        <div class="plugin-conn-sub" style="margin-top:4px;">plugin: <code>${escapeHtml(a.pluginId)}</code> · workspace: <code>${escapeHtml(a.workspace)}</code></div>
                      </div>
                    `
                  )
                  .join('')
          }
        </div>
        <div style="margin-top:14px;">
          <div class="plugin-conn-sub" style="margin-bottom:6px;">📜 ${isEn ? 'Active Always-On / Scoped Engineering Rules' : '生效中的工程规则（Rules）'}</div>
          <div class="plugin-rule-list">
            ${
              rules.length === 0
                ? `<div class="empty-state" style="padding:10px;">${isEn ? 'No active rules.' : '暂无生效中的工程规则。'}</div>`
                : rules
                    .map((r) => {
                      const rawBody = String(r.content || '');
                      const snippet = rawBody.length > 140 ? `${rawBody.slice(0, 140)}...` : rawBody;
                      return `
                        <div class="plugin-rule-item">
                          <strong>${escapeHtml(r.name)}</strong>
                          <span class="plugin-chip">${escapeHtml(r.alwaysApply ? 'always' : (r.globs || []).join(', ') || 'scoped')}</span>
                          <div class="plugin-conn-sub">${escapeHtml(snippet)}</div>
                        </div>
                      `;
                    })
                    .join('')
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderHooksSection(data, isEn) {
  const hooks = data.hooks || [];
  const history = data.hookHistory || [];
  const testRes = state.pluginHookTestResult;
  const curEvent = state.pluginHookEvent || 'PreToolUse';

  return `
    <div class="two-col">
      <div class="panel-card">
        <h3>
          <span>🛡️ ${isEn ? 'Lifecycle Hooks Governance & Live Simulator' : '生命周期 Hook 治理台 & 实时演练器'}</span>
          <span class="plugin-conn-sub">${hooks.length} Hooks</span>
        </h3>
        <form id="form-hook-test" class="plugin-hook-sim">
          <div class="plugin-hook-sim-row">
            <select id="hook-test-event" class="composer-select">
              ${ALL_HOOK_EVENTS.map((ev) => `<option value="${ev}" ${curEvent === ev ? 'selected' : ''}>${ev}</option>`).join('')}
            </select>
            <input id="hook-test-tool" class="search-input" value="${escapeHtml(state.pluginHookTool || 'run_command')}" placeholder="${isEn ? 'Tool / target (e.g. run_command / write_file)' : '目标工具名（如 run_command / write_file）'}" />
          </div>
          <div class="plugin-hook-sim-row">
            <input id="hook-test-input" class="search-input" value="${escapeHtml(state.pluginHookInput || 'rm -rf /tmp/demo')}" placeholder="${isEn ? 'Simulated command or file content...' : '模拟命令或写入内容（如 rm -rf /tmp/demo）'}" />
            <button type="submit" class="btn small primary" id="btn-hook-test">${isEn ? 'Run Hook Simulator' : '▶ 运行 Hook 演练'}</button>
          </div>
        </form>
        ${
          testRes
            ? `
              <div class="plugin-result-box ${testRes.allowed ? 'is-ok' : 'is-deny'}" id="hook-test-result">
                <div class="plugin-result-title">
                  <span>${
                    testRes.allowed
                      ? (isEn ? '✅ ALLOW (Passed)' : '✅ ALLOW（放行）')
                      : `${isEn ? '🛑 DENY (Blocked)' : '🛑 DENY（拦截）'}：${escapeHtml(testRes.reason || '')}`
                  }</span>
                </div>
                ${
                  testRes.additionalContext
                    ? `<div class="plugin-conn-sub" style="margin-top:4px;">${isEn ? 'Injected Context: ' : '注入上下文：'}${escapeHtml(testRes.additionalContext)}</div>`
                    : ''
                }
                ${(testRes.warnings || []).length ? `<div class="plugin-conn-sub" style="margin-top:4px;color:var(--amber);">⚠️ ${escapeHtml(testRes.warnings.join('；'))}</div>` : ''}
              </div>
            `
            : ''
        }
        <div class="wiki-table-wrap" style="margin-top:10px;">
          ${
            hooks.length === 0
              ? `<div class="empty-state" style="padding:10px;">${isEn ? 'No active hooks registered.' : '当前无已启用的生命周期 Hook。'}</div>`
              : `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>${isEn ? 'Event' : '事件'}</th>
                      <th>${isEn ? 'Matcher' : '匹配器'}</th>
                      <th>${isEn ? 'Type / Action' : '类型与动作'}</th>
                      <th>${isEn ? 'Plugin' : '来源插件'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${hooks
                      .map(
                        (h) => `
                          <tr>
                            <td><code>${escapeHtml(h.event)}</code></td>
                            <td><code>${escapeHtml(h.matcher)}</code></td>
                            <td><span class="plugin-chip">${escapeHtml(h.type)}:${escapeHtml(h.action)}</span></td>
                            <td><code>${escapeHtml(h.pluginId)}</code></td>
                          </tr>
                        `
                      )
                      .join('')}
                  </tbody>
                </table>
              `
          }
        </div>
      </div>

      <div class="panel-card">
        <h3>
          <span>📜 ${isEn ? 'Hook Execution Audit Trail' : 'Hook 执行审计日志（追加记录）'}</span>
          <span class="plugin-conn-sub">${history.length} ${isEn ? 'events' : '条记录'}</span>
        </h3>
        <div class="log-console" style="max-height:320px;">
          ${
            history.length === 0
              ? `<div class="empty-state" style="padding:12px;">${isEn ? 'No hook runs recorded yet. Try the simulator on the left!' : '暂无 Hook 触发记录，可在左侧点击「运行 Hook 演练」验证实时拦截效果。'}</div>`
              : [...history]
                  .reverse()
                  .slice(0, 40)
                  .map(
                    (rec) => `
                      <div class="log-line ${rec.allowed ? 'log-result' : 'log-stderr'}">
                        <span>[${escapeHtml(formatTime(rec.time))}]</span>
                        <span>${rec.allowed ? 'ALLOW' : 'DENY '}</span>
                        <span>${escapeHtml(rec.event)}(${escapeHtml(rec.target || '*')})</span>
                        <span>${escapeHtml(rec.reason || `${rec.matchedHooks} hook(s)`)}</span>
                      </div>
                    `
                  )
                  .join('')
          }
        </div>
      </div>
    </div>
  `;
}

export function renderPluginsView({ renderTopStatus, refreshCurrentSwarm }) {
  const box = $('#plugins-view-body');
  if (!box) return;
  const isEn = state.lang === 'en-US';
  const data = state.pluginsOverview;

  if (!data) {
    box.innerHTML = `<div class="empty-state">${isEn ? 'Loading plugins, connectors, skills & hooks...' : '正在加载插件生态、连接器雷达、技能目录与 Hook 引擎...'}</div>`;
    return;
  }

  const plugins = data.plugins || [];
  const enabledPlugins = plugins.filter((p) => p.enabled).length;
  const connectors = data.connectors || [];
  const readyConns = connectors.filter((c) => c.ready).length;
  const syncRes = state.pluginSyncResult;
  const installMode = state.pluginInstallMode || 'inline';

  box.innerHTML = `
    <div class="section-stack">
      <div class="world-kpi-grid">
        <div class="world-kpi">
          <div class="world-kpi-label">${isEn ? 'Active Plugins' : '已启用插件包'}</div>
          <div class="world-kpi-val">${enabledPlugins} <small>/ ${plugins.length} ${isEn ? 'packs' : '包'}</small></div>
        </div>
        <div class="world-kpi">
          <div class="world-kpi-label">${isEn ? 'Skills & Rules' : '活跃技能 & 规则'}</div>
          <div class="world-kpi-val">${(data.skills || []).length} <small>Skills · ${(data.rules || []).length} Rules</small></div>
        </div>
        <div class="world-kpi">
          <div class="world-kpi-label">${isEn ? 'Lifecycle Hooks' : '生命周期 Hooks'}</div>
          <div class="world-kpi-val">${(data.hooks || []).length} <small>${(data.hookHistory || []).length} ${isEn ? 'runs' : '次触发'}</small></div>
        </div>
        <div class="world-kpi">
          <div class="world-kpi-label">${isEn ? 'Harness Connectors' : '跨端连接器雷达'}</div>
          <div class="world-kpi-val">${readyConns} <small>/ ${connectors.length} ${isEn ? 'ready' : '就绪'}</small></div>
        </div>
      </div>

      <!-- 1. Cross-Harness Connector Radar & TeamAI Sync -->
      <div class="panel-card">
        <h3>
          <span>🌐 ${isEn ? 'Cross-Harness Connector Radar & TeamAI Asset Sync' : '跨端 Agent 连接器雷达 & TeamAI 统一配置同步'}</span>
          <div class="plugin-sync-controls">
            <select id="plugin-sync-harness" class="composer-select" aria-label="${isEn ? 'Target Harness' : '目标连接器'}">
              ${connectors
                .filter((c) => c.id !== 'mcp-gateway')
                .map((c) => `<option value="${escapeHtml(c.id)}" ${state.pluginSelectedHarness === c.id ? 'selected' : ''}>${escapeHtml(c.name)} (${escapeHtml(c.id)})</option>`)
                .join('')}
            </select>
            <button type="button" class="btn small" id="btn-connector-dry-run">👁 ${isEn ? 'Preview Sync (Dry-Run)' : '预览同步 (Dry-Run)'}</button>
            <button type="button" class="btn small primary" id="btn-connector-apply">⚡ ${isEn ? 'Sync to Repo' : '一键同步至仓库'}</button>
          </div>
        </h3>
        ${renderConnectorCards(connectors, isEn)}
        ${
          syncRes
            ? `
              <div class="plugin-result-box is-ok" id="connector-sync-result" style="margin-top:12px;">
                <div class="plugin-result-title">
                  <span>${
                    syncRes.dryRun
                      ? (isEn ? '👁 Dry-Run Preview Complete' : '👁 Dry-Run 预览完成')
                      : (isEn ? '✅ Config Synced to Workspace' : '✅ 已同步配置到工作区')
                  } · Harness: <code>${escapeHtml(syncRes.harnessId)}</code> · ${(syncRes.plannedFiles || syncRes.writtenFiles || []).length} ${isEn ? 'file(s)' : '个文件'}</span>
                </div>
                <div class="plugin-chip-row" style="margin-top:6px;">
                  ${(syncRes.plannedFiles || syncRes.writtenFiles || []).map((f) => `<span class="plugin-chip">${escapeHtml(f)}</span>`).join('')}
                </div>
              </div>
            `
            : ''
        }
      </div>

      <!-- 2. Plugins Registry & Quick Install/Create -->
      <div class="panel-card">
        <h3>
          <span>🧩 ${isEn ? 'Installed Agent Plugins & TeamAI Asset Packs' : '插件包中心（兼容 Agent Plugin Standard 与 TeamAI Git 仓库）'}</span>
          <button type="button" class="btn small" id="btn-plugins-refresh">${isEn ? 'Refresh' : '刷新生态'}</button>
        </h3>
        ${renderPluginCards(plugins, isEn)}
        <form id="form-plugin-install" class="plugin-create-box">
          <div class="plugin-conn-sub" style="margin-bottom:8px;">✨ ${isEn ? 'Quick Create Inline Plugin Pack (Skill + Policy Hook) or Connect TeamAI Git Repo' : '快速新建自定义插件包（含 Skill / Policy Hook）或接入 TeamAI Git 资产仓库'}</div>
          <div class="plugin-create-grid">
            <select id="pi-mode" class="composer-select">
              <option value="inline" ${installMode === 'inline' ? 'selected' : ''}>${isEn ? 'Inline Custom Pack' : '新建自定义插件包'}</option>
              <option value="git" ${installMode === 'git' ? 'selected' : ''}>${isEn ? 'TeamAI Git Repo URL' : '接入 TeamAI Git 仓库'}</option>
            </select>
            <input id="pi-id" class="search-input" placeholder="${isEn ? 'Plugin ID (e.g. team-guard-pack)' : '插件 ID（如 team-guard-pack）'}" required />
            <input id="pi-name" class="search-input" placeholder="${isEn ? 'Display Name / Git URL' : '显示名称（Git 模式填仓库 https://...）'}" required />
            <input id="pi-skill" class="search-input" placeholder="${isEn ? 'Skill name (optional, e.g. api-contract)' : '技能名（可选，如 api-contract）'}" />
            <button type="submit" class="btn small primary" id="btn-plugin-install">${isEn ? '+ Install / Create' : '+ 安装 / 创建插件'}</button>
          </div>
        </form>
      </div>

      <!-- 3. External MCP Client Manager -->
      ${renderMcpClientsSection(data.mcpServers || [], isEn)}

      <!-- 4. Progressive Skills, Rules, Commands & Plugin Agents -->
      ${renderSkillsAndAgentsSection(data, isEn)}

      <!-- 5. Lifecycle Hooks & Audit Trail -->
      ${renderHooksSection(data, isEn)}
    </div>
  `;

  bindPluginViewFormHandlers({ renderTopStatus, refreshCurrentSwarm });
}

function bindPluginViewFormHandlers({ renderTopStatus, refreshCurrentSwarm }) {
  const isEn = state.lang === 'en-US';

  $('#plugin-sync-harness')?.addEventListener('change', (ev) => {
    state.pluginSelectedHarness = ev.target.value;
  });

  $('#pi-mode')?.addEventListener('change', (ev) => {
    state.pluginInstallMode = ev.target.value;
  });

  $('#form-plugin-install')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const mode = $('#pi-mode')?.value || 'inline';
      const id = $('#pi-id')?.value.trim();
      const nameOrUrl = $('#pi-name')?.value.trim();
      const skillName = $('#pi-skill')?.value.trim();
      if (!id || !nameOrUrl) return;
      state.pluginInstallMode = mode;

      if (mode === 'git') {
        await api('/api/plugins/install', {
          method: 'POST',
          body: JSON.stringify({ mode: 'git', id, url: nameOrUrl })
        });
      } else {
        await api('/api/plugins/install', {
          method: 'POST',
          body: JSON.stringify({
            mode: 'inline',
            id,
            name: nameOrUrl,
            description: isEn ? `Custom inline plugin pack (${id})` : `通过 Web 控制台创建的自定义协同插件包 (${id})`,
            skills: skillName
              ? [
                  {
                    name: skillName,
                    description: isEn ? `Custom engineering skill: ${skillName}` : `自定义工程技能：${skillName}`,
                    triggers: [skillName, id],
                    content: `# ${skillName}\n\n${isEn ? `Standard workflow provided by plugin \`${id}\`.` : `由插件 \`${id}\` 提供的团队标准工程规程。`}`
                  }
                ]
              : [],
            hooks: [
              {
                id: `${id}-preturn-note`,
                event: 'PreTurn',
                matcher: '*',
                type: 'policy',
                action: 'inject_context',
                additionalContext: isEn ? `Custom plugin ${nameOrUrl} policy enabled.` : `已启用自定义插件 ${nameOrUrl} 规范。`
              }
            ]
          })
        });
      }
      state.pluginSyncResult = null;
      showToast(isEn ? `Plugin ${id} installed` : `插件 ${id} 安装/创建成功`, 'ok');
      await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#form-mcp-register')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const id = $('#mcp-reg-id')?.value.trim();
      const url = $('#mcp-reg-url')?.value.trim();
      if (!id || !url) return;
      await api('/api/mcp-clients', {
        method: 'POST',
        body: JSON.stringify({
          id,
          transport: 'http',
          url,
          description: isEn ? 'Custom HTTP MCP connector registered via Web UI' : '通过 Web 控制台注册的外部 HTTP MCP 连接器'
        })
      });
      showToast(isEn ? `Registered MCP connector ${id}` : `已注册外部 MCP 连接器 ${id}`, 'ok');
      await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#form-skill-match')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const text = $('#skill-match-input')?.value.trim() || '';
      const role = $('#skill-match-role')?.value || 'author';
      state.pluginSkillQuery = text;
      state.pluginSkillRole = role;
      state.pluginSkillMatch = await api('/api/skills/match', {
        method: 'POST',
        body: JSON.stringify({ text, role, limit: 5 })
      });
      renderPluginsView({ renderTopStatus, refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });

  $('#form-hook-test')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const event = $('#hook-test-event')?.value || 'PreToolUse';
      const tool = $('#hook-test-tool')?.value.trim() || 'run_command';
      const rawInput = $('#hook-test-input')?.value || '';
      state.pluginHookEvent = event;
      state.pluginHookTool = tool;
      state.pluginHookInput = rawInput;
      state.pluginHookTestResult = await api('/api/hooks/test', {
        method: 'POST',
        body: JSON.stringify({
          event,
          payload: { tool, command: rawInput, text: rawInput, input: { command: rawInput, content: rawInput } }
        })
      });
      await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    } catch (err) {
      showToast(err.message);
    }
  });
}

let _pluginLoadInFlight = null;
let _pluginLoadPending = false;
let _pluginLoadSeq = 0;

export async function loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm } = {}) {
  if (_pluginLoadInFlight) {
    _pluginLoadPending = true;
    return _pluginLoadInFlight;
  }
  const mySeq = ++_pluginLoadSeq;
  const run = async () => {
    const overview = await api('/api/plugins');
    if (mySeq !== _pluginLoadSeq) return;
    state.pluginsOverview = overview;
    if (state.pluginActiveSkill && !(overview.skills || []).some((s) => s.id === state.pluginActiveSkill.id)) {
      state.pluginActiveSkill = null;
    }
    if (renderTopStatus) renderTopStatus();
    if (state.tab === 'plugins') {
      renderPluginsView({ renderTopStatus, refreshCurrentSwarm });
    }
  };
  _pluginLoadInFlight = run().finally(() => {
    _pluginLoadInFlight = null;
    if (_pluginLoadPending) {
      _pluginLoadPending = false;
      loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm }).catch(() => {});
    }
  });
  return _pluginLoadInFlight;
}

export async function handlePluginClick(ev, { renderTopStatus, refreshCurrentSwarm }) {
  const isEn = state.lang === 'en-US';

  if (ev.target.closest('#btn-plugins-refresh')) {
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  if (ev.target.closest('[data-close-skill-view]')) {
    state.pluginActiveSkill = null;
    renderPluginsView({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  if (ev.target.closest('#btn-connector-dry-run') || ev.target.closest('#btn-connector-apply')) {
    const isDry = Boolean(ev.target.closest('#btn-connector-dry-run'));
    const harnessId = $('#plugin-sync-harness')?.value || state.pluginSelectedHarness || 'claude-code';
    state.pluginSelectedHarness = harnessId;
    state.pluginSyncResult = await api('/api/connectors/sync', {
      method: 'POST',
      body: JSON.stringify({ harnessId, dryRun: isDry, swarmId: state.currentSwarmId })
    });
    showToast(
      isDry
        ? (isEn ? `Dry-run sync preview generated for ${harnessId}` : `已生成 ${harnessId} 同步预览`)
        : (isEn ? `Synced plugin assets to ${harnessId}` : `已同步插件配置至 ${harnessId}`),
      'ok'
    );
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  const toggleEnBtn = ev.target.closest('[data-plugin-toggle-enabled]');
  if (toggleEnBtn) {
    const pid = toggleEnBtn.dataset.pluginToggleEnabled;
    await api(`/api/plugins/${encodeURIComponent(pid)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled: toggleEnBtn.dataset.nextVal === 'true' })
    });
    state.pluginSyncResult = null;
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  const toggleTrBtn = ev.target.closest('[data-plugin-toggle-trusted]');
  if (toggleTrBtn) {
    const pid = toggleTrBtn.dataset.pluginToggleTrusted;
    await api(`/api/plugins/${encodeURIComponent(pid)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ trusted: toggleTrBtn.dataset.nextVal === 'true' })
    });
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  const syncGitBtn = ev.target.closest('[data-plugin-sync-git]');
  if (syncGitBtn) {
    const pid = syncGitBtn.dataset.pluginSyncGit;
    await api(`/api/plugins/${encodeURIComponent(pid)}/sync`, { method: 'POST', body: JSON.stringify({}) });
    showToast(isEn ? `Pulled latest TeamAI plugin ${pid}` : `已拉取 TeamAI 插件仓库 ${pid} 最新资产`, 'ok');
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  const viewSkillBtn = ev.target.closest('[data-view-skill]');
  if (viewSkillBtn) {
    const sid = viewSkillBtn.dataset.viewSkill;
    if (state.pluginActiveSkill?.id === sid) {
      state.pluginActiveSkill = null;
    } else {
      state.pluginActiveSkill = await api(`/api/skills/${encodeURIComponent(sid)}`);
    }
    renderPluginsView({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  const spawnPluginAgentBtn = ev.target.closest('[data-spawn-plugin-agent]');
  if (spawnPluginAgentBtn) {
    if (!state.currentSwarmId) {
      showToast(isEn ? 'Please create or select a Swarm first' : '请先创建或选择一个协同蜂群');
      return true;
    }
    const agentId = spawnPluginAgentBtn.dataset.spawnPluginAgent;
    const res = await api(`/api/swarms/${encodeURIComponent(state.currentSwarmId)}/plugins/spawn-agent`, {
      method: 'POST',
      body: JSON.stringify({ agentId })
    });
    showToast(
      isEn ? `Recruited plugin agent @${res.member?.name || agentId}` : `已招募插件智能体 @${res.member?.name || agentId} 加入当前蜂群`,
      'ok'
    );
    await refreshCurrentSwarm();
    return true;
  }

  const mcpConnBtn = ev.target.closest('[data-mcp-connect]');
  if (mcpConnBtn) {
    const sid = mcpConnBtn.dataset.mcpConnect;
    const res = await api(`/api/mcp-clients/${encodeURIComponent(sid)}/connect`, { method: 'POST', body: JSON.stringify({}) });
    showToast(
      res.ok
        ? (isEn ? `Connected MCP server ${sid}` : `MCP 连接器 ${sid} 已连接`)
        : (isEn ? `MCP connection failed: ${res.server?.lastError || 'unknown'}` : `MCP 连接失败: ${res.server?.lastError || 'unknown'}`),
      res.ok ? 'ok' : 'error'
    );
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  const mcpDiscBtn = ev.target.closest('[data-mcp-disconnect]');
  if (mcpDiscBtn) {
    const sid = mcpDiscBtn.dataset.mcpDisconnect;
    await api(`/api/mcp-clients/${encodeURIComponent(sid)}/disconnect`, { method: 'POST', body: JSON.stringify({}) });
    await loadPluginsOverview({ renderTopStatus, refreshCurrentSwarm });
    return true;
  }

  return false;
}
