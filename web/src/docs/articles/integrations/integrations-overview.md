<!-- docs: {"group":"integrations","order":1,"title":"集成中心概览与权限","lead":"管理空间内的工具 API、MCP 服务和 Skill。","evidence":["web/src/features/integrations/IntegrationCenterPage.tsx","web/src/features/integrations/ToolApiPanel.tsx","web/src/features/integrations/McpPanel.tsx","web/src/features/integrations/SkillPanel.tsx"]} -->

# 集成中心概览与权限

<!-- prerequisites -->

面向空间所有者或平台管理员。先确认目标工作空间和资源来源；普通成员不能管理或验证集成。不要在示例输入中放入真实凭证。

管理空间内的工具 API、MCP 服务和 Skill。

## 三类能力

工具 API 描述 HTTP 请求与参数；MCP 保存服务连接并发现工具；Skill 以 ZIP 版本保存可复用说明和资源。三类条目在集成中心各自的标签页中管理。

## 权限与使用边界

页面显示只读模式时不能管理或验证集成。工具注册或验证通过，表示目录配置满足相应检查，并不代表所有 AI 应用都会自动执行它。具体调用入口必须以应用支持为准。

## 推荐顺序

先明确需要 HTTP 工具、MCP 服务还是 Skill，再创建条目并验证。为条目写清名称、用途和标签，确认后启用；异常条目先禁用，再查找配置原因。
