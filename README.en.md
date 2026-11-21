# Yunyu Teamwork（云驭协同）

> **Open-Source, Zero-Dependency Multi-Agent Swarm Engineering, Project World Model, Living Wiki & GitLab Collaboration Platform** — Coordinate heterogeneous AI agents (Claude Code, Codex CLI, Gemini CLI, OpenAI/DeepSeek/Qwen/Ollama, Dify/LangGraph Webhooks, Personal Digital Twins, MCP clients) and human engineers on one append-only board with Git Worktree isolation, strict File Ownership Contracts, and native GitLab integration.

[![License: MIT](https://img.shields.io/badge/License-MIT-38e8ff.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.4.0-60a5fa.svg)](CHANGELOG.md)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-34d399.svg)](package.json)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0%20runtime%20deps-fbbf24.svg)](package.json)
[![GitLab](https://img.shields.io/badge/GitLab-API%20v4%20%2B%20Webhooks-fb923c.svg)](docs/GITLAB_INTEGRATION.md)
[![MCP](https://img.shields.io/badge/MCP-JSON--RPC%202.0%20(30%20tools)-a78bfa.svg)](docs/PROTOCOL.md)

[简体中文主文档 (README.md)](README.md) · [Changelog](CHANGELOG.md) · [Living Wiki](docs/wiki/README.md) · [Benchmark & Design](docs/BENCHMARK_AND_INTEGRATION.md) · [Architecture](docs/ARCHITECTURE.md) · [Agent Protocol & MCP](docs/PROTOCOL.md) · [GitLab Integration](docs/GITLAB_INTEGRATION.md) · [Security](SECURITY.md)

---

## Highlights (v0.4.0)

1. **Project World Model & Blast-Radius Impact Simulator**: Zero-dependency static AST/lexer module topology, hub ranking, circular dependency detection, and pre-edit blast-radius prediction (direct/transitive dependents, impacted tests, notified owners, invariant warnings).
2. **Living Project Wiki Archive**: Append-only versioned Wiki persisted in `events.jsonl`, auto-synthesized from World Model + Knowledge Vault + Audit Report, editable inline in the Web UI, and exportable to Markdown via `yunyu wiki`.
3. **Multi-Perspective Automated Project Auditor**: `yunyu audit` checks zero runtime dependencies, hardcoded secrets, dynamic `eval`/`new Function` (including template expressions), unsafe shell interpolation, circular dependencies, ownership overlaps, oversized files, and version parity.
4. **Qoder-Style 6-State Issue Center + Beads DAG + Vibe Diff Review**: Planning → Ready → In Progress → Pending Acceptance → Done / Cancelled (`ISS-N`), Spec freeze & Acceptance checklist, DAG cycle detection, TTL Claim Leases, and slide-over colored Unified Git Diff review.
5. **Paperclip-Style Budget Governor**: Swarm & per-member token, turn, and USD ceilings with 80% alerts and 100% hard circuit-breaker stops.
6. **Research Synthesizer Agent & Shared Knowledge Vault**: Read-only `researcher` role collecting local repo snippets + SSRF-hardened web sources + swarm history into citation-backed briefs stored in an append-only Knowledge Vault.
7. **Personal Digital Twins + 6 IM/Bot Channels**: Reusable `.yunyu/twins.json` profiles with `hybrid` escalation to **Feishu/Lark, WeCom, DingTalk, Telegram, Slack/Discord, and Generic HMAC-SHA256 Webhooks**.
8. **7 Heterogeneous Drivers + 30 MCP Tools + Real Git Worktrees + 8-View Bilingual Dark UI**: Full restart rehydration, live CLI streaming logs (`--resume`), strict `verifier`/`reviewer`/`researcher`/`qa` read-only isolation, and native GitLab bidirectional sync.

---

## Quick Start (Zero `npm install` Needed!)

Requires **Node.js `>= 22.0.0`** and **Git**.

```bash
# 1. Clone repository
git clone https://github.com/yunyu-x/yunyu-teamwork.git
cd yunyu-teamwork

# 2. Run the zero-API-key end-to-end offline demo
npm run demo
# Open http://127.0.0.1:4310 to explore all 8 real-time views

# 3. Audit the repository & export Living Project Wiki
npm run audit
npm run wiki

# 4. Start the production server against your local repository
cp .env.example .env
npm start

# 5. Run the complete verification gate (Syntax + Tests + Headless Chrome CDP UI QA + Audit)
npm run verify
```

---

## Connect Any Agent via MCP

Add `yunyu-mcp` to Claude Code, Antigravity, Cursor, or Codex:

```json
{
  "mcpServers": {
    "yunyu-teamwork": {
      "command": "node",
      "args": ["/path/to/yunyu-teamwork/bin/yunyu-mcp.mjs"],
      "env": {
        "YUNYU_REPO_PATH": "/path/to/your-project"
      }
    }
  }
}
```

See [docs/PROTOCOL.md](docs/PROTOCOL.md), [docs/GITLAB_INTEGRATION.md](docs/GITLAB_INTEGRATION.md), and [CONTRIBUTING.md](CONTRIBUTING.md) for complete documentation.

## License

[MIT](LICENSE)
