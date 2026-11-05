# Agent Note: Visual 节点验收的 Mac 执行租约

Status: implemented

## Problem

Visual 需要沿用五种受限 CLI 及逐项报告语义。原件归 Assets，运行和证据归 Visual。Mac 执行只获准读取该运行所需的固定版本媒体，临时结果不能在失去回执后触发重复执行。

## Decision

Visual 先持久冻结验收包、连接签名和截止时间。Agent Runtime 保存同账号同运行的精确租约与结果，发起或续租时通过 Identity 和 Visual 复核授权。原件通过租约代理 Assets 的精确保留集，Mac 工具只获得任务目录。Mac 在调用前记录意图，上传追加帧时逐文件核对长度和摘要，报告必须引用任务实际读取的证据。Visual 将每帧的来源与原始证据 ID 同素材源回执提交。

## Alternatives considered

让浏览器指定本机命令、把文件和执行凭据放进任务 JSON，或在未知结果后重派租约，都会破坏任务边界或持久回执语义。

## Consequences

Agent Runtime 需要应用 0002 迁移。Mac worker 必须运行同一版本。成功结果的正式证据保存在 Assets。Agent Runtime 只在执行截止后一小时清理该租约的受控暂存文件。

## Verification

隔离测试覆盖真实 FFmpeg 追加取样、Mac 和 Visual 各自丢失回执后的重放、摘要校验、取消后拒绝执行，以及清理暂存后正式证据仍可下载。
