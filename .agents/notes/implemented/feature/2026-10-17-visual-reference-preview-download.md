# Agent Note: 参考素材预览下载

Status: implemented

## Problem

生成器的参考素材预览弹窗只有关闭操作，用户核对图片、视频或音频后，需要离开预览再寻找下载入口。

## Decision

`ProjectMediaPicker` 的预览弹窗提供「下载」按钮。输入为弹窗正在预览的 `ManagedFile.id`，通过现有文件下载 API 与统一认证客户端获取原文件，消费服务端 Content-Disposition 文件名，再通过短生命周期 Object URL 触发保存并释放资源。下载状态仅属于该弹窗，不持久化，不修改草稿或提交生成任务。

下载中禁用重复点击，失败在弹窗中显示原因并允许手动重试，不自动重试。图片、视频、音频及连线参考共用同一入口，预览是否加载成功不影响下载请求。按钮使用主题变量并提供键盘焦点样式。

## Alternatives considered

- 直接链接下载 API：可以复用画布预览的方式，但绕过统一请求客户端的 API 基址、认证错误与失败反馈处理。
- 下载预览 Object URL：可省一次请求，但会依赖预览加载状态，并失去服务端下载文件名。

## Consequences

下载独立请求原文件，大媒体会在浏览器内存形成 Blob；沿用现有节点下载流程的成本。关闭弹窗不撤回已开始的下载。没有新增 API、持久化或权限规则。

## Verification

- `web/tests/features/visual-reference-preview-download.test.tsx` 覆盖三类媒体的下载文件与名称、重复点击保护、失败重试、资源释放和参考选择保留。
