# Agent Note: 连接线停靠属性与自由端点

Status: implemented

## Problem

连接属性浮层覆盖幻灯片；强制绑定节点让整线无法自由放置。已有右侧格式面板与连接浮层各自显示，增加重复编辑入口。

## Decision

`useSceneTools` 继续拥有连接选择、新建预览及编辑提交，把属性控件交给 `PresentationInspector` 元素页。每次明确选择连接激活对应属性，其他页签仍可主动切换。删除浮层定位 hook，面板关闭沿用原有取消选择语义。

端点在元素 ID 与绝对 point 之间二选一；同端两者同时存在或均缺失、非法坐标及绑定自环由文稿 schema 拒绝。`source_point` / `target_point` 保存自由坐标，绑定端保留边与沿边比例。登记迁移 `0104_presentation_free_connections`，只给旧连接补 null 坐标，不改变路径、revision 或更新时间。SDK 类型由契约生成。

线身和直线中点拖动平移全路径并解除两端绑定；折线手柄继续编辑局部走线。端点拖到空白处自由放置，接近元素边缘重新绑定。手势只保留起始快照和临时预览，松手提交一次；取消、切页和只读转换不提交。方向键微移自由端与整线，Shift 加速。整线鼠标拖动按住 Shift 限定主轴，自由端点在 8 屏幕像素内对齐另一端的 X／Y，节点边缘绑定优先。

对照 PPTist 官方 `useDragElement.ts`、`useDragLineElement.ts`、`LineElementOperate.vue`、`LineStylePanel.vue` 和 `types/slides.ts`：其自由线采用位置、相对端点与控制点，线身共用元素拖动，端点单独编辑，样式在右侧。这里只借鉴交互划分和对齐原则，保留工坊已有的可选节点绑定、React 手势控制、单次历史和持久化契约，不引入 Vue 状态或上游源码。参考快照在 `.local/connection-inspector-repair/pptist-reference/`；来源为 [PPTist 官方仓库](https://github.com/pipipi-pikachu/PPTist)。

清理、隐藏、复制、批量操作、节点跟随与 PPTX 识别自由端。整页复制保留独立自由线，局部元素复制携带关联边；自由端不参与自动布局或节点跟随。PPTX 只为仍绑定的端点写连接关系，显式走线保留为可编辑自由路径。

## Alternatives considered

- 缩小或避让浮层仍占用画布，也重复右侧面板职责。
- 转换成普通直线或透明锚点会丢失折点、标签或引入隐藏对象依赖。
- 放宽沿边比例不能表达脱离节点的语义，也无法一致保存和导出。

## Consequences

整线拖动主动解除绑定，一次撤销可恢复原绑定与路径，或将端点拖回元素边缘重连。坐标范围与 32 个内部路径点限制不变。正式桌面数据升级仍遵守停机备份及迁移入口，自动测试只使用临时数据。

## Verification

组件覆盖右侧属性、重复选中激活、普通元素切换、创建取消、连续编辑、撤销和只读。几何与 API 覆盖全路径平移、混合端点跟随、复制、保存回读、CAS、导出和迁移幂等。隔离 Playwright 覆盖线身及手柄、吸附、自由放置、取消、保存重开、缩放滚动、明暗主题和窄屏；产物位于忽略的 `.local/connection-inspector-repair/`。
