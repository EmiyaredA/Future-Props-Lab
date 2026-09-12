<!-- docs: {"group": "sdk-workshops", "category": "sdk", "order": 3, "title": "细粒度编辑与批量提交", "lead": "通过稳定对象 ID 修改内容；一次操作批次只针对一个作品资源，在服务端校验后一次提交。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-quickstart", "sdk-errors"]} -->

# 细粒度编辑与批量提交

通过稳定对象 ID 修改内容；一次操作批次只针对一个作品资源，在服务端校验后一次提交。

## 构造编辑批次

```python
from future_props_lab.builders import edit_batch, entity_edit

batch = edit_batch(project.revision,
    entity_edit("slide", "update", slide_id, value={"notes": "新的备注"}),
    entity_edit("element", "update", element_id, parent_id=slide_id,
                value={"x": 120, "y": 80}),
)
updated = client.presentation.apply_presentation_operations(project_id=project.id, body=batch)
```

同一批次按顺序应用操作，最后统一校验并增加一次 revision。任一操作失败，整批不保存。删除素材仍受引用保护。

## 支持的操作

insert 创建指定 ID 的对象；update 更新提供的字段；remove 删除；move 调整集合内顺序；duplicate 使用 value.id 指定副本 ID。不同工坊的合法实体与结构由对应接口说明。

视觉节点位置属于 position，演示元素位置属于 x/y。修改嵌套对象时提交该字段的完整合法值。不能通过 update 更换对象 ID。

## 跨工坊流程

每一步保存返回的项目、素材或任务 ID，并显式传给下一步。多个 HTTP 请求不构成同一个数据库事务。模型生成与作品编辑分别提交；生成完成后再引用产物，可避免脚本退出导致无法查找结果。
