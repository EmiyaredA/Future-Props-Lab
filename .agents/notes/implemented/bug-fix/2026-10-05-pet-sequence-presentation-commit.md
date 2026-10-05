# Agent Note: 完整序列采样与可见画面同步提交

Status: implemented

## Problem

播放器先改变采样时间与支撑，画布随后安装新帧。Canvas 或 DOM 安装抛错时，Figure 的播放时钟尚未提交；下一帧若比失败帧更短，会提交小于 Player 已记录的时间，触发持续 invalid-time。公开生产 core 的 50ms 故障后 16ms 连续推进无法自行恢复。该问题在位图复用前已存在，不能靠重绘次数测试证明消失。

## Decision

Player 的同步 present 接口拥有采样与安装事务，只深拷贝七个动态字段：playback、last、failure、failedRequest、progress、support、rejectedSupport。资源、图集与完整序列描述不逐帧复制。Figure 通过布尔安装回调报告选中的样本是否实际安装，不能替换为另一份样本；普通 sample、hold、reject 仍经过既有公开选择规则。

Canvas／DOM 抛错恢复采样前的动态状态，Figure 恢复先前进度并使位图认证失效；原异常原样抛出。Figure 消费尝试过的真实时间戳，下一短帧按自己的间隔采样，而不重演失败的长间隔。显示样本、抓点、几何与 Figure 时钟一起提交；正常无安装、等待和业务拒绝保留原有状态，不当作异常回滚。接口拒绝重入和异步安装。

隐藏基础表面释放与提交后的反馈在安装成功之后执行。释放失败不能撤销已经显示的样本，也不能让 Player 与 Figure 的时钟倒退。自动取消、网络重试、旧运动回退、时间顺序与 1 DIP 支撑限制均不作为恢复手段。该私有播放接口不修改资源格式、公共 API 或数据库。

## Alternatives considered

- 吞掉绘制异常或取消动作：隐藏原错误并丢掉已确认支撑，不能保持真实播放状态。
- 允许播放器时间倒退：破坏支撑和过渡顺序，掩盖未显示的采样已提交。
- 绘制前先提交 Figure 时钟：异常后采样仍可能推进到未显示的支点和抓点。
- Figure 直接读写 Player 内部状态：越过职责边界，难以验证深层支撑与失败状态。
- 每次克隆全部资源或返回可变提交 token：扩大逐帧成本和生命周期，此同步安装边界无需这些能力。

## Consequences

只有逻辑播放状态可回滚。Canvas 已清空／部分绘制、DOM 已写的副作用不能凭事务撤销；位图认证失效后下一成功帧重新安装。动态快照增加少量逐次开销，未改变 16M 请求／32M图片缓存预算。完整帧仍受原画数量、物理支撑与比例约束，此恢复不证明自然人体、系统手拖或 tile 显存警告的根因。

这是[位图复用 Note](2026-10-05-pet-sequence-bitmap-reuse.md)所记录异常时钟局限的后续修复，原 c863 原生证据保留其源码范围，不升级为当前版本证据。正式资源和 App 未更新。

## Verification

新增 19 项真实生产 core／Player／Figure 测试：Canvas 与同位图 DOM 的 50→16、16→1、16→16、100→100ms 故障恢复，首次绘制、已显示后释放异常、深层支撑与过渡抓点回滚、1.2735 实际显示比例、正常 sticky 业务拒绝、无安装、重入和异步拒绝。使用受控浏览器故障边界，原 Error 身份保留，不需要 cancel 或 retry。100ms 为公开 core 诊断，不声称生产 rAF 超过 50ms 上限。

独立实现三文件 SHA588b425bb93addade73061e0e82f4887f223c4109294ea31ef9fb190450e53e2：Player5236ff63…、Figuree9db1ea1…、新测试7ef132bb…。19项及14文件347项相关回归、Web原生类型、局部lint／格式通过。首次测试期望码拼写失败保留并按实际 support-registration-mismatch 修正，不放宽生产限制。

主Agent读取完整增量与测试后，冻结15文件 f093e56bdfbd4f8c792e27a89d9c304fc5a29ce2dec85aef87aa2e8c4899ca6b（sorted compact JSON）。59文件1009项桌宠回归、完整 lint／桌面类型和 build 通过；已有 chunk／dynamicURL 警告保留。真实隔离 Electron 的短帧异常恢复另行记录，受控数值测试不冒充原生或新动作视觉通过。日志、原失败、实现前字节与冻结保存在忽略目录 sequence-presentation-transaction/。

### f093 原生呈现边界实测

新隔离 Electron 公开 Figure／Player 使用真实 Image、Canvas 与基础 GL，独立 SVG 注入一次 drawImage presenter 原异常。t0 Image1实际绘制；t=.05 Image2清空后抛原Error，画布全透明，不能声称像素回滚。下一普通16ms输入t=.066无cancel/reset/retry，Image1真实重绘、只读failure/progress仍null；.082/.098复用，.114实际绘制Image2，.130复用。共4clear、3成功draw、1异常attempt，原Error身份保持。主Agent实际读调用链与原生JSON，查看失败空白、下一短帧恢复和后续换图卡，故障边界范围通过，不冒充真实自发浏览器错误或完整App错误UI。

同隔离App只作两张完整候选静图固定比例对照，原尺寸1145×1374、统一modelBox保持，源alpha差0、PMA舍入差小于1/255。腿部400ms跳切明显，没有中间原画、反侧半周或承重交接，不能当自然行走通过。四条真实合成录像466帧，无补帧；编辑器暗主题平均29.316fps、最大gap195.549ms不满足笼统30fps，部分时间邻接卡仍同姿，不能说是精确首个新像素边界。

95规范源文件与15冻结文件前后一致；仅诊断项目CAS rev0→1后保持1，配置不变、lease=null、桌宠已关、自有进程0、模型请求0。报告在忽略目录 sequence-presentation-next-native/native-run-2026-10-05T01-51-31-010Z/report.md。未重新测trusted GL loss／VRAM／tile原因，未作OS手动运动验收，未更新正式资源或应用开发更新。
