# Security Policy — 云驭协同（Yunyu Teamwork）

## Built-in Security Controls

`yunyu-teamwork` is designed for self-hosted, enterprise, and local-first multi-agent engineering environments with zero external runtime dependencies:

- **Same-Origin / Loopback CORS & Optional Bearer Auth**: HTTP API rejects wildcard `*` cross-origin calls and supports `YUNYU_API_TOKEN` Bearer token enforcement.
- **Strict File Ownership & Read-Only Isolation**: `OwnershipGuard` normalizes paths (blocking `..` traversal and case bypasses on Windows/macOS), resolves symlinks via `fs.realpathSync`, and enforces read-only `src/` & `web/` protection for `verifier`, `reviewer`, `researcher`, and `qa` roles.
- **Worktree & Git Containment**: `WorktreeManager` validates worktree target containment, blocks protected branches and `--force` push, blocks git flag injection, and audits untracked/non-ASCII files (`-uall`, `core.quotePath=false`) before commit/merge/push.
- **SSRF & XSS Protection**: `ResearchEngine` blocks private IPv4/IPv6/loopback/CGNAT/link-local ranges, resolves DNS before fetching, re-validates redirects manually, and streams responses with a strict byte ceiling; `KnowledgeVault` and Web UI allowlist `http:`/`https:` links and escape all interpolated HTML.
- **Webhook & IM Auth**: Constant-time token/HMAC verification with 5-minute replay windows (Slack/DingTalk), channel-type enforcement, and secret redaction across API responses and disk metadata.
- **Automated Security Gate**: Run `npm run audit` (`node bin/yunyu.mjs audit`) locally or in CI to catch hardcoded secrets, `eval`/`new Function`, unsafe shell interpolation, circular dependencies, and external dependency drift.

## Reporting a Vulnerability

Please open a private security advisory or report at [https://github.com/yunyu-x/yunyu-teamwork/issues](https://github.com/yunyu-x/yunyu-teamwork/issues) without posting live credentials or exploit targets publicly.
