---
name: security-review
description: 深度安全复核技能：核查 XSS、SSRF、命令注入、路径穿越、密钥泄露与权限边界
tags: [security, audit, review, xss, ssrf, owasp]
triggers: [安全, 审计, 复核, review, audit, 漏洞, xss, ssrf]
roles: [reviewer, verifier, architect]
---
# 安全代码复核清单（Security Review Skill）

1. **命令与参数注入**：严禁在 Windows `shell: true` 下拼接外部输入，禁止 `execSync` 模板插值，优先使用 `execFileSync` / `spawn` 数组参数。
2. **路径穿越与符号链接**：所有文件操作必须先规范化 `..` 并校验 `fs.realpathSync` 严格位于允许根目录内。
3. **SSRF 与 XSS**：外部 URL 必须校验协议为 `http/https`、拦截私有 IPv4/IPv6/DNS 与重定向跳转；前端渲染必须先转义 HTML 并校验 `href` 协议。
4. **密钥脱敏**：禁止在日志、API 响应或磁盘明文中暴露 `token` / `secret` / `apiKey` / `Authorization`。
