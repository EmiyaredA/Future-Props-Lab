<!-- docs: {"group":"api-modules","category":"api","order":33,"title":"已移除的工作空间接口","lead":"旧工作空间 SDK 模块已由账号归属替代，保留本页用于解释旧链接。","evidence":["sdk/python/operations.json","tests/test_account_owned_data.py"],"related":["sdk-auth","sdk-errors"]} -->

# 已移除的工作空间接口

## 当前归属规则

当前 SDK 不再提供 client.workspaces，旧空间切换、成员和动态权限接口已移除。项目、素材和凭据归当前验证账号，不通过 workspace_id 或默认空间回退。

## 迁移与恢复

旧布局通过登记迁移映射到唯一活动 Owner，原 Session 与密钥撤销后重新登录并创建新凭据。无法确定唯一归属时拒绝迁移；保留完整运行目录与配置备份，不改写历史迁移、账号归属或凭据记录。
