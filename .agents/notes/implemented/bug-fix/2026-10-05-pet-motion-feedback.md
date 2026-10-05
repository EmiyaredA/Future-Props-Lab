# Agent Note: 桌宠运动区分资源缺项与执行异常

Status: implemented

## Problem

完整隔离 Electron 中，保留原事件配置的完整帧包缺少某反应片段时，一次 44.1 毫秒、零位移的短点产生 sequence:missing-clip。宿主位置和 revision 不变，运动入口却把它归为无法保持支撑并显示桌宠状态异常。用户无法区分缺少动作素材与真实支撑或通信故障。

## Decision

usePetLocomotion 在运动边界将 renderer 的协议失败分类为带 code、kind 和 severity 的反馈。明确缺少动作、过渡或视角属于 resource-unavailable warning；缺支撑、支撑冲突／登记不一致、缺少确认位移、无效比例、加载错误和未知失败保持 error。环境读取、取消、移动和最终放置失败单独归 transport error。分类不依赖运行界面的中文提示。

两类反馈均取消当前自主轨迹，播放器保留最后可用画面；资源警告期间手动抓点、单请求在途的拖窗和最终放置确认继续可用，手动回执不清除素材警告；不跳过支撑校验、不补假接触点、不启用已拒绝的旧素材。运行页显示动作资源未齐及对应原因，真实错误仍显示桌宠状态异常。新抓取取消旧播放，已知资源警告仅在有效新播放或实际配置切换后恢复，并重新等待活动间隔；真实失败不自动重试旧轨迹。

## Alternatives considered

- 忽略 missing-clip 并继续轨迹：缺少姿势时窗口仍移动，可能让已绘帧滑动，未采用。
- 将所有 sequence 失败降级提示：会掩盖真实支撑冲突和登记漂移，未采用。
- 在运行页按中文字符串猜原因：分散分类且文案变化会改变控制行为，未采用。

## Consequences

资源缺项可读，窗口、支撑和通信错误仍保留明确停止与恢复边界。反馈仅在内存，不新增数据库、公共接口或配置字段。修正提示不表示缺失动作已制作，也不批准未通过抽帧的候选资源。

## Verification

新增32项独立测试使用生产SequencePlayer保留有效cel，覆盖资源／真实错误分类、错误优先、cancel／manual回执、有效播放恢复、短点、150ms／4DIP、warning后继续+30DIP并确认最终位置、取消／捕获丢失和重抓。相关测试67项、旧反馈与新测试34项通过；root最终49文件843项桌宠测试、全lint／format／build及类型、官方导入8项、105篇seed和受保护目录检查通过。首轮旧测试按旧error语义断言失败，单独增量改为typed警告与真实manual确认断言，原失败日志保留。tsx CLI管道受沙箱限制，三个相同Note校验脚本以node --import tsx运行通过。

hook SHA f558ea9e6641089251bca8394de2bcffe7ea700449e0acc4a4002653f333a59d；Runtime SHA154766c9ff6619a7333e219f221b1f05879d7c797c2d1332c24f528d707c968c。三轮完整隔离App的87文件sorted SHA48926a1088932a4d2dd2757ed5f779fc4295e3dd34c325e0d4067409cae54d8d均前后相同，较早版只这两文件改变。44.4ms零位移实际短点显示sequence:missing-clip的role=status与动作资源未齐，无fatal；长按后+30DIP、先+8再+30、实际capture丢失和trusted touchCancel、快速重抓、空白点与联动on/off均检查，69条递增确认回执，配置和revision严格未变。资料在 .local/desktop-pet/runtime-motion-feedback/、.local/desktop-pet/motion-feedback/root-review/ 和 .local/desktop-pet/full-app-sequence-check/motion-feedback-after/。原clean-click失败保留，不重写历史。

逐rAF复核另外发现最终放置回执先于held外层补偿切换，同一cel在松手后16.4ms的世界位置瞬间+20DIP、33ms恢复。分类和手动RPC回归通过不能替代松手连续性；该竞态继续单独修复，未以稳定终点约.3DIP差宣布整体通过。诊断包没有真实held／支撑／其他服饰，不批准人体素材、世界接触或完整动作，正式资源／App未应用。
