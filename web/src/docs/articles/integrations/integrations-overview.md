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

## 从已授权的 App 接入管理

本地 CLI / Python SDK 可读取与管理这三类集成。已有工作区读取授权可查看目录；修改和校验还需
读写授权与配置管理权限，无需重复配对。配置中的凭据只写不读；校验可能发出真实请求或启动
允许的本机服务，打开配置页不会自动执行校验。

外部修改会局部更新目录、概览及详情，并保留搜索和筛选。存在未保存配置、标签或已选择文件时，
页面保留内容并提示外部更新。关闭、切换页面和工作区均经过未保存保护；提交期间请等待完成。
遇到版本冲突时输入不会被覆盖，确认最新内容后再调整提交。
