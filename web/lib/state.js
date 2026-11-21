export const KANBAN_ORDER = ['backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled'];

export const state = {
  lang: 'zh-CN',
  tab: 'board',
  swarms: [],
  currentSwarmId: null,
  swarm: null,
  messages: [],
  tasks: [],
  knowledge: [],
  worldModel: null,
  wikiPages: [],
  activeWikiSlug: null,
  wikiFilters: { q: '' },
  wikiEditMode: false,
  wikiDraft: null,
  impactQuery: '',
  worldImpact: null,
  worldAudit: null,
  gitlab: null,
  agentLogs: [],
  logsMemberFilter: '',
  presets: [],
  channelTypes: [],
  savedTwins: [],
  openIssueNotes: new Set(),
  issueNotesMap: new Map(),
  activeIssueId: null,
  activeIssueDiff: null,
  issueFilters: {
    scope: 'all',
    status: 'all',
    search: '',
    sortBy: 'priority',
    readyOnly: false
  },
  knowledgeFilters: {
    q: '',
    category: 'all'
  },
  filters: {
    search: '',
    channel: 'all',
    kind: 'all'
  },
  showOriginalMap: new Set(),
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

export const $ = (sel) => document.querySelector(sel);

export function showToast(message, level = 'error') {
  let el = document.getElementById('yunyu-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'yunyu-toast';
    el.className = 'toast-banner';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = String(message || '');
  el.className = `toast-banner visible toast-${level}`;
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, 4200);
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data ?? {};
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeHttpUrl(rawUrl) {
  if (!rawUrl) return null;
  const trimmed = String(rawUrl).trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {}
  return null;
}

/**
 * Rich text formatter that tokenizes inline code spans FIRST so globs like `src/**`
 * never collide with `**bold**` formatting.
 */
export function formatRichText(text) {
  let html = escapeHtml(text);
  const codeSpans = [];
  html = html.replace(/`([^`]+)`/g, (_, inner) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${inner}</code>`);
    return `\u0000CODE_${idx}\u0000`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[\s(（【\[,:;，：；])(@#?[a-z][a-z0-9_-]*)/g, '$1<span class="mention-tok">$2</span>');
  html = html.replace(/(^|[\s(（【\[,:;，：；])#(\d+)\b/g, '$1<span class="seq-link" data-jump-seq="$2">#$2</span>');
  html = html.replace(/\u0000CODE_(\d+)\u0000/g, (_, i) => codeSpans[Number(i)] || '');
  return html;
}
