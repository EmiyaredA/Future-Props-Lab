# Agent Note: 变体滚动入口与高清缩略图

Status: implemented

滚动变体条的展示位置后续移至设定库，见[项目独立项与库内归组](../feature/2026-11-20-project-card-items-and-library-families.md)。

## Problem

变体按五等分压缩到约 52px，正常宽度下没有溢出，用户看不出可以横向浏览。128px 缩略图被裁成竖框，在高分屏和多视图设定板上缺少像素且细节难辨。

## Decision

设定族继续使用[横排变体](../feature/2026-11-20-visual-variant-filmstrip-and-dialog-dismiss.md)，每款固定 96px，图片使用方形容器和 contain 保留完整设定板。变体请求 640px 预览，主卡请求 320px；仍由 ImagePreview 按可视区鉴权读取和清理 Blob，不读取所有原图，也不修改采用图。

`board/VariantStrip.tsx` 拥有局部滚动和边界检测。左右按钮按一屏滚动；滚动、容器尺寸及子项尺寸变化会更新按钮状态。触控和横向触控板沿用原生滚动；普通垂直滚轮在当前条带还能移动时转为横向，边界处继续交给页面，Ctrl 缩放手势不拦截。键盘焦点沿用设定族的方向键与 Home/End，离屏项自动滚入视野。尊重减少动态效果设置，卸载时清理监听器和 ResizeObserver。

## Alternatives considered

只把 overflow 设为 auto 无法解决五张被挤小、没有滚动入口的问题。只放大低分辨率图片仍然模糊。默认请求所有原图增加不必要的传输，高清预览足以覆盖当前显示尺寸。

## Consequences

五款变体在桌面显示两款及下一款的一部分，留出滚动提示；不再为把全部项目放进一行缩小卡片。完整图减少裁切丢失，长名称提示和现有菜单保持可用。项目和素材的持久状态不变。

## Verification

`visual-design-card-sidebar.test.tsx` 三项通过。隔离浏览器 `visual-canvas-groups-and-cards.spec.ts` 覆盖固定宽度、左右按钮、边界禁用、滚轮、解码图片尺寸、完整名称、键盘与窄屏。实际项目测得条带 279px、内容 506px、向右滚动 227px；变体解码宽度均为 640px。截图和本地验收记录位于 `.local/variant-scroll/`。
