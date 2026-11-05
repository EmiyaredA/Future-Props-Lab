# Agent Note: Visual 助手附件的保留与内容投影

Status: implemented

## Problem

附件消息与历史上下文需要以相同规则读取图片和正文。拆分后 Visual 持有对话和关联，Assets 持有原件、项目文件范围及保留记录。

## Decision

原消息流请求仅能为同一项目和对话委派精确附件集合。Assets 在准备时核对新增文件的项目归属并保持历史保留集，投影只读取已准备或已提交的附件。图片大小、AVIF 转换、PDF 页数、文档字符和警告沿用共享解析规则。源回滚使本次准备的原件重新不可读。

## Alternatives considered

由 Visual 直接挂载原件目录会绕过素材范围校验。复制附件解析逻辑会使两条入口的限制和失败结果分歧。

## Consequences

Assets 镜像复用主项目已锁定的 pypdf 版本与哈希。对话记录继续使用原素材 ID。私网附件输入由公开助手流接入。

## Verification

隔离测试覆盖工程内 Markdown 和 PNG 投影、另一工程素材拒绝、回滚后投影关闭，以及兼容站 PDF 和媒体回归。
