# 会话复制操作

[English](README.md) | 中文

在会话行的省略号菜单中，复制服务器工作目录、直达会话的网址，或完整的已落盘用户与助手 Markdown 正文。代码块保持原样；不包含工具日志和思考内容，图片使用附件占位文字。链接不携带访问令牌，并沿用服务器的正常访问限制。

本插件需要个人分支中的 `uiWorkspace.registerSessionMenuAction` 扩展接口。在 Web 配置中加载 `dsh-session-actions`，刷新浏览器即可。禁用插件会移除三个菜单项。导出按固定日志截点分页读取，发生错误时不会静默返回不完整历史。剪贴板操作需要受信任的 HTTPS。

使用 `node build.mjs` 构建；使用 `node --test test/*.test.mjs` 测试。
