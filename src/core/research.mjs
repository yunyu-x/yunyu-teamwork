import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { APP_VERSION } from './constants.mjs';

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.yml', '.yaml', '.toml', '.css', '.html', '.py', '.go', '.rs'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.worktrees', '.yunyu', 'dist', 'build', 'coverage']);

function decodeHtmlEntities(str) {
  return String(str || '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function isPrivateIpOrHost(hostname) {
  const h = String(hostname || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (!h) return true;
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h === '::1' ||
    h === '::' ||
    h === '0:0:0:0:0:0:0:1' ||
    h === '0:0:0:0:0:0:0:0'
  ) {
    return true;
  }
  // IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (h.startsWith('::ffff:')) {
    const tail = h.slice(7);
    if (net.isIPv4(tail)) return isPrivateIpOrHost(tail);
    return true;
  }
  // IPv6 unique local (fc00::/7 -> fc.. / fd..) and link-local (fe80::/10 -> fe8..feb..)
  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) {
    return true;
  }
  // IPv4 private, loopback, link-local, CGNAT (100.64.0.0/10), unspecified (0.0.0.0/8)
  if (
    /^0\./.test(h) ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
  ) {
    return true;
  }
  return false;
}

async function validatePublicHost(hostname) {
  if (isPrivateIpOrHost(hostname)) return false;
  const cleanHost = String(hostname || '').replace(/^\[|\]$/g, '');
  if (net.isIP(cleanHost)) return !isPrivateIpOrHost(cleanHost);
  try {
    const records = await dns.lookup(cleanHost, { all: true });
    if (!Array.isArray(records) || records.length === 0) return false;
    for (const r of records) {
      if (isPrivateIpOrHost(r.address)) return false;
    }
    return true;
  } catch {
    // DNS failure will also fail fetch; don't bypass private check
    return true;
  }
}

async function readLimitedText(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    return (await res.text()).slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        const remaining = maxBytes - total;
        const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        chunks.push(Buffer.from(slice));
        total += slice.byteLength;
        if (total >= maxBytes) {
          await reader.cancel().catch(() => {});
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function extractKeywords(text, { maxKeywords = 8 } = {}) {
  const cleaned = String(text || '')
    .replace(/https?:\/\/[^\s]+/g, ' ')
    .replace(/@[a-z][a-z0-9_-]*/gi, ' ')
    .replace(/[#`*_[\]()（）【】,:;，：；。？！?!]/g, ' ');

  const stop = new Set([
    '请', '帮我', '搜集', '调研', '整合', '整理', '分析', '参考', '关于', '以及', '并且', '一个', '当前', '项目',
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'please', 'research', 'about'
  ]);

  const tokens = cleaned
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t.toLowerCase()));

  const unique = [];
  const seen = new Set();
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      unique.push(t);
    }
    if (unique.length >= maxKeywords) break;
  }
  return unique;
}

export function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s)）\]】"'<>]+/g) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;，。；]+$/, '')))];
}

/**
 * Zero-dependency Multi-Source Information Collector & Synthesizer Engine:
 * Gathers evidence from local Git repositories, HTTP/HTML web sources, Swarm Board history,
 * Knowledge Vault, and GitLab Issues — then deduplicates & synthesizes citation-backed Chinese reports.
 */
