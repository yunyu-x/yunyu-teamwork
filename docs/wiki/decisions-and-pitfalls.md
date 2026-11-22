<!-- yunyu-wiki slug=decisions-and-pitfalls version=1 category=decision updatedAt=2026-11-22T11:07:02.553Z -->
# 架构决策、情报沉淀与避坑档案
## 1. 共享知识库精选（ADR / 调研报告 / 避坑指南）
### 坑点 13：Windows Git Bash curl 中文请求体 GBK 乱码
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.433Z`
- 摘要：shell curl 发送中文 JSON 被按 GBK 编码，留言板永久保留乱码历史。

### 坑点 14：review 态 Issue 依赖不自动解锁
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.433Z`
- 摘要：上游 Issue 进入 review 态后，依赖它的下游仍被 409 阻塞。

### 坑点 15：kind=defect 消息自动派生缺陷单
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.433Z`
- 摘要：普通讨论消息误标 kind: defect 会自动创建缺陷 Issue。

### 坑点 09：JS 词法解析正则字面量与模板表达式边界
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.432Z`
- 摘要：静态扫描把 /regex/ 误判为除号导致解析错位；安全审计漏掉 ${...} 模板表达式注入面。

### 坑点 10：外部 MCP capabilities 按需枚举防 12s 超时
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.432Z`
- 摘要：极简 MCP Server 仅声明 capabilities: { tools: {} } 且不响应 resources/list，盲发请求导致 12s 超时。

### 坑点 11：插件零信任自声明隔离与符号链接防护
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.432Z`
- 摘要：插件 manifest 自声明 trusted: true 不可信；插件目录内符号链接可逃逸工作区。

### 坑点 12：跨端连接器必须非破坏性 JSON 深度合并
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.432Z`
- 摘要：向 .mcp.json / .gemini/settings.json / opencode.json 同步时整体覆写会丢用户 theme/model/provider 配置。

### 坑点 08：内联 Markdown 代码块与 ** 通配符冲突
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.431Z`
- 摘要：渲染器先做 **bold** 替换会破坏 `code` 内的星号内容。

### 坑点 05：StallMonitor 对自身告警重复触发
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.430Z`
- 摘要：看门狗发帖提醒后未更新游标，下一轮巡检把自己的告警当作新停滞再次触发。

### 坑点 06：Node 22 HTTP Keep-Alive 阻塞进程退出
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.430Z`
- 摘要：keep-alive 连接使 server.close 挂起，进程无法干净退出。

### 坑点 07：浏览器 6 连接池与 SSE 表单覆写
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.430Z`
- 摘要：HTTP/1.1 同域 6 连接上限被多路 SSE 占满；刷新响应会覆写用户正在编辑的表单。

### 坑点 02：Windows 8.3 短路径绕过 worktreeRoot 边界校验
- 分类：`pitfall` · 作者：`@architect` · 时间：`2026-11-22T11:06:54.429Z`
- 摘要：git worktree list 可能输出 ADMINI~1 形式的 8.3 短路径，直接字符串比较会误判越界或漏判。
