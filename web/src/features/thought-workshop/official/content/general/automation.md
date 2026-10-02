# SDK/API 使用指南

Python SDK 独立于后端运行时，支持同步与异步客户端。通过正式 API 操作项目，避免直接读写 SQLite 或磁盘项目文件。

## 安装与连接

源码环境可执行 `pip install ./sdk/python`，需要 Python 3.11 或更高版本。HTTP 客户端的 `base_url` 指向服务根地址，不包含 `/v1`；Management API Key 决定 Workspace 和权限。

下面创建一份默认文稿。示例中的地址用于独立 HTTP 部署；桌面私有连接应使用本地 Agent 配对流程，而不是开放桌面后端端口。

```python
import os
from future_props_lab import Client
from future_props_lab.builders import presentation_document

with Client(
    base_url="http://127.0.0.1:9000",
    api_key=os.environ["FPL_MANAGEMENT_API_KEY"],
) as client:
    project = client.presentation.create_project(
        body={"title": "自动化文稿", "document": presentation_document()}
    )
    print(project.id, project.revision)
```

不要把真实凭证写入示例。创建后的作品可在当前空间的演示工坊查看。

## 读取再写入

修改前先读取资源，用当前 revision 提交写入。缺少版本返回 422，冲突返回 409 和当前快照。遇到冲突时保留意图、读取最新版本、明确决定如何合并；不自动覆盖或重复同一写请求。

业务请求无需提交 `workspace_id`。文件上传成功后，再把返回的素材 ID 传给对应业务操作，不能使用其他空间的 ID。

## 任务与流

流式响应可能在途中断开，后台任务也可能已经提交。重新连接后先查询任务和结果，再决定重试。结果保存失败优先恢复结果，避免额外模型费用。

AsyncClient 适用于异步程序。仅对独立读操作并行；有版本依赖的编辑按顺序完成。SDK 方法完整参考仍可在现有文档中心查看，这份指南维护业务流程与使用边界。
