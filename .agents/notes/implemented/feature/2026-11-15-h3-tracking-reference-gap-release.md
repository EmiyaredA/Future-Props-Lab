# Agent Note: H3 追踪对象上方留白修整发布

Status: implemented

## Problem

紧凑标签上方仍叠加参考栏内边距、排序栏底边距与标签外边距，实际留下 16px 空白，
继续占用提示词区域。用户要求移除这处留白。

## Decision

源码提交 `c136d7cc` 仅为相邻的参考栏与追踪对象移除三处纵向间距，
保留标签高度和其他生成入口的布局。选择器限定存在追踪对象的生成器及其直接相邻参考栏。

基于可复现当前 Visual 构建 ID 的源码，仅追加同一份已提交样式，沿用当前 API 指纹，
按 stage 和 activate 比较旧构建后原子切换。Models 无此参考栏，不发布新版本。

- 回退构建：`9903c2ca72e26f5a47b4`。
- 当前构建：`b9455da349578fdfde87`。

## Alternatives considered

- 使用负外边距上移：掩盖叠加来源，可能遮挡排序按钮。
- 全局缩减所有参考栏间距：影响未展示追踪对象的生成入口。

## Consequences

参考图排序按钮下缘与追踪对象行之间不再留空，标签仍为 32px 单行。
不重启后端、不修改数据库及配置；正式构建与回退版本位于 `.runtime/deployment/web-releases/visual/`，
发布回执位于 `.runtime/deployment/releases/tracking-reference-gap-20261115/receipt.json`。

## Verification

19 项相关 Web 测试通过，Prettier 与 diff 空白检查通过。Chrome 复现当前部署源码时，
排序按钮至标签的间距由 16px 降为 0；main 及 360px 窄屏同样为 0，标签高度保持 32px，
无脚本错误或页面横向溢出。明暗主题截图已复核。
不可变构建通过，本机和公网的新旧资源、构建 ID、API 指纹及 gzip 校验通过，容器运行状态保持一致。
