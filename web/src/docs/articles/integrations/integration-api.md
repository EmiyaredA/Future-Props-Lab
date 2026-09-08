<!-- docs: {"group":"integrations","order":2,"title":"工具 API 配置与验证","lead":"登记请求地址、认证方式和参数结构。","evidence":["web/src/features/integrations/IntegrationCenterPage.tsx","web/src/features/integrations/ToolApiPanel.tsx","web/src/features/integrations/McpPanel.tsx","web/src/features/integrations/SkillPanel.tsx"]} -->

# 工具 API 配置与验证

<!-- prerequisites -->

面向空间所有者或平台管理员。先确认目标工作空间和资源来源；普通成员不能管理或验证集成。不要在示例输入中放入真实凭证。

登记请求地址、认证方式和参数结构。

## 填写配置

在“集成中心 → 工具 API”创建条目。输入名称、说明、请求方法和“HTTPS 或本机回环 URL”。

| 配置             | 用途                       |
| ---------------- | -------------------------- |
| 无认证           | 不附加密钥                 |
| Bearer Token     | 按 Bearer 方式发送凭证     |
| API-Key Header   | 使用指定请求头名称         |
| 参数结构         | 声明工具输入的 JSON Schema |
| 查询及请求体模板 | 组织实际请求参数           |

![工具 API 配置表单](/docs/integration-api-form.jpg "真实界面 · 隔离演示数据；合成素材或本机确定性响应，不代表外部模型效果。")

## 保存与验证

JSON 字段提示“请输入有效 JSON”时先修正格式。保存后执行验证，观察正常、异常或未验证状态及详情。

## 更新凭证

编辑条目时不会回显已保存密钥。区分保留原凭证、提供新凭证和显式清除，避免把空输入误当成删除认证。外部接口的验证应针对可控服务进行。