export class ResearchEngine {
  /**
   * Search local repository files for keywords with line-numbered snippets.
   */
  static searchWorkspace(repoPath, queryOrKeywords, { maxFiles = 120, maxMatches = 12 } = {}) {
    if (!repoPath || !fs.existsSync(repoPath)) return [];
    const keywords = Array.isArray(queryOrKeywords)
      ? queryOrKeywords.filter(Boolean)
      : extractKeywords(queryOrKeywords);
    if (keywords.length === 0) return [];
    const lowerKeys = keywords.map((k) => k.toLowerCase());

    const files = [];
    const walk = (dir) => {
      if (files.length >= maxFiles) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (files.length >= maxFiles) return;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
        } else {
          const ext = path.extname(e.name).toLowerCase();
          if (TEXT_EXTENSIONS.has(ext)) files.push(path.join(dir, e.name));
        }
      }
    };
    walk(path.resolve(repoPath));

    const results = [];
    for (const absFile of files) {
      let content;
      try {
        const stat = fs.statSync(absFile);
        if (stat.size > 256 * 1024) continue;
        content = fs.readFileSync(absFile, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      let score = 0;
      const snippets = [];
      for (let i = 0; i < lines.length; i++) {
        const lowLine = lines[i].toLowerCase();
        const hits = lowerKeys.filter((k) => lowLine.includes(k));
        if (hits.length > 0) {
          score += hits.length;
          if (snippets.length < 3) {
            snippets.push(`L${i + 1}: ${lines[i].trim().slice(0, 140)}`);
          }
        }
      }
      if (score > 0) {
        results.push({
          path: path.relative(repoPath, absFile).replace(/\\/g, '/'),
          score,
          snippet: snippets.join(' | ')
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxMatches);
  }

  /**
   * Fetch and parse an HTTP/HTTPS web resource (HTML / Markdown / JSON / plain text) with zero dependencies.
   */
  static async fetchWebSource(url, { timeoutMs = 10_000, maxBytes = 200_000, allowPrivate = false, maxRedirects = 3 } = {}) {
    let currentUrl = String(url || '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res = null;
      let parsed = null;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        try {
          parsed = new URL(currentUrl);
        } catch {
          return { ok: false, url, error: '无效 URL 格式' };
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { ok: false, url, error: `安全拦截：仅允许 HTTP/HTTPS 协议，不支持 ${parsed.protocol}` };
        }
        if (!allowPrivate) {
          const isPublic = await validatePublicHost(parsed.hostname);
          if (!isPublic) {
            return {
              ok: false,
              url,
              error: `安全拦截：默认禁止抓取内网或私有地址 ${parsed.hostname}`
            };
          }
        }

        res = await fetch(parsed.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': `Yunyu-Teamwork-Researcher/${APP_VERSION}`,
            Accept: 'text/html,application/json,text/plain,text/markdown;q=0.9,*/*;q=0.5'
          },
          signal: controller.signal
        });

        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) return { ok: false, url, status: res.status, error: `HTTP ${res.status} 缺少重定向 Location` };
          if (hop === maxRedirects) {
            return { ok: false, url, status: res.status, error: `重定向次数超过上限 (${maxRedirects})` };
          }
          currentUrl = new URL(loc, parsed).toString();
          continue;
        }
        break;
      }

      if (!res || !res.ok) {
        return { ok: false, url, status: res?.status || 0, error: `HTTP ${res?.status || 'ERR'}` };
      }
      const contentType = res.headers.get('content-type') || '';
      const raw = await readLimitedText(res, maxBytes);

      if (contentType.includes('application/json')) {
        return {
          ok: true,
          url,
          contentType,
          title: parsed.hostname + parsed.pathname,
          description: '',
          headings: [],
          text: raw.slice(0, 4000)
        };
      }

      if (contentType.includes('text/html') || /<html|<body|<title/i.test(raw)) {
        const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const descMatch =
          raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ||
          raw.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
        const headings = [...raw.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
          .map((m) => decodeHtmlEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 12);

        const bodyStripped = raw
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
          .replace(/<[^>]+>/g, ' ');
        const cleanText = decodeHtmlEntities(bodyStripped).replace(/\s+/g, ' ').trim();

        return {
          ok: true,
          url,
          contentType,
          title: titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : parsed.hostname,
          description: descMatch ? decodeHtmlEntities(descMatch[1]).trim() : '',
          headings,
          text: cleanText.slice(0, 4000)
        };
      }

      return {
        ok: true,
        url,
        contentType,
        title: parsed.hostname + parsed.pathname,
        description: '',
        headings: [],
        text: raw.trim().slice(0, 4000)
      };
    } catch (err) {
      return { ok: false, url, error: err.message || String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Collect relevant Swarm Board messages, existing Issues, and prior Knowledge Vault entries.
   */
  static collectSwarmContext(swarm, queryOrKeywords) {
    if (!swarm) return { messages: [], issues: [], knowledge: [] };
    const keywords = Array.isArray(queryOrKeywords) ? queryOrKeywords : extractKeywords(queryOrKeywords);
    const lowerKeys = keywords.map((k) => k.toLowerCase());
    const matches = (str) => {
      if (lowerKeys.length === 0) return true;
      const low = String(str || '').toLowerCase();
      return lowerKeys.some((k) => low.includes(k));
    };

    const messages = (swarm.board?.messages || [])
      .filter((m) => matches(m.text))
      .slice(-8)
      .map((m) => ({ seq: m.seq, author: m.author, channel: m.channel, snippet: m.text.slice(0, 180) }));

    const issues = (swarm.tasks?.listTasks?.() || [])
      .filter((t) => matches(`${t.title} ${t.description} ${t.spec}`))
      .slice(0, 6)
      .map((t) => ({ id: t.id, issueKey: t.issueKey, title: t.title, status: t.status }));

    const knowledge = (swarm.knowledge?.listEntries?.() || [])
      .filter((k) => matches(`${k.title} ${k.summary} ${k.content}`))
      .slice(0, 5)
      .map((k) => ({ id: k.id, title: k.title, summary: k.summary }));

    return { messages, issues, knowledge };
  }

  /**
   * Deduplicate multi-source findings and synthesize a structured, citation-backed Chinese Research Brief.
   */
  static synthesizeReport({
    topic,
    workspaceHits = [],
    webSources = [],
    swarmContext = { messages: [], issues: [], knowledge: [] }
  }) {
    const sources = [];
    const seenKeys = new Set();
    const registerSource = (src) => {
      const dedupKey = src.url || src.path || src.title;
      if (seenKeys.has(dedupKey)) return null;
      seenKeys.add(dedupKey);
      const idx = sources.length + 1;
      sources.push({ index: idx, ...src });
      return idx;
    };

    const webFindings = [];
    for (const w of webSources) {
      if (!w.ok) continue;
      const idx = registerSource({
        title: w.title || w.url,
        url: w.url,
        snippet: (w.description || w.text || '').slice(0, 220)
      });
      if (idx) {
        const headStr = w.headings?.length ? `（核心章节：${w.headings.slice(0, 4).join(' / ')}）` : '';
        webFindings.push(`- [${idx}] **${w.title}**${headStr}：${(w.description || w.text || '').slice(0, 240)}`);
      }
    }

    const repoFindings = [];
    for (const hit of workspaceHits) {
      const idx = registerSource({
        title: hit.path,
        path: hit.path,
        snippet: hit.snippet
      });
      if (idx) {
        repoFindings.push(`- [${idx}] \`${hit.path}\`（相关度 ${hit.score}）：${hit.snippet}`);
      }
    }

    const contextFindings = [];
    for (const m of swarmContext.messages || []) {
      const cleanSnippet = m.snippet.replaceAll('`', '').replace(/\s+/g, ' ').slice(0, 120);
      contextFindings.push(`- 留言板 #${m.seq}（@${m.author}）：${cleanSnippet}`);
    }
    for (const iss of swarmContext.issues || []) {
      contextFindings.push(`- 关联 Issue \`${iss.issueKey || iss.id}\` [${iss.status}]：${iss.title}`);
    }

    const failedUrls = webSources.filter((w) => !w.ok);
    const summary = `围绕「${topic}」完成跨源情报搜集与去重整合，共汇集 ${sources.length} 份有效来源（外部网页 ${webFindings.length} 份、仓库代码/文档 ${repoFindings.length} 份、蜂群上下文 ${contextFindings.length} 条）。`;

    const sections = [
      `## 🔍 情报搜集与整合简报：${topic}`,
      '',
      `**摘要**：${summary}`,
      '',
      '### 1. 外部网页 / 文档情报',
      webFindings.length ? webFindings.join('\n') : '- 本轮未命中外部网页来源（可在指令中附带目标 URL 或开启联网搜索引擎）',
      '',
      '### 2. 本地仓库代码与架构依据',
      repoFindings.length ? repoFindings.join('\n') : '- 本地仓库未命中直接关键字文件',
      '',
      '### 3. 蜂群历史与关联 Issue 上下文',
      contextFindings.length ? contextFindings.join('\n') : '- 暂无历史关联记录',
      '',
      '### 4. 整合结论与可执行建议',
      '- 建议基于上述带引用证据冻结 Issue Spec 与验收标准 Checklist，避免多 Agent 盲目开工；',
      '- 优先拆解可并行子 Issue 并建立 DAG 前置依赖，确保隔离 Worktree 并发无冲突；',
      ...(failedUrls.length
        ? [`- ⚠️ 部分外部来源采集受限：${failedUrls.map((f) => `${f.url}（${f.error}）`).join('；')}`]
        : [])
    ];

    return {
      title: `调研简报：${topic.slice(0, 70)}`,
      summary,
      markdown: sections.join('\n'),
      sources
    };
  }
}
