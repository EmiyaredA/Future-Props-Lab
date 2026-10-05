# Agent Note: 完整序列提交后释放隐藏人物渲染表面

Status: implemented

## Problem

完整序列人物仍先构造原站姿渲染器，供首帧解码、拒绝反应和构造失败期间保持既有行为。成功切换到整帧后，原人物 WebGL 贴图、绘制 canvas 和脸部 2D 表面仍保留。底层渲染器同时持有换装选择与已加载 CPU 图片，直接 dispose 会破坏后续换装，因此不能把隐藏显示表面的生命周期等同于角色配置的生命周期。这是已确认的资源驻留路径；Chromium tile 警告是否由此产生尚未证实。

## Decision

HumanFigure 暴露幂等 releaseRenderSurface。它从实例移除原 WebGL 表面，调用原生 WEBGL_lose_context 扩展（可用时），清空两个 canvas 的尺寸并移除其 foreignObject；保留 CPU 图片缓存、已接受的 scheme、选择代次、资源校验、失败与重选语义。final dispose 单独终止选择并释放仍存在的表面。

SequenceFigure 仅在真实整帧 drawImage、DOM 可见标记及 displayed 提交成功后释放底层表面。等待解码、读取失败、反应拒绝、构造异常和未成功绘制不提前释放。新接口是可选显示能力，旧鲸鱼实现不被强制改变。

退役后 setScheme 继续加载和校验、更新已接受配置，不上传贴图、不恢复 GL。若调用底层公开 draw，渲染器用同一模型单位和已接受图片建立新的 canvas 和原生上下文，再挂载；不复用已 loss 的旧 canvas。已最终 dispose 的实例不允许恢复。旧无序列包继续沿用实际站姿、坐姿、表情与换装路径。

## Alternatives considered

- 提前 final dispose 底层实例：会终止 scheme 选择，改变 wrapper 的配置与恢复语义。
- 首次构造延迟创建 GL：首个等待态仍须绘制真实原站姿，不能解决成功切换后驻留。
- 只隐藏原 foreignObject：不会释放 WebGL 和脸部绘制表面。

## Consequences

CPU 图片和加载缓存继续由角色实例持有；此改动不声称完整角色内存归零。恢复底层 draw 会重新创建和上传表面，有明确成本，正常完整序列循环与换装不会触发该恢复。没有降低像素分辨率、禁用 GPU、改变预算或资源、恢复旧运动或修改数据库。

## Verification

新 13 项测试通过真实生产 HumanFigure、createRig 与 SequenceFigure 的调用链，覆盖首次完整帧提交、解码/图片边界/Canvas/DOM 失败、等待期间原站姿、重复退役/最终清理、新画布恢复、换装失败与重选、在途选择、迟到失败、旧站坐/表情/三服饰。7 文件 103 项相关回归、原生 Web TypeScript、局部 ESLint 和格式检查通过。测试采用受控浏览器 API，证明所有权、上传路由、几何与尺寸；不是本版原生 Electron GL、OS 合成或视觉验收。早期 native wrapper 故障报告保留为历史版本证据。完整仓库门禁及本版实际隔离 App 回归由后续整合执行。

### 整合与原生表面验证（2026-10-05）

53 文件 904 项桌宠相关 Web 测试、完整 lint、format、Web 类型与构建、contracts/SDK stale-check 通过（535具名操作／811 schema）。官方静态管理员导入包生成与检查通过（12库105篇）；未写入数据库或自动发布。4文件冻结哈希5358a7246108bbe2ffe5c026473403f5454508243255baa5b79c893beb07ffcd用于这些检查，之前fa8d…版本不能替代本版证据。

独立实际隔离Electron报告保存于sequence-surface-retirement-native/report.md。原生WEBGL_lose_context事件isTrusted、真实isContextLost、站姿及detached脸部canvas尺寸0和foreignObject移除共同证明表面退出；cold decode等待和初次whole PNG HTTP失败时原站姿表面仍存活。原生产draw提交与wrapper dispose按实际调用栈分别归因，不把旧请求取消归为成功退休。17份1145×1374原生Canvas与原PNG比对alpha最大差0、PMA最大低于1个8bit单位，modelBox不变；不是literal RGBA字节相同或显存分配测量。经典同图两scheme诊断副本只验证选择／失败／重选，不冒充实验室或女仆新素材。真实UI覆盖换装错误alert、明暗editor/pet、聊天优先联动暂停、关闭恢复；config/revision0未变、3轮自有进程均0。

首轮故障UI断言失败保留：初始化异常确有dispose，但并发较新初始化已恢复，不能因此声称原错误可见。补充run的初次whole PNG加载失败站姿仍可见，但未出现加载错误文字，这是后续修复缺口。Mac锁屏，原生Canvas/DOM证据不等于OS合成视觉验收；未覆盖全动作、三服饰、鲸鱼、世界支点及原生拖拽。无tile警告不证明其根因已经消除。全部正式资源与App发布门禁仍未通过。

### 后续加载反馈与恢复验证

首次PNG失败缺少提示的缺口由[完整帧加载失败反馈与明确恢复](2026-10-05-pet-sequence-asset-failure.md)处理。159b版本加载alert恢复后顶部状态仍残留的FAIL保留；32434a新运动hook在实际提交后清除旧fatal，独立原生回归同时核对了pending期间原GL存活、实际draw导致原生trusted contextlost及0×0表面移除。新报告只覆盖加载恢复与表面所有权；不改变本Note对tile根因、显存字节和动作自然性未获证明的边界。

