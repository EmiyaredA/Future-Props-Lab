# Agent Note: 全局紧凑化 UI 密度与侧栏状态

Status: implemented

## Problem

上一轮 UI 刷新统一了暖橙主题和主要壳层，但许多工作台、列表、表格、筛选器和编辑器仍保留较大的间距与面板留白，桌面端单屏信息量不足。现有移动抽屉导航也需要和桌面端的紧凑布局共存，不能通过简单缩小所有控件造成触控误操作。

## Decision

在现有 `codex/ui-refresh` 视觉系统上增加“专业紧凑”密度层：桌面端将页面内边距、面板间距、列表行高、统计卡片、筛选器和弹窗 chrome 收紧到约 12–16px 的模块尺度，移动端通过 coarse pointer 规则保留至少 44px 的触控尺寸。模型日志表格、账号管理、应用中心、集成中心和编辑器公共面板按信息层级保留标题、状态、主操作与错误信息，减少重复留白；不改变业务文案、数据契约或编辑器操作。

`ResponsiveSidebar` 新增 `collapsible`、`storageKey`、`defaultCollapsed` 和 `onCollapseChange` 可选能力。各工坊默认使用展开模式，桌面端可切换到约 76px 的图标模式并按各自存储键记忆；图标模式保留 `aria-label`、`title`、键盘焦点和 pressed 状态。Studio 全局壳已改为常驻一级轨 + 可选二级栏，不再走「展开全文侧栏」路径，详见 [Studio 双栏壳与极简顶栏](./2026-09-17-studio-dual-sidebar-chrome.md)。移动端继续使用抽屉导航，并将 Studio 全局顶栏置于抽屉之上，避免导航打开时遮挡主题切换。

## Alternatives considered

- 极致压缩所有元素：可以获得最高单屏信息量，但会降低表格可读性并增加误触风险。
- 只用全局 CSS 覆盖：实施快，但容易破坏编辑器局部布局和移动端触控边界，难以让辅助信息按场景分层。
- 固定完整侧栏：可发现性最好，但会持续占用桌面主内容宽度，和提升工作台密度的目标冲突。

## Consequences

- Studio、账号管理、模型目录/日志、应用中心、集成中心和主要编辑器 chrome 获得一致的专业紧凑尺度；橙色仍是主操作色，现有浅色/深色 token 与状态对比不变。
- 桌面侧栏折叠状态按工坊隔离持久化，Studio 二级栏偏好独立存储；移动端抽屉行为和焦点回收逻辑保持不变。
- `prefers-reduced-motion` 下全局 app 动效会降为近似即时过渡；触控设备的核心按钮、选择器和导航入口不会被压缩到 44px 以下。

## Verification

- Web lint、Web build、OpenAPI/SDK contracts check、Agent Note 校验和文档中心保护路径检查通过。
- 主题、首页、基础架构、导航、工坊壳层和侧栏持久化测试通过；新增桌面侧栏折叠记忆测试通过。
- 侧栏宽度/选择器对齐、调用日志紧凑桌面筛选、模型测试窄屏主题切换等受影响端到端用例复跑通过；全量端到端执行结果为 153 passed、14 failed、2 skipped，失败集中于既有文档中心映射/素材校验及若干长链路数据状态用例，未修改受保护文档路径或后端契约。
- 完整 Web format check 仍被既有 `KnowledgeDocumentResults.tsx` 格式问题阻断；该文件不属于本次紧凑化改动。
