# Agent Note: Future Props Lab 全局 UI 刷新

Status: implemented

## Problem

当前 Web 端已经具备浅色/深色主题、Studio 壳层和多类工作台，但各功能页面的视觉规则、信息密度、导航层级和复杂编辑器布局缺少统一的产品级设计系统。橙色品牌识别存在，却没有在所有页面形成稳定的主次层级；不同页面的卡片、表格、弹窗、状态反馈和响应式行为也需要统一。

## Decision

本分支在保留路由、API、数据模型、权限语义和业务流程的前提下，建立以橙色为主色的暖橙未来感视觉基础。Web 接入 Tailwind CSS 与 shadcn 风格的可控组件基础，公共壳层、首页、工坊壳层、主题、移动导航、选择器和公共按钮使用统一 tokens 与交互规则；复杂编辑器继续保留自身高密度布局，由全局 tokens 统一颜色、边框、焦点和状态表现。

主题首次跟随系统，用户手动选择后持久化。导航增加工作台/基础设施分区提示，但保留现有入口文案、路由和权限判断，避免破坏已有深链和自动化旅程。

## Alternatives considered

- 仅修改现有 CSS：迁移成本最低，但无法稳定复用跨页面的交互原语，也难以解决页面间的视觉漂移。
- 引入 Ant Design：表格和表单能力成熟，但默认视觉和组件结构较重，品牌化覆盖成本高，不利于复杂编辑器保持独立布局。
- 只刷新 Studio 管理台：可以快速验证视觉方向，但会让工坊和编辑器继续保持另一套产品语言，无法满足整体 UI 刷新的目标。

## Consequences

- 页面获得统一的橙色品牌锚点、墨黑/靛蓝/橄榄绿辅助色、卡片层级、焦点反馈和移动导航表现；首页获得展示型工作台入口，工坊壳层与管理台形成一致语言。
- Tailwind 与旧 CSS 在迁移期间并存，后续页面应继续优先复用公共 tokens 和 shadcn 风格 primitives，避免重新引入局部颜色与间距规则。
- 依赖体积增加了少量 Tailwind/Radix 基础包，构建仍通过现有 bundle budget 检查；业务页面的复杂编辑器未被强制改成统一模板。

## Verification

- `npm run build --workspace web` 通过。
- Web lint 通过；本次变更涉及的格式检查通过。
- 主题、首页、基础架构、导航和工坊壳层相关测试通过。
- 完整测试中的文档截图 checksum 校验仍有既有 `video-editor-projects.jpg` 不一致；该资源未在本次改动中修改。完整 Web format check 仍被既有 `KnowledgeDocumentResults.tsx` 格式问题阻断，根目录 format check 另受本机 uv 缓存/运行时权限限制。
