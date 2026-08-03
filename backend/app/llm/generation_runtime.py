from __future__ import annotations

import asyncio

# 图片、视频生成无论来自视觉工坊还是模型测试，共享同一个远端请求并发上限。
generation_semaphore = asyncio.Semaphore(4)
