import fs from 'node:fs';
import path from 'node:path';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && (inSingle || inDouble)) {
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function splitTopLevelCommas(str) {
  const parts = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && (inSingle || inDouble) && i + 1 < str.length) {
      cur += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth += 1;
      else if (ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const MAX_PARSE_DEPTH = 32;
const BLOCK_SCALAR_RE = /^[|>][+-]?$/;

function parseScalar(raw, depth = 0) {
  if (depth > MAX_PARSE_DEPTH) return String(raw ?? '').trim();
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevelCommas(inner).map((item) => parseScalar(item, depth + 1));
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (!inner) return obj;
    for (const pair of splitTopLevelCommas(inner)) {
      const colon = pair.indexOf(':');
      if (colon === -1) continue;
      const k = String(parseScalar(pair.slice(0, colon), depth + 1)).trim();
      if (!k || FORBIDDEN_KEYS.has(k)) continue;
      obj[k] = parseScalar(pair.slice(colon + 1), depth + 1);
    }
    return obj;
  }
  return s;
}

function parseKeyVal(text) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && (inSingle || inDouble)) {
      i += 1;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === ':' && !inSingle && !inDouble && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      const key = String(parseScalar(text.slice(0, i))).trim();
      const val = text.slice(i + 1).trim();
      return { key, val };
    }
  }
  return null;
}

/**
 * Zero-dependency YAML-subset parser supporting nested objects, lists, object-lists,
 * inline arrays/objects, block scalars (| / >), comments, and prototype-pollution guards.
 * Compatible with TeamAI (`mcp.yaml`, `hooks.yaml`, `agents/*.yaml`) & `SKILL.md` frontmatter.
 */
