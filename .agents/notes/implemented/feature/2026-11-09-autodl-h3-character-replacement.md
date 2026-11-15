# Agent Note: AutoDL H3 角色替换工作流

Status: implemented

## Problem

AutoDL 的单角色和多角色替换使用不同的图片字段，并要求源视频和角色图的下载地址。
以图生视频的输入规则处理它们会丢失图片顺序，并错误要求提示词。

## Decision

沿用 Models 已有的 AutoDL 任务执行器。两个工作流各自声明素材数量、默认时长、
提示词限制和字段映射。多角色工作流持久化参考图顺序及可选英文追踪对象。
视觉工坊先解析画布素材，再由 Models 校验选中工作流的输入。参考素材在执行时才临时上传。

## Alternatives considered

- **复用现有 Base64 传输** — 官方接口把这两个工作流的参考素材定义为 URL。
- **把两个工作流做成独立的工坊功能** — 两者沿用当前视频节点、任务历史和素材入库流程即可。

## Consequences

- **收益**：模型测试、视觉创作工坊和推理 API 共用能力与参数校验。
- **代价与已知上限**：部署需要可用的临时 HTTPS 上传服务。使用 TempFile.org 时链接保留一小时。

## Verification

后端回归覆盖两套请求、模型准入、素材格式、上传及状态轮询。Web 回归覆盖预设、模型测试
的参考图排序与工坊连线提交。运行 `tests/apps/model_service/test_autodl_video.py`、
`tests/integration/test_temporary_media.py` 和 Web 的 `autodl-generation.test.tsx`。
