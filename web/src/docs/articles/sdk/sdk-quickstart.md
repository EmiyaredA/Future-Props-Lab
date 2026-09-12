<!-- docs: {"group": "sdk-start", "category": "sdk", "order": 0, "title": "从第一段自动化开始", "lead": "用 Python 创建一份文稿，读取其版本，再通过正式 API 编辑。代码创建的作品可在演示工坊打开。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-auth", "sdk-editing"]} -->

# 从第一段自动化开始

用 Python 创建一份文稿，读取其版本，再通过正式 API 编辑。代码创建的作品可在演示工坊打开。

## 安装与连接

在仓库根目录执行 `pip install ./sdk/python`。SDK 支持 Python 3.11+；独立安装不需要数据库、后端源码或 Web 依赖。当前版本与本仓库服务端一起验证，升级服务端时同步检查 SDK 版本。

```python
import os
from future_props_lab import Client
from future_props_lab.examples import create_deck, update_slide_notes

with Client(base_url="http://127.0.0.1:9000", api_key=os.environ["FPL_MANAGEMENT_API_KEY"]) as client:
    project = create_deck(client)
    updated = update_slide_notes(client, project, "这段备注来自自动化脚本")
    print(updated.id, updated.revision)
```

`base_url` 指向服务端根地址，不包含 `/v1`。密钥绑定单一 Workspace，不在业务请求中传入 workspace_id。

## 使用异步客户端

```python
import asyncio
import os
from future_props_lab import AsyncClient
from future_props_lab.examples import create_deck_async

async def main():
    async with AsyncClient(base_url="http://127.0.0.1:9000", api_key=os.environ["FPL_MANAGEMENT_API_KEY"]) as client:
        project = await create_deck_async(client)
        print(project.id)

asyncio.run(main())
```

这些辅助函数随 SDK 分发，并在隔离 API 测试中调用。下一步可阅读认证、批量编辑和各工坊的方法参考。
