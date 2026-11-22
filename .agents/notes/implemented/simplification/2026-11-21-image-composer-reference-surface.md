# Agent Note: 图像生成区统一参考入口与边距

Status: implemented

## Problem

图像工作台同时展示输入素材行和参考图片区，入口重复，参考图片贴边。
选定视觉稿的外层留白及底部空白又压缩提示词可用空间。

## Decision

按用户选定效果图，图像生成区使用单一边框容器，内部左右 12px、底部 8px。
参考图片、提示词框和参数栏共用内侧对齐线，区块采用 8px 间距，底部参数栏随容器下沿排列。
图像节点不渲染独立输入素材行及其空容器，参考图上传和既有连线输入解析继续复用原生成器。
文本节点保留输入引用编辑，图像连线管理仍由画布负责，不删改已有连线或草稿。
这细化了[剧本与预演工作区信息密度](../feature/2026-11-21-script-and-previs-workspace-density.md)
中的图像工作台布局，沿用其中的参数、版本和提交回调。

## Alternatives considered

- 仅用 CSS 隐藏输入素材行：仍挂载重复入口与查询，没有必要保留空容器。
- 清空原有上游连线：删除界面行无需更改用户的生成依赖，保留解析和画布编辑能力。
- 继续扩大外层留白：与用户要求增加可用编辑面积、下移参数栏相反。

## Consequences

图像工作台只保留一个参考图片入口；不改变 API、存储、草稿、生成提交与既有连线。
窄屏参数自然换行，保留原本地滚动和编辑器展开行为。
遵循[能力实现契约](../../../../docs/architecture/capability-contracts.md)与
[开发与验证流程](../../../../docs/operations/development-workflow.md)。

## Verification

- 分镜与文件工作台使用同一个 `BoardNodeEditor`，图像不再挂载 `InputReferences`，文本行为保留。
- 浏览器验收检查输入行缺席、左右 12px 内容边距及参数栏下方 8px 留白，覆盖深浅主题与 390px 窄屏。
- 视觉对照与隔离验收产物保存在忽略的 `.local/image-composer-final/`。
- 52 项定向测试、TypeScript、改动文件 ESLint／Prettier、Vite 构建与包体预算通过；浏览器覆盖文件和分镜入口、深浅主题、390px 窄屏及原保存／离开保护。
