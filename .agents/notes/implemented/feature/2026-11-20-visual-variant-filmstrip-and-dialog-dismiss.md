# Agent Note: 设定族横排变体与弹窗外侧关闭

Status: implemented

项目侧栏的族合并展示由[独立项目项与库内归组](2026-11-20-project-card-items-and-library-families.md)取代；本篇保留历史决定与弹窗交互约束。

## Problem

变体的缩进纵向列表重复展示角色名，占用侧栏高度，难以对比同一角色的造型。设定卡与素材选择器的原生 dialog 只有关闭按钮和 Esc，遮罩点击没有反馈。

## Decision

`board/DesignCardFamily.tsx` 拥有设定族行、行内款数展开入口、横向缩略图条和临时选中状态。变体名称去掉主卡前缀，单行省略，悬浮或键盘聚焦显示完整名称。菜单在悬浮、焦点或触屏下可访问，保留使用、画布、来源和移除入口。方向键、Home、End 只移动焦点，Enter 才打开卡片。搜索自动展开匹配变体；分类计数按主设定族计算，变体单列款数。

桌面侧栏为 300px；1200px 以下沿用已有紧凑断点。变体使用局部横向滚动，不挤出侧栏。主卡保持原有 32px 缩略图、左对齐与紧凑行距。采用图和父子关系由现有 API 提供，不为模拟图中的头像另建素材。

展开状态使用专属 `board-card-family--expanded`，避免兼容网站同时加载其他工坊的全局 `.is-expanded` 旋转样式。几何顺序在兼容网站隔离浏览器中校验，独立服务实际页面负责真实素材视觉验收。

完整名称 tooltip 及其定位容器不接收指针事件，避免窄屏时覆盖展开入口而阻止点击。弹窗关闭后恢复触发入口的焦点，提交和未保存确认仍归原业务组件。

原生 dialog 与合成面板共用 `shared/ui/useBackdropDismiss.ts`。只有左键/触控从遮罩开始并在遮罩结束的点击才请求关闭；原生 dialog 同时检查边界，内部 padding 和从内部拖出不关闭。子弹窗事件不关闭父弹窗。关闭回调继续执行原有 busy、pending 与 dirty 确认规则；Esc 沿用原有处理。已有 Radix 和预览遮罩保留其外侧关闭逻辑。

该呈现决定取代[全项目整理 Note](2026-11-20-visual-design-card-curation.md)中的缩进变体行；素材整理、引用保留与恢复策略保持有效。

## Alternatives considered

保留纵向树只减少 padding 仍无法同时比较多款造型。变体放进额外弹窗会增加比较和切换步骤。只检查 dialog 的 event.target 会把内部 padding 误判为遮罩；在 pointerdown 立即关闭也无法区分从内到外的拖动。

## Consequences

展开和选中只存在前端，不写项目或卡片。缩略图沿用鉴权、可视区读取和 Blob 生命周期。共享选择器获得一致的外侧关闭行为；异步提交期间继续禁止关闭，未确认的选择不会提交。正式服务和用户数据均无迁移。

## Verification

`visual-design-card-sidebar.test.tsx` 覆盖固定分组、来源菜单、展开收起与选中打开；`backdrop-dismiss.test.tsx` 覆盖外侧、内部留白、嵌套与拖动取消。隔离浏览器旅程 `visual-card-editor.spec.ts` 覆盖三类设定卡、未保存提示和嵌套选择器关闭；`visual-canvas-groups-and-cards.spec.ts` 覆盖五款横排、完整名称 tooltip、键盘访问和窄屏局部滚动。实际项目页面完成变体打开、外侧关闭与选中保留验收。截图和视觉对比报告位于被忽略的 `.local/variant-filmstrip/`。
