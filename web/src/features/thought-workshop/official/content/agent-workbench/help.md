# Agent 工作台：排查连接与解锁

先区分 Studio 入口、FPL 解锁、Relay 和 Runner 状态，再恢复连接。

## 操作与核验

1. 若页面提示从 Studio HTTPS 登录，打开提示中的链接并重新登录。云控加载后再次验证管理员密码。
2. 若页面提示 Happier 暂不可用，在 Relay 恢复后点「重试」。如果工作台能打开但机器离线，检查 Runner 是否已配对和运行。
3. 独立 Compose 的云控提供远程桌面。要使用 Happier，请进入已部署的日常网站。

## 相关阅读

- [打开 Happier 工作台](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/overview)
- [配对并开始会话](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/workflow)
