# Agent Note: 特效导出投递与恢复

Status: implemented

## Problem

特效项目的多格式导出要保持原有请求 ID、文档版本和取消行为。分离素材、项目和渲染的数据库后，重试或重启仍须关联同一个任务，并按相同的输入字节渲染。

## Decision

Motion 在文档 CAS 和请求 ID 约束下同时提交公开任务和投递记录。Rendering 用请求、项目、文档窗口和素材 revision 组成的签名范围接收原件，落盘后才写入队列。Rendering 重启后从自己的文件恢复执行。队列控制和文件下载另用只挂载给 Motion 与 Rendering 的凭据。任务执行前、渲染中和发布前检查原授权。Motion 项目删除后保留投递记录直到远端确认清理。

## Alternatives considered

在请求内直接等待整段编码会把浏览器连接绑定到长任务，也无法复用持久回执。让 Rendering 直接读 Motion 或 Assets 卷会绕过数据归属和版本校验。

## Consequences

已封存的原件随任务完成清理，成片由 Rendering 持有。历史导出文件仍需经过正式迁移。剪辑交接属于单独操作。

## Verification

独立服务用例覆盖原始 OpenAPI、同请求重放、丢失回执、重启、取消和跨账号访问。兼容站测试覆盖同一编码器的三种输出格式。
