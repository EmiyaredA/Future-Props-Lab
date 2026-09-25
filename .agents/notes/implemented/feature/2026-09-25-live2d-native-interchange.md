# Agent Note: 原生角色与 Cubism 素材交接

Status: implemented

## Problem

原生角色工程已有网格、参数和动画编辑，但缺少可检查的 PSD 重导入、参数动画文件交换和 Amadeus 执行状态编排。上一轮概念稿把未来目标描述为直接管理 Cubism 运行模型，容易使自研工程与 `.moc3` 混淆。

## Decision

保留 FPL 自有渲染与 `.fpllive2d`，把 `CharacterDocument` 升为 v2，加入七种状态引用和 Cubism 参数 ID 映射。v1 文档及工程包读取时适配，不批量写数据库。PSD 重导入按图层路径、画布、位置和尺寸预检；像素替换保留部件 ID 与绑定，旧素材在保存成功后经带 revision 的正式 API 清理。清理与 revision 递增处于同一事务，并返回新 revision，阻止并发保存重新引用已删除素材。Cubism 交接包仅输出 RGB 分层 PSD、逐层 PNG 和可转换的参数动画/表情 JSON。

## Alternatives considered

直接接入 Cubism SDK 和把 `.model3.json` 作为主工程需要运行模型加载与许可核查，也不能编辑或编译 `.moc3`。将自研工程伪装为 Cubism 模型会误导交付方。按图层名无条件覆盖虽简单，但坐标或尺寸变化会使已有网格失效。

## Consequences

本地用户仍通过同一项目、素材及 CAS 文档接口工作。`motion3` 的 Bezier 与不落在帧上的变化按帧采样，`exp3` 的 Add/Multiply 以当前默认值静态化；导入前报告近似、缺失参数、越界与不支持轨道。交接包不是可播放模型；需在 Cubism Editor 重新建模与生成 `.moc3`。物理、贴图集和复杂混合留给后续引擎工作。Amadeus 头像保持现状，模型完成后再接入。

## Verification

后端 Live2D 与权限测试 18 项通过，覆盖 v1 适配、v2 包往返、状态引用、素材清理与 CAS；前端定向测试 15 项通过，覆盖参数转换、诊断和 PSD 重导入规划。三条浏览器旅程通过，覆盖 PSD 实际导入、同路径重导入、几何拒绝、素材交接包像素检查、状态绑定与 PNG 序列。OpenAPI、SDK 与参考文档 stale check 通过；Vite 生产资源打包通过。全库构建在既有 `vendor/pi/packages/agent/src/harness/env/nodejs.ts` 缺文件处停止；文档保护脚本识别到本次公共 API 变动所需的自动生成 SDK 参考页。

详见 [工坊架构说明](../../../../docs/architecture/live2d-workshop.md)。
