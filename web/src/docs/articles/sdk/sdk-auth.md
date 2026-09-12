<!-- docs: {"group": "sdk-start", "category": "sdk", "order": 1, "title": "认证、账号与工作区", "lead": "同一份 SDK 支持工作区密钥和登录 Session。权限由服务端身份决定，SDK 不会自动提升权限。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-quickstart", "sdk-errors"]} -->

# 认证、账号与工作区

同一份 SDK 支持工作区密钥和登录 Session。权限由服务端身份决定，SDK 不会自动提升权限。

## 工作区密钥

在账号中心创建 Management API Key，将明文通过进程环境变量传入 `Client` 或 `AsyncClient`。仅查看内容时使用只读范围。密钥失效、撤销、所属账号停用或工作区权限变化后，调用会返回认证或权限错误。

SDK 不将凭证写入磁盘，不在客户端 repr 中展示密钥。不要把真实凭证写入脚本、文档、提交记录或异常采集内容。

## 通过代码登录

```python
from getpass import getpass
from future_props_lab import Client

with Client(base_url="http://127.0.0.1:9000") as client:
    me = client.accounts.login(body={"username": "your-account", "password": getpass()})
    # 敏感操作前显式二次验证；SDK 不保留密码用于自动重试。
    client.accounts.reauth(body={"password": getpass()})
```

客户端在内存中管理 Cookie，并为写请求附加对应的 CSRF 和 Origin。关闭客户端释放连接；需要立即撤销会话时先调用 logout。账号要求首次改密时，先完成 change_password。

## 空间与并发

API Key 的空间固定。Session 切换工作区通过 workspaces 模块的显式方法完成；不要在仍有并发请求的同一客户端上切换空间。多个空间的并发作业使用独立客户端。

创建账号、修改授权、签发密钥和公开展台等操作保持原有 Session 与二次验证要求。实时语音同样需要 Session。