export function parseYamlLite(source) {
  const rawLines = String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const lines = [];
  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx];
    const clean = stripInlineComment(raw);
    const trimmed = clean.trim();
    const indent = raw.match(/^(\s*)/)[1].replace(/\t/g, '  ').length;
    lines.push({ indent, text: trimmed, raw, isBlankOrComment: !trimmed });
  }

  let cursor = 0;
  const skipBlanks = () => {
    while (cursor < lines.length && lines[cursor].isBlankOrComment) cursor += 1;
  };
  skipBlanks();
  if (cursor >= lines.length) return {};

  const parseBlockScalar = (parentIndent, style) => {
    const chunks = [];
    let baseIndent = null;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.raw.trim() === '') {
        chunks.push('');
        cursor += 1;
        continue;
      }
      if (line.indent <= parentIndent) break;
      if (baseIndent === null) baseIndent = line.indent;
      chunks.push(line.raw.slice(Math.min(baseIndent, line.raw.length)));
      cursor += 1;
    }
    while (chunks.length > 0 && chunks[chunks.length - 1] === '' && !style.endsWith('+')) {
      chunks.pop();
    }
    if (chunks.length === 0) return '';
    return style.startsWith('>') ? chunks.map((c) => c.trim()).join(' ').trim() : chunks.join('\n');
  };

  const skipIndentedChildren = (parentIndent) => {
    while (cursor < lines.length) {
      if (lines[cursor].isBlankOrComment) {
        cursor += 1;
        continue;
      }
      if (lines[cursor].indent > parentIndent) {
        cursor += 1;
      } else {
        break;
      }
    }
  };

  const isSeqLine = (line) => !line.isBlankOrComment && (line.text === '-' || line.text.startsWith('- '));

  const parseNode = (minIndent, depth = 0) => {
    if (depth > MAX_PARSE_DEPTH) return {};
    skipBlanks();
    if (cursor >= lines.length || lines[cursor].indent < minIndent) return {};

    if (isSeqLine(lines[cursor])) {
      const arr = [];
      const seqIndent = lines[cursor].indent;
      while (cursor < lines.length) {
        skipBlanks();
        if (cursor >= lines.length || lines[cursor].indent !== seqIndent || !isSeqLine(lines[cursor])) break;
        const line = lines[cursor];
        const rest = line.text.slice(1).trim();
        cursor += 1;
        if (!rest) {
          skipBlanks();
          if (cursor < lines.length && lines[cursor].indent > seqIndent) {
            arr.push(parseNode(lines[cursor].indent, depth + 1));
          } else {
            arr.push(null);
          }
          continue;
        }
        const kv = parseKeyVal(rest);
        if (kv && kv.key && !FORBIDDEN_KEYS.has(kv.key)) {
          const itemObj = {};
          if (BLOCK_SCALAR_RE.test(kv.val)) {
            itemObj[kv.key] = parseBlockScalar(seqIndent, kv.val);
          } else if (kv.val === '') {
            skipBlanks();
            if (cursor < lines.length && lines[cursor].indent > seqIndent) {
              itemObj[kv.key] = parseNode(lines[cursor].indent, depth + 1);
            } else {
              itemObj[kv.key] = null;
            }
          } else {
            itemObj[kv.key] = parseScalar(kv.val, depth + 1);
          }
          // Merge subsequent indented sibling keys belonging to this list-item object
          skipBlanks();
          if (cursor < lines.length && lines[cursor].indent > seqIndent) {
            const subIndent = lines[cursor].indent;
            while (cursor < lines.length) {
              skipBlanks();
              if (cursor >= lines.length || lines[cursor].indent !== subIndent || isSeqLine(lines[cursor])) break;
              const subLine = lines[cursor];
              const subKv = parseKeyVal(subLine.text);
              if (!subKv) {
                cursor += 1;
                continue;
              }
              cursor += 1;
              if (!subKv.key || FORBIDDEN_KEYS.has(subKv.key)) {
                skipIndentedChildren(subIndent);
                continue;
              }
              if (BLOCK_SCALAR_RE.test(subKv.val)) {
                itemObj[subKv.key] = parseBlockScalar(subIndent, subKv.val);
              } else if (subKv.val === '') {
                skipBlanks();
                if (
                  cursor < lines.length &&
                  (lines[cursor].indent > subIndent || (lines[cursor].indent === subIndent && isSeqLine(lines[cursor])))
                ) {
                  itemObj[subKv.key] = parseNode(lines[cursor].indent, depth + 1);
                } else {
                  itemObj[subKv.key] = null;
                }
              } else {
                itemObj[subKv.key] = parseScalar(subKv.val, depth + 1);
              }
            }
          }
          arr.push(itemObj);
        } else {
          arr.push(parseScalar(rest, depth + 1));
        }
      }
      return arr;
    }

    const obj = {};
    const mapIndent = lines[cursor].indent;
    while (cursor < lines.length) {
      skipBlanks();
      if (cursor >= lines.length || lines[cursor].indent !== mapIndent || isSeqLine(lines[cursor])) break;
      const line = lines[cursor];
      const kv = parseKeyVal(line.text);
      if (!kv) {
        cursor += 1;
        continue;
      }
      cursor += 1;
      if (!kv.key || FORBIDDEN_KEYS.has(kv.key)) {
        skipIndentedChildren(mapIndent);
        continue;
      }
      if (BLOCK_SCALAR_RE.test(kv.val)) {
        obj[kv.key] = parseBlockScalar(mapIndent, kv.val);
      } else if (kv.val === '') {
        skipBlanks();
        if (
          cursor < lines.length &&
          (lines[cursor].indent > mapIndent || (lines[cursor].indent === mapIndent && isSeqLine(lines[cursor])))
        ) {
          obj[kv.key] = parseNode(lines[cursor].indent, depth + 1);
        } else {
          obj[kv.key] = null;
        }
      } else {
        obj[kv.key] = parseScalar(kv.val, depth + 1);
      }
    }
    return obj;
  };

  return parseNode(lines[cursor].indent, 0);
}

/**
 * Parse a Markdown asset file (`SKILL.md`, `rules/*.md`, `commands/*.md`, `agents/*.md`)
 * extracting optional YAML frontmatter and body content.
 */
export function parseMarkdownAsset(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '');
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: text.trim() };
  }
  const frontmatter = parseYamlLite(fmMatch[1]);
  return {
    frontmatter: frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter) ? frontmatter : {},
    body: fmMatch[2].trim()
  };
}

/**
 * Read a JSON or YAML configuration file cleanly.
 */
export function parseConfigFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return JSON.parse(raw);
  }
  if (ext === '.yaml' || ext === '.yml') {
    return parseYamlLite(raw);
  }
  if (ext === '.md') {
    return parseMarkdownAsset(raw);
  }
  return null;
}
