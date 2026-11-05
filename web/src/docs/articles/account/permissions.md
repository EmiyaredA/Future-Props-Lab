<!-- docs: {"group": "account", "order": 4, "title": "角色与操作权限", "lead": "角色与操作权限的当前操作与授权边界。", "evidence": ["web/src/features/accounts/AccountPanel.tsx", "backend/studio/contracts/identity/principal.py", "tests/test_account_owned_data.py"]} -->

# 角色与操作权限

## 两种平台角色

管理员维护平台账号、模板分配和授权，普通用户使用当前账号获准的业务能力。业务资源归属和角色权限分别校验：管理员也没有读取其他账号私人项目、素材、模型凭证或会话的权限。不存在空间所有者、工作区管理员或成员角色。

## 判断能否操作

以当前账号的有效权限和页面反馈为准。读写请求仍验证资源归属，跨账号 ID 按不存在处理。界面隐藏按钮不代替服务端权限检查；资料或账号状态被修改后，旧 Session 和 Management API Key 可能被撤销。

模型供应商 API Key 用于调用外部模型，Management API Key 用于调用本部署登记的业务 API。前者不提供平台管理权限，后者也不能调用仅限浏览器 Session 或桌面私有宿主的操作。知识社区的文章角色独立验证，不开放源账号其他资源。
