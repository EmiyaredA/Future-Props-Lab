# Agent Note: 本地模型管理工作台

Status: implemented

## Problem

本地模型展开卡片把模型目录向下推移，同时展示安装、内存与服务状态，使用户难以识别下一步。
本机共享安装与当前 Workspace 接入属于不同生命周期，重复添加入口也不能准确表达已接入状态。

## Decision

工作区模型服务通过共用目录编辑器的可选内容插槽提供「本地模型」标签，管理中台和角色模板不提供此插槽。
编辑器只拥有视图切换及连接定位，不持有 API 或 revision；本地模型组件分别拥有数据操作、模型选择和详情展示。

桌面使用模型列表与详情分栏，内容宽度小于 900px 时上下排列。状态步骤分别表达安装、本机服务与空间接入，
主操作随真实状态推进。安装成功沿用后端自动启用行为；当前空间接入通过 local_qwen_tts 连接与模型 slug 匹配，
已接入模型直接进入测试，停用接入定位到接入管理。模型内存空闲不代表服务停止。

TanStack Query 的本地模型键唯一管理可见期间的两秒轮询；平台操作和空间添加复用现有 API 及 CAS。
统一 mutation 键防止切换标签后重复提交；写入不自动重试。身份切换清空缓存后，旧请求不得重新填入目录或触发新身份的刷新。
成功回执与刷新错误分别展示，安装状态变化同步使目录和推理选项失效。
卸载及失败下载清理由项目确认弹窗承接，生成期间不能启停或卸载。连接详情工具栏允许窄屏换行，避免配置标签被添加按钮遮挡。

## Alternatives considered

- **目录侧边抽屉**：保留目录上下文，但共享模型安装和空间接入的信息在窄栏内仍需较多滚动。
- **首次接入向导**：便于初次安装，但日常启停、卸载和多空间接入管理需要另设入口。
- **继续展开卡片**：改动小，但模型管理仍挤占目录首屏，未解决信息层级问题。

## Consequences

- 保留既有应用壳、明暗主题、公开接口、数据库及默认模型设置；不新增路由或真实供应商调用。
- 页签和模型选择只保存在组件内存，刷新恢复模型目录；重新进入本地模型默认选择 0.6B。
- 全机状态与 Workspace 目录通过显式 props 合并展示；平台管理、空间配置和模型测试分别校验权限。
- 视觉验收及隔离测试产物只放在 `.local/ui-model-services/`，官方知识库说明和导入包同步更新，受保护文档中心不改写。

## Verification

- `npm run test --workspace web -- tests/local-model-management.test.tsx tests/local-models.test.tsx tests/model-catalog-editor.test.tsx tests/model-template-catalog.test.tsx tests/technical-content.test.ts tests/official-knowledge.test.tsx`：46 项通过，覆盖本地管理、测试跳转、身份切换、共享编辑器和官方文档。
- `npm run test:e2e --workspace web -- local-models.spec.ts model-catalog.spec.ts --workers=1`：隔离账号与临时数据库，模型安装和音频生成使用确定性响应。
- 浏览器检查 390/768/1600 宽度及明暗主题；与选定视觉图对照的截图和报告位于 `.local/ui-model-services/`。
- 最终构建、Web lint、契约检查、变更文件格式、官方导入包及 Agent Note 校验通过。
- 全量 Web 扩展运行在未修改的 Galgame、视觉工坊用例中出现多项超时后主动停止；根 lint/格式检查报告视频下载相关文件问题，Web 全量格式检查报告六个范围外文件。文档保护检查报告开工前已有的两篇 SDK 文档差异，本次未新增受保护路径改动。
