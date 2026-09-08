<!-- docs: {"group":"account","order":7,"title":"管理 API Key","lead":"为自动化访问创建绑定当前空间的密钥。","evidence":["web/src/features/accounts/AccountWorkspacePanel.tsx","backend/app/accounts/principal.py"]} -->

# 管理 API Key

<!-- prerequisites -->

面向登录用户。开始前确认当前账号和工作空间；成员管理与空间设置需要所有者或平台管理员权限，账号治理仅限平台管理员。

为自动化访问创建绑定当前空间的密钥。

## 创建密钥

进入账号面板“安全与密钥”，找到“Management API Key”。

1. 填写能说明用途的“密钥名称”。
2. 只在确实需要时勾选“允许写入当前 Workspace”。
3. 点击“创建 90 天密钥”。
4. 立即点击“复制密钥”，保存到受控的凭证存储。

## 使用范围

密钥绑定创建时的工作空间，之后切换浏览器空间不会改变该密钥归属。只读密钥不能用于写请求；密钥也不会绕过服务端权限校验。

## 过期与撤销

列表展示前缀、权限、到期时间和撤销状态。泄露或不再使用时点击“撤销”。密钥明文仅显示一次，遗失后创建新密钥并撤销旧密钥。

> 不要把 Management API Key 填到模型供应商的 API Key 字段。
