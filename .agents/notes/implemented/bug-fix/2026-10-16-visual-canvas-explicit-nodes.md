# Agent Note: 画板替换必须显式提供节点

Status: implemented

## Problem

视觉工坊整份画板 PUT 将缺少的 nodes 默认为空列表。只传分类和正确 revision 的 SDK 请求因此可以清空节点、连线与节点输出历史，素材文件仍保留。CAS 只能防止过期写入，无法表达调用者是否明确要求删除。

## Decision

VisualCanvasDocumentPutIn 要求显式提供 nodes。缺失字段在请求校验阶段返回 422，不进入事务；显式空列表继续表示主动删除。分类修改携带最新完整节点和连线，遵守现有 CAS，不新增隐式 PATCH 语义。OpenAPI 与 Python SDK 同步生成必填字段。

## Alternatives considered

- 将缺少节点解释为局部更新：改变整份替换语义，并要求合并后重新验证引用图；本次采用明确拒绝以消除歧义。
- 仅修复制作脚本：其他 SDK 调用者仍会遭遇相同的数据丢失风险，因此同时收紧正式接口。

## Consequences

旧调用者若仅传分类会收到 422，需先读取画板并传回原节点和连线。显式清空、已有前端完整保存与增量 operations 保持原行为。本次恢复通过已配对 SDK、当前 revision 和清空前一版快照执行，不直接修改持久数据库；历史输出标识由服务器重新生成。

## Verification

tests/apps/visual_workshop/test_visual_canvas_replace_safety.py 验证带媒体输出与连线的画板拒绝 metadata-only PUT，且 revision、图和输出历史不变；完整分类更新保留内容，显式空图仍可删除并保留素材。相关视觉工坊、SDK 与契约检查覆盖兼容路径。
