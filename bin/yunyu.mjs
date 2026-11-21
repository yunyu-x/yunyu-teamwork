#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectAuditor } from '../src/core/auditor.mjs';
import { APP_VERSION, DEFAULT_CONFIG } from '../src/core/constants.mjs';
import { ProjectWiki } from '../src/core/wiki.mjs';
import { ProjectWorldModel } from '../src/core/world-model.mjs';
import { isGitRepo } from '../src/core/worktree.mjs';
import { runShowcaseDemo } from '../src/demo/showcase-scenario.mjs';
import { GitLabClient, GitLabSyncService } from '../src/gitlab/index.mjs';
import { PluginHub } from '../src/plugins/hub.mjs';
import { YunyuServer } from '../src/server/app.mjs';

const VERSION = APP_VERSION;

const BOOLEAN_FLAGS = new Set(['once', 'json', 'dry-run', 'dryRun', 'trusted', 'force', 'help']);

function toBoolFlag(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val ?? '').trim().toLowerCase();
  return !(s === '' || s === 'false' || s === '0' || s === 'no' || s === 'off');
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const [key, inlineVal] = tok.slice(2).split('=');
      if (inlineVal !== undefined) {
        args[key] = BOOLEAN_FLAGS.has(key) ? toBoolFlag(inlineVal) : inlineVal;
      } else if (BOOLEAN_FLAGS.has(key)) {
        args[key] = true;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    } else {
      args._.push(tok);
    }
  }
  return args;
}

function loadDotEnv(dir = process.cwd()) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

function printHelp() {
  console.log(`
云驭协同（Yunyu Teamwork）v${VERSION} — 开源多 Agent 蜂群协同研发、项目世界模型与活文档 Wiki 平台

用法：
  yunyu serve [options]       启动 HTTP API + SSE + 中文 Web 协同看板 + MCP 网关
  yunyu demo  [options]       一键启动离线全链路演示（真实 Git Worktree + 本地 GitLab 模拟 + 世界模型 & Wiki）
  yunyu audit [--dir <path>]  执行全仓架构、安全与工程不变量自动审计（--json 输出结构化报告）
  yunyu wiki  [--dir <path>] [--out <dir>]
                              扫描仓库世界模型并导出活文档项目 Wiki 档案（默认输出至 docs/wiki）
  yunyu plugin <list|install|enable|disable|trust|untrust|sync> [options]
                              管理 Agent 插件包（标准 plugin.json & TeamAI Git 仓库）并跨端同步技能/规则/MCP/Hook
  yunyu connectors [--dir <path>] [--json]
                              探测本机 Claude Code / Codex / Cursor / Gemini / OpenCode / Antigravity / CodeBuddy 连接器状态
  yunyu init  [--dir <path>]  在当前或目标 GitLab 仓库中初始化 CONTRACT.json 契约模板
  yunyu status [--url <url>]  查询运行中的云驭服务蜂群与成员状态
  yunyu post --swarm <id> --author <name> --text <msg> [--url <url>]
                              通过命令行向运行中的留言板发帖（可集成于 GitLab CI 脚本）
  yunyu doctor                检查本机 Node.js、Git、GitLab 环境变量与异构 CLI Agent 可用性

常用选项：
  --host <ip>                 监听地址（默认 127.0.0.1）
  --port <num>                监听端口（默认 4310）
  --repo <dir>                绑定的本地 Git 仓库路径（默认当前目录）
  --data <dir>                JSONL 追加日志持久化目录（默认 .yunyu）
  --gitlab-url <url>          GitLab 实例地址（默认读取 GITLAB_BASE_URL）
  --gitlab-project <id>       GitLab 项目路径或数字 ID（默认读取 GITLAB_PROJECT_ID）
`);
}

