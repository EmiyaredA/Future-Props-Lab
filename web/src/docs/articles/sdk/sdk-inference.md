<!-- docs: {"group": "sdk-runtime", "category": "sdk", "order": 5, "title": "独立调用模型", "lead": "通过 inference 模块调用模型，不需要先创建测试会话或工坊项目。任务与素材按当前 Workspace 隔离。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-quickstart", "sdk-errors"]} -->

# 独立调用模型

通过 inference 模块调用模型，不需要先创建测试会话或工坊项目。任务与素材按当前 Workspace 隔离。

## 查询能力与生成文本

```python
options = client.inference.model_options()
result = client.inference.generate_text(body={
    "model_id": model_id,
    "messages": [{"role": "user", "text": "写一句场景描述"}],
})
print(result.text, result.log_id)
```

先查询模型实际支持的模态和参数范围。独立调用复用平台适配器、额度与调用日志；供应商密钥不传给 SDK。

## 生成多媒体

```python
from uuid import uuid4

task = client.inference.create_task(body={
    "request_id": str(uuid4()), "model_id": image_model_id, "kind": "image",
    "parameters": {"prompt": "一座安静的海边灯塔", "size": "1024x1024"},
})
result = client.wait_for(lambda: client.inference.get_task(task_id=task.id), task_id=task.id)
with client.inference.download_result(task_id=result.id) as download:
    download.save("lighthouse.png")
```

kind 支持 image、video、music、sound_effect 和 transcription，具体可用性以 options 为准。size 需选择该模型返回的合法值。生成输入通过私有 assets 上传；parameters 中的素材引用与顶层 asset_ids 必须一致。

## 私有素材与结果

上传素材返回输入 ID。每份多媒体输入由一个任务认领，需要再次使用时重新上传或从公共文件导入副本。语音识别要求一份音频，并按模型检查格式和大小。

任务结果默认保存在独立调用区域。通过 save_result 显式转存到文件管理，再由工坊引用。文本和任务执行记录可在调用日志查看。
