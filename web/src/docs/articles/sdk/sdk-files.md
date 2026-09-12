<!-- docs: {"group": "sdk-runtime", "category": "sdk", "order": 7, "title": "文件、任务与分页", "lead": "上传、下载和后台任务使用不同生命周期。显式关闭文件与响应，可以让长时间批处理保持稳定。", "evidence": ["sdk/python/src/future_props_lab", "sdk/python/operations.json"], "related": ["sdk-quickstart", "sdk-errors"]} -->

# 文件、任务与分页

上传、下载和后台任务使用不同生命周期。显式关闭文件与响应，可以让长时间批处理保持稳定。

## 上传文件

```python
with open("reference.png", "rb") as source:
    asset = client.inference.upload_asset(
        body={}, files={"upload": ("reference.png", source, "image/png")},
    )
```

公共文件使用 files 模块，独立模型输入使用 inference 模块。根据具体接口把表单字段放进 body；文件内容放进 files。上传失败时不要直接向运行目录补写文件。

## 等待与恢复查询

wait_for 接受读取任务的函数、task_id、timeout 和 interval。返回 completed 任务；失败抛出 TaskFailed，超时抛出包含 task_id 的 TaskTimeout。

超时仅结束等待，不取消任务，也不重新提交。之后可用 get_task 继续查看。retry_materialization 只处理已获取结果地址但下载落盘失败的任务，与重新生成不同。

## 遍历分页

```python
from future_props_lab.pagination import iter_pages

for task in iter_pages(client.inference.list_tasks, limit=30):
    print(task.id, task.status)
```

iter_pages 和 aiter_pages 用于 offset/limit 接口。其他接口仍保留 page/page_size 或 cursor 的原有语义，按模块参考传参；不要把不同分页参数混用。

## 内容转换与导出

思绪可先用 `thought.convert_markdown` 将 Markdown 转成保存文档，再通过 `create_note` 创建；
已保存文档用 `export_note_content` 导出 Markdown 或静态 HTML。包含附件时返回 ZIP。
文件映射必须指向当前工作区的素材，不会自动访问 Markdown 中的远程地址。

`files.crop_file_image` 按原图完成 EXIF 方向修正后的像素坐标裁剪，保留透明度并返回 PNG；
`files.extract_video_frames` 按毫秒位置返回 ZIP，或为四帧／九帧生成宫格。
这些转换保留原素材，返回的下载流使用上下文管理；需要公共文件副本时再显式上传。

录音标注用 `download_segment_audio` 裁切已保存片段，或用 `transcribe_saved_segment` 识别。
识别结果不会自动覆盖标注；检查结果后通过带 revision 的批次保存。
`export_annotation` 支持 JSON 与 SRT；SRT 要求片段已有说话人和原文。

[运行六个工坊的创建、编辑和导出样例](?page=sdk-workflow-examples)。