async function cmdServe(args) {
  loadDotEnv();
  const host = String(args.host || process.env.YUNYU_HOST || DEFAULT_CONFIG.host);
  const port = Number(args.port || process.env.YUNYU_PORT || DEFAULT_CONFIG.port);
  const repoPath = path.resolve(String(args.repo || process.env.YUNYU_REPO_PATH || process.cwd()));
  const dataDir = path.resolve(String(args.data || process.env.YUNYU_DATA_DIR || path.join(process.cwd(), '.yunyu')));

  const server = new YunyuServer({ host, port, repoPath, dataDir });

  // Bootstrap a default GitLab-linked swarm if empty and GITLAB_PROJECT_ID is configured
  const glProject = args['gitlab-project'] || process.env.GITLAB_PROJECT_ID;
  const glUrl = args['gitlab-url'] || process.env.GITLAB_BASE_URL;
  const glToken = args['gitlab-token'] || process.env.GITLAB_TOKEN || '';

  if (server.manager.listSwarms().length === 0) {
    let gitlab = null;
    if (glProject && glUrl) {
      const client = new GitLabClient({ baseUrl: glUrl, token: glToken });
      const sync = new GitLabSyncService({ client, projectId: glProject });
      gitlab = { client, sync, projectId: glProject };
    }
    server.manager.createSwarm({
      id: 'main-workspace',
      title: glProject ? `云驭协同 · ${glProject}` : `云驭协同 · ${path.basename(repoPath)}`,
      repoPath,
      templateId: 'gitlab-fullstack',
      gitlab
    });
  }

  const url = await server.start();
  console.log(`\n🚀 云驭协同（Yunyu Teamwork）服务已启动！`);
  console.log(`   Web 协同看板： ${url}`);
  console.log(`   REST API：     ${url}/api/health`);
  console.log(`   GitLab Webhook:${url}/api/webhooks/gitlab`);
  console.log(`   HTTP MCP 入口：${url}/api/mcp`);
  console.log(`   绑定仓库：     ${repoPath} (Git=${isGitRepo(repoPath) ? '是' : '否'})`);
  console.log(`   持久化目录：   ${dataDir}\n`);

  const shutdown = async () => {
    console.log('\n正在优雅关闭 Yunyu Teamwork 服务...');
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdDemo(args) {
  const host = String(args.host || '127.0.0.1');
  const port = Number(args.port || 4310);

  const server = new YunyuServer({ host, port, inMemory: true });
  const demo = await runShowcaseDemo({ manager: server.manager, keepOpen: true });
  const url = await server.start();

  console.log(`\n✨ 云驭协同（Yunyu Teamwork）离线全链路演练已就绪！`);
  console.log(`   🌐 Web 协同看板（含图谱时间轴回放）：${url}`);
  console.log(`   🦊 本地模拟 GitLab API v4：         ${demo.gitlabMock.baseUrl}`);
  console.log(`   🌳 真实沙盒 Git 仓库：              ${demo.repoDir}`);
  console.log(`   📨 已生成留言板记录：               ${demo.swarm.board.head} 条（含架构冻结 → Worktree 并行开发 → QA 拦截返工 → MR 合并）`);
  console.log(`\n提示：按 Ctrl+C 停止演示服务。\n`);

  if (args.once) {
    await demo.cleanup();
    await server.close();
    return;
  }

  const shutdown = async () => {
    await demo.cleanup();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function cmdInit(args) {
  const targetDir = path.resolve(String(args.dir || process.cwd()));
  const contractPath = path.join(targetDir, 'CONTRACT.json');
  if (!fs.existsSync(contractPath)) {
    const sample = {
      project: path.basename(targetDir),
      version: '1.0.0',
      language: 'zh-CN',
      globalForbidden: ['dist/**', 'build/**', 'coverage/**'],
      ownership: {
        architect: { role: 'architect', owns: ['docs/**', 'CONTRACT.json', 'AGENTS.md'], mustNotTouch: ['tests/**'] },
        backend: { role: 'author', owns: ['src/**'], mustNotTouch: ['web/**', 'tests/**'] },
        frontend: { role: 'author', owns: ['web/**'], mustNotTouch: ['src/**', 'tests/**'] },
        qa: { role: 'verifier', owns: ['tests/**', 'docs/benchmarks/**'], mustNotTouch: ['src/**', 'web/**'] },
        release: { role: 'release', owns: ['CHANGELOG.md', 'README.md', '.gitlab-ci.yml'], mustNotTouch: ['src/**'] }
      }
    };
    fs.writeFileSync(contractPath, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
    console.log(`[yunyu init] 已生成文件所有权契约模板：${contractPath}`);
  } else {
    console.log(`[yunyu init] 已存在 ${contractPath}，跳过覆盖。`);
  }
}

async function cmdStatus(args) {
  const baseUrl = String(args.url || 'http://127.0.0.1:4310').replace(/\/+$/, '');
  const endpoint = args.swarm ? `${baseUrl}/api/swarms/${encodeURIComponent(args.swarm)}` : `${baseUrl}/api/swarms`;
  const res = await fetch(endpoint);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function cmdPost(args) {
  const baseUrl = String(args.url || 'http://127.0.0.1:4310').replace(/\/+$/, '');
  if (!args.swarm || !args.text) {
    throw new Error('缺少参数：请指定 --swarm <id> 与 --text "<内容>"');
  }
  const res = await fetch(`${baseUrl}/api/swarms/${encodeURIComponent(args.swarm)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author: args.author || 'human',
      text: args.text,
      channel: args.channel || 'main'
    })
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

function probeBin(bin, flag = '--version') {
  try {
    const out = execFileSync(bin, [flag], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    })
      .trim()
      .split(/\r?\n/)[0];
    return { installed: true, version: out };
  } catch {
    return { installed: false, version: null };
  }
}

function cmdDoctor() {
  loadDotEnv();
  const report = {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    git: probeBin('git'),
    cwdIsGitRepo: isGitRepo(process.cwd()),
    gitlabConfigured: Boolean(process.env.GITLAB_BASE_URL && process.env.GITLAB_TOKEN && process.env.GITLAB_PROJECT_ID),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    cliAgents: {
      claude: probeBin(process.env.CLAUDE_CLI_BIN || 'claude'),
      codex: probeBin(process.env.CODEX_CLI_BIN || 'codex'),
      gemini: probeBin(process.env.GEMINI_CLI_BIN || 'gemini')
    }
  };
  console.log(JSON.stringify(report, null, 2));
}

function cmdAudit(args) {
  const targetDir = path.resolve(String(args.dir || args.repo || process.cwd()));
  const report = ProjectAuditor.run({ repoPath: targetDir });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n🛡️  云驭协同全仓工程审计报告（${targetDir}）`);
    console.log(
      `   综合评分：${report.score}/100 · 世界模型健康度：${report.worldHealthScore}/100 · 结果：${
        report.passed ? '✅ PASS' : '❌ FAIL'
      }`
    );
    console.log(
      `   扫描源码：${report.summary.scannedFiles} 个 · 发现：P0=${report.summary.p0} / P1=${report.summary.p1} / P2=${report.summary.p2}`
    );
    if (report.findings.length === 0) {
      console.log('   🎉 零缺陷发现：所有工程不变量、安全基线、依赖拓扑与版本号检查均通过！\n');
    } else {
      console.log('');
      for (const f of report.findings) {
        console.log(`   [${f.severity}][${f.category}] ${f.file}:${f.line} — ${f.message}`);
        if (f.fixHint) console.log(`      ↳ 建议：${f.fixHint}`);
      }
      console.log('');
    }
  }
  if (!report.passed) {
    process.exitCode = 1;
  }
}

function cmdWiki(args) {
  const targetDir = path.resolve(String(args.dir || args.repo || process.cwd()));
  const outDir = path.resolve(String(args.out || path.join(targetDir, 'docs', 'wiki')));
  const wm = new ProjectWorldModel({ repoPath: targetDir });
  const snap = wm.refresh();
  const auditReport = ProjectAuditor.run({ repoPath: targetDir, worldModel: wm });
  const wiki = new ProjectWiki({ swarmId: 'cli-export' });
  wiki.generateFromWorldModel(snap, {
    projectName: snap.packageInfo?.name || path.basename(targetDir),
    auditReport
  });
  const exported = wiki.exportToDir(outDir);
  console.log(`\n📚 已基于项目世界模型导出活文档 Wiki 档案：`);
  console.log(`   输出目录：${exported.outDir}`);
  console.log(`   导出页面：${exported.pageCount} 篇 + README.md 索引`);
  console.log(`   仓库健康度：${snap.healthScore}/100 · 审计评分：${auditReport.score}/100\n`);
}

function cmdConnectors(args) {
  const targetDir = path.resolve(String(args.dir || args.repo || process.cwd()));
  const dataDir = path.resolve(String(args.data || path.join(targetDir, '.yunyu')));
  const hub = new PluginHub({ dataDir, repoPath: targetDir });
  const list = hub.connectors.probeConnectors({ repoPath: targetDir, force: true });
  if (args.json) {
    console.log(JSON.stringify({ repoPath: targetDir, connectors: list }, null, 2));
    return;
  }
  console.log(`\n🔌 云驭协同跨端 Agent 连接器雷达（${targetDir}）\n`);
  for (const c of list) {
    const cliMark = c.installed
      ? `✅ ${c.version || c.probeBin || 'builtin'}`
      : c.probeBin
        ? `⚪ 未检测到 ${c.probeBin}`
        : '🌐 协议内置';
    const cfgMark = c.detectedConfigs?.length ? `📁 检测到 ${c.detectedConfigs.join(', ')}` : '○ 待同步';
    console.log(`  • ${c.name.padEnd(24)} [${c.id}]  ${cliMark}  |  ${cfgMark}`);
  }
  console.log('\n提示：运行 `yunyu plugin sync --harness claude-code --dry-run` 可预览 TeamAI 风格跨端配置同步。\n');
}

function cmdPlugin(args) {
  const sub = args._[1] || 'list';
  const targetDir = path.resolve(String(args.dir || args.repo || process.cwd()));
  const dataDir = path.resolve(String(args.data || path.join(targetDir, '.yunyu')));
  const hub = new PluginHub({ dataDir, repoPath: targetDir });

  if (sub === 'list') {
    const overview = hub.getOverview({ repoPath: targetDir, includeConnectors: Boolean(args.json) });
    if (args.json) {
      console.log(JSON.stringify(overview, null, 2));
      return;
    }
    console.log(`\n🧩 云驭协同插件生态总览（${overview.plugins.length} 个插件包）\n`);
    for (const p of overview.plugins) {
      const flag = `${p.enabled ? '✅启用' : '⏸停用'} · ${p.trusted ? '🔓已授信' : '🔒未授信'}`;
      console.log(
        `  • ${p.name} (${p.id}@${p.version}) [${p.format}/${p.sourceType}] ${flag}\n` +
          `    Skills=${p.counts.skills} Rules=${p.counts.rules} Commands=${p.counts.commands} Agents=${p.counts.agents} Hooks=${p.counts.hooks} MCP=${p.counts.mcpServers}`
      );
    }
    console.log('');
    return;
  }

  if (sub === 'install') {
    const src = args._[2] || args.url || args.path;
    if (!src) throw new Error('请指定插件本地目录或 TeamAI Git 仓库地址：yunyu plugin install <url-or-path>');
    const isGit = /^(https?:\/\/|git@|ssh:\/\/)/i.test(src) || src.endsWith('.git');
    const trusted = args.trusted !== undefined ? toBoolFlag(args.trusted) : false;
    const plugin = isGit
      ? hub.installFromGit(src, { id: args.id || null, branch: args.branch || null, trusted })
      : hub.installFromLocal(src, { id: args.id || null, trusted });
    console.log(JSON.stringify({ ok: true, id: plugin.id, format: plugin.format, trusted: plugin.trusted, skills: plugin.skills.length, hooks: plugin.hooks.length }, null, 2));
    return;
  }

  if (sub === 'enable' || sub === 'disable' || sub === 'trust' || sub === 'untrust') {
    const id = args._[2];
    if (!id) throw new Error(`请指定插件 ID：yunyu plugin ${sub} <pluginId>`);
    const patch =
      sub === 'enable'
        ? { enabled: true }
        : sub === 'disable'
          ? { enabled: false }
          : sub === 'trust'
            ? { trusted: true }
            : { trusted: false };
    const updated = hub.setPluginState(id, patch);
    console.log(JSON.stringify({ ok: true, id: updated.id, enabled: updated.enabled, trusted: updated.trusted }, null, 2));
    return;
  }

  if (sub === 'sync') {
    const harnessId = String(args.harness || args._[2] || '').trim();
    if (!harnessId) {
      throw new Error('请指定目标连接器：yunyu plugin sync --harness <claude-code|codex-cli|cursor|gemini-cli|opencode|antigravity|codebuddy> [--dry-run]');
    }
    const dryRun = args['dry-run'] !== undefined ? toBoolFlag(args['dry-run']) : args.dryRun !== undefined ? toBoolFlag(args.dryRun) : false;
    const res = hub.syncToHarness(targetDir, harnessId, { dryRun });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  throw new Error(`未知 plugin 子命令 "${sub}"，可选：list / install / enable / disable / trust / untrust / sync`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';

  switch (cmd) {
    case 'serve':
      await cmdServe(args);
      break;
    case 'demo':
      await cmdDemo(args);
      break;
    case 'audit':
      cmdAudit(args);
      break;
    case 'wiki':
      cmdWiki(args);
      break;
    case 'plugin':
    case 'plugins':
      cmdPlugin(args);
      break;
    case 'connectors':
      cmdConnectors(args);
      break;
    case 'init':
      cmdInit(args);
      break;
    case 'status':
      await cmdStatus(args);
      break;
    case 'post':
      await cmdPost(args);
      break;
    case 'doctor':
      cmdDoctor();
      break;
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error('[yunyu] 错误:', err.message || err);
  process.exit(1);
});
