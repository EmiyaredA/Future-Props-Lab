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

## 视觉工坊输出版本删除

`visual.delete_node_output` 要求 `project_id`、`node_id`、`output_id` 和当前画布的
`expected_revision`，返回更新后的画布。人工上传（`source=uploaded`）的最终版可以删除，
服务端自动切换至剩余编号最大的版本，或在没有版本时清空输出；后续新增版本不复用编号。
被固定引用的版本返回 409，须先解除引用；其他来源的最终版须先切换最终输出。
删除不清理托管文件或改写已有任务快照。版本冲突由调用者处理，不自动重放删除。

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

## 演示工坊原生信息图

演示文稿当前为 `version: 2`，读取与写入仍接受旧版 1 并确定性规范化。每页保留
`elements`，新增 `groups`、`connections`、`infographics` 和编辑参考图 `reference`。
参考图是受 Workspace 校验和引用保护的托管素材，不进入放映或 PPTX。

Agent 通过现有 `presentation.get_project`、`put_project` 和
`apply_presentation_operations` 写入同一原生结构。AntV 源码在浏览器预览和转换；
服务端不会执行源码，也没有新增 JavaScript 渲染服务。

```python
import uuid

project = client.presentation.get_project(project_id=project_id)
# fragment 是完整原生页面片段：id 与唯一根组 ID 相同，包含所有必填元素字段，
# elements/groups/connections/infographics 自洽，reference 和 image_asset_id 必须为空。
result = client.presentation.apply_presentation_operations(
    project_id=project_id,
    body={
        "expected_revision": project.revision,
        "request_id": str(uuid.uuid4()),
        "operations": [{
            "entity": "fragment", "action": "insert",
            "id": fragment["id"], "parent_id": slide_id,
            "fragment": fragment,
        }],
    },
)
```

`fragment` 支持 `insert/update/remove`，更新与删除的 ID 指向根组；整批原子校验，
相同 request_id 与请求体可重放回执。替换会删除旧组及其成员和关联边，再插入新对象。
直接插入须提供文稿内唯一 ID；复制页面由服务端统一重映射所有子对象与连接。
`group`、`connection`、`infographic` 可单独批量编辑；删除组表示解组并将成员交还父级，
删除节点会清理关联边，移动节点会清理过时的布局折点。非法引用、循环组、跨 Workspace
素材和版本冲突不会部分落盘。PPTX 使用可编辑文本、原生组和绑定端点的连接线。

每页可选 `image_asset_id` 归档一张原始生成图，值为当前 Workspace 公共文件库的图片 ID，
默认为 `None`。它与参考图独立，参与素材删除保护；复制页面保留关联，清空或替换不会删除源文件。
图像版本不进入画布、放映或 PPTX。先用文件上传 API 取得素材 ID，再通过现有批量编辑更新页面：

```python
project = client.presentation.get_project(project_id=project_id)
result = client.presentation.apply_presentation_operations(
    project_id=project_id,
    body={
        "expected_revision": project.revision,
        "request_id": str(uuid.uuid4()),
        "operations": [{
            "entity": "slide", "action": "update", "id": slide_id,
            "value": {"image_asset_id": image_asset_id},
        }],
    },
)
assert next(s for s in result.document.slides if s.id == slide_id).image_asset_id == image_asset_id
```

调用者需要文稿编辑权限；缺少素材或跨空间返回 404，revision 过期返回 409，原文稿不变。
移除归档时将 `image_asset_id` 设为 `None`；整篇 `put_project` 也使用相同字段与校验。

## 外部 Code Agent 的 stdio MCP

桌面版开启本地接入后，运行 `fpl --profile codex connect --name Codex` 并在 App 核对配对码与空间。默认只读；需要编辑时使用独立 profile 显式添加 `--write`。Codex、Claude Code 可使用命令 `fpl --profile codex mcp serve`，连接配置可在“基模型 → 编程智能体”复制。该入口不依赖后端 Python 包。

工具 `operations` 列出白名单或查看单个操作的参数 Schema；`call` 使用 SDK 关键字参数执行，读取最新 revision 后再修改，不自动重试；`open` 定位已授权资源并保留未保存保护。上传文件通过 `call.files` 显式传递 field 与 path；小文件下载返回 Base64，大文件使用 `fpl call --output`。撤销客户端仍在 App 的 API 密钥页完成。
