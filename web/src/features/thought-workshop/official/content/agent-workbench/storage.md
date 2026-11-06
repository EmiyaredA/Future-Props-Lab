# Agent 工作台：设备密钥与旧会话归档

Happier 的设备密钥保护新会话。旧 FPL 会话随停机快照归档，可用对应部署版本恢复。

## 操作与核验

1. 用独立浏览器从已解锁的 Studio HTTPS 入口打开 Happier，按原生恢复流程输入已保存的恢复密钥。确认能读回原来的加密会话。
2. 旧 FPL 链接会进入云控 Agent 页签。需要查阅旧记录时，由部署者用封存清单恢复到隔离目录，再用归档对应的版本核对账号和会话。

## 相关阅读

- [打开 Happier 工作台](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/overview)
- [排查连接与解锁](/apps/thought-workshop/official-knowledge-bases/agent-workbench/documents/help)
