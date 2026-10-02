# SDK/API 使用指南

需要批量整理作品或由 Agent 执行可复核的编辑时，使用正式 SDK/API。本篇用创建文稿示例说明连接方式，再给出读取、写入、查询结果与下载的基本顺序。

## 开始前

- Python 3.11 或更高版本；源码环境可执行 `pip install ./sdk/python`。
- 可访问的服务根地址和绑定目标 Workspace 的 Management API Key。
- 清楚本次要创建还是修改资源，并有对应权限。

HTTP 客户端的 `base_url` 不包含 `/v1`。桌面私有连接使用本地 Agent 配对流程，不需要通过开放桌面后端端口来连接。

## 创建一份能在界面找到的文稿

下面适用于独立 HTTP 部署。把服务地址设为实际地址，并通过环境变量提供自己的凭证。

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

将代码保存为 `create_deck.py`，确认 `FPL_MANAGEMENT_API_KEY` 已在当前进程环境中设置，在安装 SDK 的同一 Python 环境运行 `python create_deck.py`。预期终端输出新文稿 ID 与 revision，不应输出密钥。

运行后切到该 Key 所属 Workspace，在演示工坊找到“自动化文稿”并打开。

**完成标志：** API 返回资源 ID 与版本，界面显示同一份作品。只收到本地脚本打印而没有检查目标空间，容易把测试结果记到错误项目上。

## 修改已有资源的顺序

1. 用正式读取接口获取当前资源及 revision。
2. 在该快照上构造修改，只引用当前空间有权访问的素材。
3. 写入时携带期望版本；收到成功响应后保存新的 revision。
4. 再次读取或在界面打开，确认修改可见。
5. 遇到冲突时保留修改意图，比较新快照后决定如何合并，不自动覆盖。

| 反馈                    | 含义                     | 下一步                         |
| ----------------------- | ------------------------ | ------------------------------ |
| 422，缺少版本或输入无效 | 请求未满足契约           | 修正必填字段或文档结构         |
| 409，版本冲突           | 已有其他更新             | 读取当前快照，明确选择合并方式 |
| 404，资源不存在         | ID、空间或访问范围不匹配 | 核对连接和资源归属             |
| 连接在提交后中断        | 结果是否落地尚未确认     | 先查询原资源或任务             |

## 图片、图表与下载

文件先通过上传接口获得素材 ID，再传给业务操作；不提交 `workspace_id` 试图改变归属，也不复制其他空间的文件 ID。

笔记画板示例位于 `future_props_lab.canvas_example.thought_canvas_example`：传入明确的个人知识库 ID、输出路径及可选公共图片 ID，例子会创建可编辑画板并导出 Markdown。该示例使用兼容的 `sceneVersion: 1`，笔记使用 `schema_version: 2`；场景版本与整篇笔记的版本分别校验。

下载和事件流使用上下文管理器关闭。`AsyncClient` 用于异步程序；独立读取可以并行，有版本依赖的编辑按顺序提交。

> [!NOTE]
> 服务端 Markdown 转换上限为 200,000 字符，笔记正文 JSON 上限为 2 MiB。大型画板要保留素材与历史时使用完整备份。已有模型结果保存失败时先恢复原结果，不重复提交模型请求。

## 相关阅读

- [Workspace 与账号权限](/apps/thought-workshop/official-knowledge-bases/general/documents/accounts)
- [桌面、Amadeus 与本地 Agent](/apps/thought-workshop/official-knowledge-bases/general/documents/desktop)
- [思绪工坊：导入导出与交付](/apps/thought-workshop/official-knowledge-bases/thought-workshop/documents/delivery)
