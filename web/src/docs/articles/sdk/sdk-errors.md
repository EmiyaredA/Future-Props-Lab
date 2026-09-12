<!-- docs: {"group": "sdk-start", "category": "sdk", "order": 2, "title": "错误、版本与请求去重", "lead": "自动化需要区分请求没有成功、任务仍在执行，以及作品版本已变化。SDK 保留这些信息，调用者决定下一步。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-auth", "sdk-editing"]} -->

# 错误、版本与请求去重

自动化需要区分请求没有成功、任务仍在执行，以及作品版本已变化。SDK 保留这些信息，调用者决定下一步。

## 版本冲突

```python
from future_props_lab import RevisionConflict

try:
    updated = client.presentation.apply_presentation_operations(project_id=project.id, body=batch)
except RevisionConflict as error:
    print(error.current)  # 服务端当前快照；检查后重新规划编辑
```

读取作品后使用其 revision 提交。409 不会自动改成最新 revision 重试。省略字段表示保持原值，显式 None 表示请求清空；具体接口仍可禁止清空。Pydantic 模型按实际设置过的字段序列化。

## 请求去重

工坊新增 operations 批次带 request_id，同一资源内相同标识和内容会重放已提交结果。不同内容复用标识返回 idempotency_conflict。重放前仍校验资源存在与当前空间权限。

独立模型任务使用工作区内唯一 request_id，提交后可重复查询该任务。普通创建、删除和模型文本调用不自动重试；不要把网络超时视为服务端没有执行。

## 其他错误

ApiError 保留 status、code、errors 和 current。401 检查会话或密钥，403 检查角色与范围，404 检查资源所属空间，422 检查参数，429 检查额度。网络错误沿用 HTTPX 异常。不要在失败后直接修改数据库。
