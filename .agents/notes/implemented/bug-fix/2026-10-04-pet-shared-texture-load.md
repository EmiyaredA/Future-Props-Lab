# Agent Note: 人物共享贴图按素材键加载和上传

Status: implemented

## Problem

桌宠编辑器的人物分件可共享同一 tex 素材，但原加载和上传循环按部件逐项执行。共享素材被重复请求并上传同一个 GL texture key，换装时也重复。用户同时报告 Chromium tile memory limits exceeded；该日志只表示可见 tile 超出渲染预算，不能单凭日志推断物理显存耗尽、泄漏或此重复上传就是直接原因。

## Decision

createHumanFigure 从 model.parts 按首次出现顺序提取唯一 textureNames。每服饰的原 Promise 缓存只加载一次每个 tex ID，初始及换装同样按 tex ID 上传一次。各部件原有裁切、顶点、遮挡顺序、绘制和独立五官素材保持原规则；换装选择代次、卸载守卫仍由人物边界持有。独立审核同时复现原有失败 Promise 永久缓存问题：失败时仅当缓存仍指向本次 Promise 才删除，保留已显示服饰，用户重新选择才发起新加载，不自动重试。输入来自现有授权素材地址，输出仍为现有人物渲染实例，不新增持久状态或公开接口。

## Alternatives considered

- 调高 tile 预算或关闭 GPU：没有直接因果证据，且会改变整体渲染行为，未采用。
- 降低原画分辨率或修改五官绘制：不解决确定的重复循环，并可能损伤用户要求的比例和画面，未采用。
- 重建人物或跨实例共享缓存：扩大生命周期及竞态边界；原实例内按真实素材键去重即可修复当前重复开销。

## Consequences

实际本地旧服饰包路由初始化 Image 请求由 32 次降为 27 次、纹理上传由 19 次降为 14 次；切实验室服累计请求 64→54、上传 38→28。切回已加载服饰复用图片并更新原 GL key，累计上传 57→42。GL keys 始终 14，并非持续增长的纹理数量。重复项主要包括小型空白共享素材，因此这些数值不能证明 tile 警告已经解决。原 PNG、正式项目及数据库没有更新；自然动作仍受完整隔离视觉验收门禁约束。

## Verification

6 项新测试通过真实 createHumanFigure 入口验证共享 atlas 只加载/上传一次而独立 crop/顶点完整，换装复用原纹理键和图片缓存，快速选择拒绝旧回执，卸载拒绝迟到上传，失败保留旧服饰及反馈。相关人物/服饰/动画 39 项、原生 Web 类型、局部 lint/format 通过。实际旧资源前后对照的所有 UV、pose vertices、draws、最终纹理来源和 Canvas/SVG 几何深度相等；记录的是合成 Image/GL 调用，不是物理 GPU 内存或人体视觉认证。

源码冻结及独立报告保存在 `.local/desktop-pet/sequence-transition-branches/memory-review/fix/`。tile 警告的正式编辑器复现及 compositor 预算仍未确认，不能把本优化描述成警告根因修复。完整帧视觉检查见[原帧提案](../../proposed/bug-fix/2026-10-04-pet-whole-frame-motion.md)。

失败恢复后追加冻结及原有问题复现保存在 `memory-review/fix/failure-recovery/`。直接人物 setScheme 返回的 Promise 仍可由显式调用者捕获错误，并挂观察避免直接后台调用产生未处理拒绝；这不自动保护 sequence 包装生成的派生 Promise，WhaleRenderer 以明确换装入口消费结果，区分初始资源错误与换装错误，显示现有 alert 并在当前选择成功后清除换装提示。当前选择代次、实例、资源键和目标服饰共同约束回调，卸载时失效；不重建角色或重置播放来清除提示。成功贴图缓存和模型几何仍复用；不会自行保存或覆盖配置。

独立组件层补充 12 项测试，使用真实 WhaleRenderer 及真实 sequence 包装，验证直接人物和包装的失败 alert、手动重选恢复、旧成功/失败回执、卸载、资源更新以及初始创建等待中的选择变化。加载 Promise 和 UI 派生 Promise 均由各自边界消费，不安装全局错误吞噬器；不是真实正式编辑器的 tile 复现或新素材视觉通过。操作排障正文及官方导入包同步维护。


### 真实隔离渲染器 compositor 复核

后续使用生产 WhaleRenderer、humanFigure 与真实 WebGL，在独立 Electron 窗口加载本地旧三服饰资源；没有后端、账号、正式数据、模型调用或候选安装。两次原生运行共 42 个样本，另 5 个 CDP DPI 模拟样本：中央及额外桌宠尺寸窗口、六次换装、外窗口尺寸变化、卸载和三次重开均无 tile warning、pageerror 或未处理拒绝。换装不新增 context；四次实例创建与四次 loseContext 对应，卸载后 canvas 弱引用回收、上传停止。原生 trace 的 4769 次 TileManager 预算分配均报告可调度当前所需 tile。

这不是完整编辑器 DOM、用户正式资源或长期泄漏复现。GPU 进程工作集约 98–100 MiB 单窗口、130–132 MiB 双窗口、91 MiB 全部卸载，是进程 RSS，不是物理显存。两个原生 DPI 参数都实际报告 DPR 2，不作为物理 1/2 对照；CDP 模拟有中间混合 DPI 样本，真实值保留。外窗口调整时中央 CSS viewport 保持 540×650，不能据此认定响应式全舞台压力已覆盖。大调试 trace 的 Tracing Service 开销已单独识别，不计作 renderer 泄漏。报告与源码前后哈希在 `.local/desktop-pet/sequence-transition-branches/memory-review/isolated/`；正式 tile 原因仍未确认，不据此扩大预算或宣称警告已根治。
