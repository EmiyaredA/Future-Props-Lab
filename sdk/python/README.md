# Future Props Lab Python SDK

Python 3.11+。从仓库安装：`pip install ./sdk/python`。

```python
import os
from future_props_lab import Client

with Client(base_url="http://127.0.0.1:9000", api_key=os.environ["FPL_MANAGEMENT_API_KEY"]) as client:
    projects = client.visual.list_projects()
    print(projects)
```

`AsyncClient` 提供相同资源和方法，普通请求使用 `await`。密钥绑定工作区；账号治理使用
无密钥客户端的 `accounts.login(body=...)`，需要二次验证时显式调用 `accounts.reauth`。
Session 仅在客户端内存中保存。并发访问不同工作区时请创建不同客户端。

所有写入与模型提交默认不自动重试。修改内容时携带读取到的 revision；冲突异常保留服务器
快照。任务等待超时不会取消任务。下载和事件流必须使用上下文管理器关闭。

完整说明见平台文档中心的「Python SDK」分类。该版本随同仓库服务端契约交付；
`operations.json` 记录每个稳定方法与 HTTP 操作的对应关系。
