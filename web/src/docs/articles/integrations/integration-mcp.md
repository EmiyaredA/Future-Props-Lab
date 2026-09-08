<!-- docs: {"group":"integrations","order":3,"title":"MCP 连接与工具发现","lead":"配置远程 HTTP 服务或受允许的本机命令。","evidence":["web/src/features/integrations/IntegrationCenterPage.tsx","web/src/features/integrations/ToolApiPanel.tsx","web/src/features/integrations/McpPanel.tsx","web/src/features/integrations/SkillPanel.tsx"]} -->

# MCP 连接与工具发现

<!-- prerequisites -->

面向空间所有者或平台管理员。先确认目标工作空间和资源来源；普通成员不能管理或验证集成。不要在示例输入中放入真实凭证。

配置远程 HTTP 服务或受允许的本机命令。

## 选择传输方式

在“集成中心 → MCP”创建连接。Streamable HTTP 用于服务地址；stdio 用于运行主机上的命令，不是用户浏览器所在电脑的命令。

![MCP 连接配置表单](/docs/integration-mcp-form.jpg "真实界面 · 隔离演示数据；合成素材或本机确定性响应，不代表外部模型效果。")

## 验证连接

1. 填写名称与传输对应的地址或命令参数。
2. 配置服务要求的认证信息。
3. 保存后执行验证。
4. 查看发现的工具、状态和错误信息。

## 本机命令限制

stdio 命令必须满足部署端允许列表及绝对路径要求。不能通过随意填写命令绕过部署设置。网络失败先核对运行主机是否能访问远端地址；认证失败检查凭证。

发现工具不等于授权执行所有工具，实际调用仍取决于应用入口。
