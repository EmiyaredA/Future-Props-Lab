<!-- docs: {"group":"integrations","order":5,"title":"集成验证失败排查","lead":"按格式、认证、网络和版本冲突分层定位。","evidence":["web/src/features/integrations/IntegrationCenterPage.tsx","web/src/features/integrations/ToolApiPanel.tsx","web/src/features/integrations/McpPanel.tsx","web/src/features/integrations/SkillPanel.tsx"]} -->

# 集成验证失败排查

<!-- prerequisites -->

面向空间所有者或平台管理员。先确认目标工作空间和资源来源；普通成员不能管理或验证集成。不要在示例输入中放入真实凭证。

按格式、认证、网络和版本冲突分层定位。

## 先记录失败位置

确认是在保存表单、上传包还是执行验证时失败。保存失败通常先检查必填项和 JSON；验证失败先检查服务连通性与认证；Skill 导入失败先检查压缩包结构。

## 对照处理

| 现象               | 处理                            |
| ------------------ | ------------------------------- |
| JSON 无效          | 去掉尾逗号，检查引号与对象结构  |
| 认证失败           | 核对认证方式、请求头名和凭证    |
| MCP 命令不允许     | 请部署管理员核对允许列表        |
| Skill 包不符合要求 | 检查根 SKILL.md、大小和包内路径 |
| 配置被其他操作更新 | 刷新后重新编辑最新条目          |

## 提供排障资料

提供条目名称、传输或请求类型、失败时间和脱敏错误摘要。不要附上完整密钥或含凭证的请求头。
