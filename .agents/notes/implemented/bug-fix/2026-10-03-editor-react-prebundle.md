# Agent Note: 延迟刷新期间的编辑器 React 实例一致性

Status: implemented

## Problem

桌面开发窗口按未保存保护延迟 Vite 整页刷新。新增代码块与高亮依赖被懒加载发现后，Vite 重新预打包并更换依赖 URL 的版本。旧 React DOM 根仍存活，后续组件导入新版 React，Hook dispatcher 不属于旧渲染器，出现 Cannot read properties of null (reading useContext)。包管理器显示依赖已去重也不能排除这种浏览器内存中的多版本实例。

## Decision

web/vite.config.ts 的启动预构建清单增加 @tiptap/extension-code-block 与 lowlight，保持既有 React 去重和各环境隔离缓存。编辑器懒加载前完成这些依赖的优化，延迟刷新期间不再因它们替换 React 模块。保留桌面整页刷新和退出的未保存保护，不自动刷新崩溃窗口，也不重试业务写入。

浏览器回归使用 .local 下的无数据库临时页面和 Vite 缓存，加载两轮懒组件。测试沿用真实 Vite 配置并模拟桌面 full-reload 拦截，实际比较两轮 useContext 函数身份，验证 React Hook 渲染、依赖可用和无页面异常。业务回归另用全新隔离数据库验证笔记首页模板、编辑保存、社区发布及导出。

## Alternatives considered

- 放行所有自动刷新：会破坏未保存保护，丢失编辑状态。
- 只清理依赖缓存或去重 React：无法阻止同一窗口下一次依赖优化产生新版 URL。
- 捕获并忽略 Hook 异常：不能修复渲染器与组件 React 实例不一致。

## Consequences

这是开发依赖图修复，不改变笔记数据、权限、API 或生产正文契约。新增懒加载依赖需要维护启动清单。已持有旧模块的窗口仍须经现有未保存确认正常退出和重启，使新 Vite 配置从启动时生效。正式数据库未用于测试。

## Verification

- .local/react-recovery 中隔离复现：修复前第二轮加载得到不同 React，报错栈包含 useContext；增加预构建后同一 React、正常正文且无异常。
- web/e2e/editor-dependencies.spec.ts：真实配置、延迟刷新、两轮懒加载和 Hook 身份验证。
- web/e2e/document-layout.spec.ts：首页编排、保存刷新、发布、跨账号过滤、HTML 导出、内置模板创建。
- 构建、改动文件 lint、格式与文档保护检查分别执行，范围外结果单独报告。
