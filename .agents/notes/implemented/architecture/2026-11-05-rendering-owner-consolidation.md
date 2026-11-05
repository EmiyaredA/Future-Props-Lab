# Agent Note: 本地媒体执行归属与并发生命周期

Status: implemented

## Problem

确定性帧、FFmpeg 任务、字体和 PDF 工作者仍在旧能力包，媒体应用依赖旧目录。
预览元数据还按事件循环缓存全局信号量，导致不同装配实例共享并发状态。

## Decision

本地执行实现归 `studio.apps.media_rendering.local`，移除旧包和聚合转发。
路径型渲染计划留在本地 I/O 边界，不放进跨服务契约。
可进入其他服务镜像的本地适配模块逐项登记于 `studio.deployment.media_modules`，
并禁止其加载业务 ORM、配置、装配和其他应用实现。Assets 仍只接受原有 GIF 子集。

`LocalMediaProcessor` 使用装配实例的 `MediaPreviews.capacity` 限制昂贵处理，元数据层
不再另持全局信号量。借用结束、输出授权、原子缓存替换和取消清理保持原约定。
字体 LFS 路径、资源清单、PDF 子进程模块、构建闭包和消费者同步调整。

## Alternatives considered

- 将渲染放进通用 runtime：其输出格式和确定性渲染规则属于媒体应用，不符合所有权。
- 放开整个媒体应用的跨服务访问：会使业务存储也进入外部镜像，采用逐模块白名单。
- 保留全局信号量：生命周期仍耦合，改由显式构造实例持有。

## Consequences

本批移除旧 `app.capabilities.media_rendering`，未改变 HTTP、持久格式或历史迁移。
网站历史导出仍有调用本地 I/O 接口的适配代码；其他业务端口和状态机的解耦继续独立验收。

## Verification

- 媒体、实际 PDF/视频预览、取消、帧采样、架构和打包回归：147 passed。
- 实例容量测试验证占满、独立实例继续运行、取消释放及等待任务恢复。
- 23 个服务源码闭包通过；Git LFS fsck 通过。
- 下游 Galgame、特效、头像和视觉上传回归：69 passed；OpenAPI stale check 通过。
