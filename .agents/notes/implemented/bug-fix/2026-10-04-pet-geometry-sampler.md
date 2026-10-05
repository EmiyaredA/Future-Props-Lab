# Agent Note: 每渲染实例复用可见范围采样器

Status: implemented

## Problem

独立桌宠和运动试玩需要读取当前原画的 alpha 范围与屏幕接触点。原 measure 每次调用都创建 80×100 Canvas/context，完整隔离编辑器约 20 秒记录 609 个 context；这造成确定的重复分配，但不等于正式用户 tile warning 的已确认根因。独立真实 Canvas 对照还发现镜像时只有部分左右接触点的资源会发生 key 覆盖：作者锚点被 fallback 替换，屏幕四边有一边缺失，supportedEdges 未按同方向映射。

## Decision

WhaleRenderer 每实例通过惰性 state 持有 createFigureGeometrySampler，只有找到当前已绘 raster 后创建一个私有采样面；每次 clearRect 后读取当前 alpha、当前 SVG 矩阵和资源锚点，不缓存可见范围。实例卸载把 canvas 设为 0×0 并清除引用，开发 StrictMode 重挂可重新懒创建；更换资源和服饰复用采样器，不共享跨实例可变状态。

接触点先枚举目标屏幕四边，再按镜像方向查询对应作者边。没有作者点的屏幕边使用自身可见范围回退，避免不同来源写同一个 key；作者支持边同样映射到屏幕方向。足底、采样尺寸、alpha 阈值和 PNG 均保留，不增加持久配置、宿主接口或数据库字段。

## Alternatives considered

- 全局共享 canvas：会混合不同渲染实例生命周期，未采用。
- 缓存采样结果：动作、透明范围及屏幕矩阵会变化，不能复用旧结果。
- 降低纹理质量或增加 GPU 预算：未证明与正式 tile 原因有关，也不能解决重复分配或锚点覆盖。

## Consequences

完整 App 的新采样器隔离运行完成 45 个 UI 检查点，独立桌宠观察 1.229–27.699 秒始终一个有效采样面；菜单、换装和联动不再每帧分配。卸载释放和实际 alpha 更新成立，不把 context 数量当显存总量；本轮未复现正式 PID 64587 警告，不能宣布正式警告根治。该 App 证据冻结在锚点修复之前，镜像修复单独检查，不合并源码版本作为一轮证明。

## Verification

9 项组件几何回归覆盖懒创建、100 次复用、先清空再绘制、动态 alpha、活动画布替换、独立实例释放、StrictMode 重建、左右部分锚点镜像及 supportedEdges。独立真实 Canvas 100 组 reused/fresh sampler 和 native SVG CTM 深度相同，含负坐标、非整数 scale、透明消失／再出现及 dispose；该对照同时暴露随后修正的镜像 bug，原失败保留。

完整 App 新 sampler 生命周期证据在 `.local/desktop-pet/sequence-transition-branches/memory-review/sampler-followup/`；部分镜像的原失败与修正后独立对照在 `.local/desktop-pet/geometry-sampler-independent/`。此 Note 不证明人体新素材、所有动作或正式用户 tile 场景通过；自然动作仍受[完整帧提案](../../proposed/bug-fix/2026-10-04-pet-whole-frame-motion.md)的逐帧视觉门禁约束。

最终镜像版独立复核运行生产函数与真实 Canvas/DOMPoint/SVG CTM，100 组动态 alpha 对照及 35 组左右部分／全部／无／空锚点与 supportedEdges 映射均通过。measure SHA `0ae41d5ab8fb4ba8ea05ead5852ab470ed18aedb0e62d2357e75924ca5ae0b81`，跑前后与导入 bundle 相同；原反例及工具键顺序假误差日志均保留，后者不记作生产回归。最终 Web 46 文件 742 桌宠测试、全 lint、format 与 build／类型通过；完整 App 生命周期证据保留其较早源码 SHA，不声称两版是一轮冻结验收。
