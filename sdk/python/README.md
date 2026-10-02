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

## 笔记信息图

`future_props_lab.canvas_example.thought_canvas_example` 提供可执行的异步例子：
调用者传入已有个人知识库 ID、导出路径，以及可选的已上传公共文件库图片 ID。
它读取知识库修订号，通过正常 `thought.create_note` 创建包含 `canvas` 节点的笔记，
再导出 Markdown；不修改官方知识库，不绕过 Workspace 权限，也不重试创建。

画板节点为 `{"type":"canvas","attrs":{"scene": ...}}`，场景使用 `sceneVersion: 1`，
包括 `title`、`elements`、`edges`。元素坐标为绝对坐标，分区成员通过 `parentId` 关联；
图片仅引用 `assetId`。新保存正文使用 `schema_version: 3`，读取兼容 version 2；
画板 `sceneVersion: 2` 新增字号、文字对齐与四侧锚点，仍接收示例中的 version 1。
已有笔记通过读取最新 revision 后调用 `thought.put_note` 保存，冲突必须由调用者处理。

Markdown 的 `fpl-canvas` 代码块保留编辑数据；普通 Markdown 阅读器显示源码。
含图片的导出为 ZIP，图片路径通过 Markdown 转换接口的 `assets` 映射到目标 Workspace
新上传的图片 ID。完整备份同时保存历史与图片并在恢复时重映射 ID。
服务端 HTML 导出将画板绘成离线 SVG，并保留既有 Mermaid 源码输出；应用内 HTML 导出
同时提供渲染后的 Mermaid SVG。

服务端 Markdown 转换仍限制为 200,000 字符；笔记正文 JSON 上限为 2 MiB。
大型画板建议使用完整备份保留编辑数据、素材和历史，不依赖 Markdown 转换进行恢复。

## 文档引用、复用与阅读状态

`thought.resolve_references`、`thought.note_backlinks` 与 `thought.global_search` 提供当前 Workspace
引用解析、反向链接和全文检索。`thought.create_template` 保存独立模板；
`thought.apply_template` 校验模板和目标库版本后创建文档。
复制先读取 `thought.copy_snapshot`，再用该快照的源库和各文档版本调用
`thought.duplicate_document`；409 后重新读取并确认，不自动重试。

`thought.create_checkpoint` 将名称绑定到不可变历史；改名或删除标记不删除历史。
`thought.library_export_snapshot` 返回整库一致快照，浏览器使用它生成离线 HTML ZIP。
备份 version 6 保存历史、模板、快照标记和素材，接受旧版本并重映射 ID。
`thought.saved_filters`、`thought.recently_visited` 和 `thought.record_reading` 属于当前账号，
只读成员也可维护个人状态；个人偏好不会进入备份。本机未保存草稿由浏览器 IndexedDB 管理。
