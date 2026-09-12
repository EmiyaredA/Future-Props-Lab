# 文档渲染框架

根据用户授权移植 Sayflow 的 `web/src/shared/docs/` 组件、静态文档树和阅读样式，参考其 `web/build/docsCompiler.mjs` 的受控组件校验。Sayflow 仓库保持只读，本项目不在运行时依赖它。

`compileDocument.ts` 将 Markdown 转换为不可执行的 `DocDocument`。`DocumentRenderer.tsx` 按组件白名单渲染，`componentContract.json` 是支持的标签、字符串属性与嵌套规则的事实源。普通文章继续按 Markdown 解释；需要组件的文章在首行 JSON 元数据中设置 `componentSyntax: true`。不编译或执行 JavaScript，不接受表达式、模块导入、事件属性或任意 HTML。

`DocComponents.tsx` 拥有步骤、提示、卡片、示例、字段、截图与章节；`DocMedia.tsx` 拥有代码高亮和复制、KaTeX 公式与 Mermaid 图表。图表按需加载，使用 strict 安全设置。`createDocComponents.tsx` 把注册表接到研究所的 URL、元数据和 API 操作映射；`ApiOperations.tsx` 使用版本控制中的 SDK 操作表。

`blocks.css` 和 `media.css` 仅消费研究所明暗主题变量。外层目录、搜索、旧锚点映射和移动端抽屉仍由文档入口拥有。内部开发正文仍从现有鉴权 API 获取，不进入公开文章构建。

完整展示见 `../articles/help/docs-reading.md`。`DataCode` 的 `source` 引用文章 `data` 中的字符串，`DataTable` 引用 `{headings: string[], rows: string[][]}`；不接受表达式求值。代码围栏支持普通语言、`mermaid` 与 `math`，公式也支持 `$…$` 和 `$$…$$`。

执行 `npm run docs:check` 检查生成参考与所有公开正文的编译、渲染和静态组件契约；浏览器交互检查位于 `web/e2e/docs-sdk.spec.ts`。
