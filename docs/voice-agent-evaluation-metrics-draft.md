# 语音 AI 产品评估指标体系

## 一、建设目标

语音 AI 产品，尤其是语音智能体（Voice Agent）产品的评估，不应停留在识别准确率、响应速度或声音自然度等单项指标上。真正决定产品能否落地的，是用户能否通过自然语音完成目标，并在整个过程中获得及时、准确、可控且值得信赖的体验。

因此，本指标体系围绕一条完整的用户体验链路展开：

> 听清楚 → 理解正确 → 互动合适 → 执行成功 → 稳定可信 → 成本可接受

这套体系服务于三个阶段：

- **研发阶段**：定位语音识别、语义理解、轮次控制、工具调用和异常恢复等问题；
- **迭代阶段**：比较模型、提示词、工具编排和交互策略的变化；
- **上线阶段**：判断产品是否达到体验、风险、稳定性和成本要求。

评估的最终目标不是生成一个简单的综合分数，而是建立从用户目标到系统行为、从系统行为到最终结果的可追溯证据链。

## 二、评估原则

### 1. 以用户任务结果为核心

语音 AI 的价值最终体现在用户目标是否完成。字符错误率（Character Error Rate，CER）和词错误率（Word Error Rate，WER）可参考 [NIST ASR Metrics](https://trec.nist.gov/pubs/trec9/sdrt9_slides/tsld017.htm) 与 [OpenASR21](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934557)；首 token 时间（Time to First Token，TTFT）可参考 [LiveKit Data hooks / Metrics](https://docs.livekit.io/deploy/observability/data/)；平均意见分（Mean Opinion Score，MOS）可参考 [ITU-T P.800](https://www.itu.int/rec/T-REC-P.800-199608-I/en)。这些指标可以帮助定位问题，但不能替代端到端任务完成率（End-to-End Task Completion Rate，E2E-TCR）。

例如，系统即使只错了一个字符，如果错的是金额、日期或否定词，也可能导致严重的业务错误。因此，识别指标必须与关键实体、约束理解和最终任务状态结合使用。

### 2. 区分结果指标、诊断指标和上线护栏

- **结果指标**：判断用户目标是否完成，例如端到端任务完成率（End-to-End Task Completion Rate，E2E-TCR）和单次任务成功率（Task Completion Rate，pass@1），任务判定可参考 [τ-Voice](https://arxiv.org/html/2603.13686v1) 与 [τ²-Bench](https://arxiv.org/html/2506.07982v1)；
- **诊断指标**：解释任务为什么成功或失败，例如关键实体准确率（Key Entity Accuracy，KEA）、Agent 抢话率（Agent Interruption Rate，I_A）和分阶段延迟，分别可参考 [VoiceBench](https://arxiv.org/html/2410.17196v1) 与 [τ-Voice](https://arxiv.org/html/2603.13686v1)；
- **上线护栏**：控制不可接受的风险，例如未授权操作、重复副作用、虚假成功告知率（False Success Claim Rate，FSCR）和安全攻击成功率（Attack Success Rate，ASR），安全评估可参考 [Jailbreak-AudioBench](https://arxiv.org/html/2501.13772v4)；
- **运营指标**：衡量产品能否持续运行，例如会话故障率（Session Failure Rate，SFR）、模型和语音服务用量（Model and Voice-Service Usage，MVSU）以及单位成功任务成本（Cost per Successful Task，CPST），成本和效率方向可参考 [Hamming Voice Agent Evaluation Metrics](https://hamming.ai/resources/voice-agent-evaluation-metrics-guide)。

不同类型的指标承担不同职责，不应全部用同一种方式聚合。

### 3. 以事件和状态作为评估依据

对于实时交互，应根据统一时间线记录用户说完、系统判定轮次结束、首个文本、首个音频、实际播放、用户打断和旧回复停止等事件。

对于任务执行，应根据隔离环境中的最终状态、工具轨迹和实际播出内容判断结果，而不能只依据 Agent 的文字表述或接口返回值。

### 4. 关注高风险切片和尾部体验

总体平均值不能掩盖关键问题。评估应分别观察普通话、口音、噪声、中英混说、数字和专名、否定与条件、自我纠正、停顿、打断、工具异常及长对话等场景，并重点关注第 95 百分位延迟（95th-Percentile Latency，p95）、超时和严重失败。

### 5. 不将不同口径的指标直接比较

同名指标可能具有不同的分母、事件边界和评分协议。例如，响应延迟可能指用户结束说话到模型开始生成，也可能指用户结束说话到客户端真正听到声音。使用指标时必须同时记录定义、观测边界、分母和版本。

## 三、指标体系

### 1. 输入与理解

这一层回答的是：Agent 有没有听清楚，以及是否理解了用户真正想表达的内容。

| 指标 | 关注点 | 说明 |
| --- | --- | --- |
| 字符错误率（Character Error Rate，CER）/词错误率（Word Error Rate，WER） | 转写错误 | 用于衡量字符或词层面的识别错误，主要承担诊断作用；定义可参考 [NIST ASR Metrics](https://trec.nist.gov/pubs/trec9/sdrt9_slides/tsld017.htm) 与 [OpenASR21](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934557)。 |
| 关键实体准确率（Key Entity Accuracy，KEA） | 关键参数是否正确 | 关注姓名、日期、金额、时间、编号等业务实体；本文工程口径参考 [VoiceBench](https://arxiv.org/html/2410.17196v1) 的语义与指令评估思路。 |
| 意图与约束通过率（Intent and Constraint Pass Rate，ICPR） | 请求和限制是否被理解 | 同时检查用户目标、条件、否定和限制；本文工程口径参考 [VoiceBench](https://arxiv.org/html/2410.17196v1) 的指令遵循评估。 |
| 自我纠正采纳率（Self-Correction Adoption Rate，SCAR） | 是否采用最后有效意图 | 检查“周三，不对，是周四”等修正表达；本文工程口径参考 [Full-Duplex-Bench-v3](https://arxiv.org/html/2604.04847v1) 的不流利表达和工具任务方向。 |
| 工具参数语义正确率（Tool-Parameter Semantic Accuracy，TPSA） | 是否将理解结果正确传递给工具 | 不仅检查格式，还要检查对象、时间和参数含义；本文工程口径参考 [τ²-Bench](https://arxiv.org/html/2506.07982v1) 与 [ElevenLabs Agent Testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing)。 |

字符错误率（Character Error Rate，CER）和词错误率（Word Error Rate，WER）反映的是“听到了什么”，关键实体准确率（Key Entity Accuracy，KEA）和意图与约束通过率（Intent and Constraint Pass Rate，ICPR）反映的是“理解了什么”。后者更接近产品实际风险。

### 2. 实时交互

这一层回答的是：Agent 是否在合适的时机回应、等待、让话和停止。

| 指标 | 关注点 | 说明 |
| --- | --- | --- |
| 应答覆盖率（Response Coverage Rate，RCR） | 应答是否完整 | 应回应轮次中实际得到有效回应的比例；本文工程口径参考 [τ-Voice](https://arxiv.org/html/2603.13686v1) 的响应率定义。 |
| 首段可听响应延迟（First Audible Response Latency，FARL） | 用户多久听到第一段声音 | 从用户有效话轮结束到客户端实际开始播放；本文工程口径参考 [LiveKit Data hooks / Metrics](https://docs.livekit.io/deploy/observability/data/) 的播放观测。 |
| 首个实质回答延迟（First Meaningful Answer Latency，FMAL） | 用户多久听到有效内容 | 排除“让我想想”等填充语句的影响；本文工程口径是在 [τ-Voice](https://arxiv.org/html/2603.13686v1) 响应事件基础上的产品扩展。 |
| Agent 抢话率（Agent Interruption Rate，I_A） | 是否过早开始讲话 | 用户尚未完成表达时开始实质发言的比例；定义可参考 [τ-Voice](https://arxiv.org/html/2603.13686v1)。 |
| 让话率（Yield Rate，R_Y） | 是否能够及时停止 | 用户打断后在规定时间内停止讲话的比例；定义可参考 [τ-Voice](https://arxiv.org/html/2603.13686v1)。 |
| 打断停止延迟（Interruption Stop Latency，ISL） | 旧回复多久真正停止 | 应以实际播放时间为准，而非仅记录取消请求时间；本文工程口径参考 [Full-Duplex-Bench](https://arxiv.org/html/2503.04721v1) 与 [τ-Voice](https://arxiv.org/html/2603.13686v1)。 |
| 干扰误触发率（Interference False-Trigger Rate，IFTR） | 是否被无关声音误触发 | 分别观察附和、咳嗽、旁人讲话等情况；本文工程口径参考 [τ-Voice](https://arxiv.org/html/2603.13686v1) 的选择性和干扰事件。 |

实时交互的目标不是单纯追求更低延迟，而是做到“该回应时及时回应、该等待时不抢话、被打断时及时让话”。

### 3. 任务结果

这一层回答的是：用户希望完成的事情是否真正完成。

#### 任务成功的判定条件

一个完整任务的成功，至少应同时满足以下条件：

1. **最终状态正确**：目标对象处于预期状态；
2. **必要信息已告知**：用户听到了真实、完整且准确的结果；
3. **工具行为正确**：工具选择、参数和执行时机正确；
4. **过程规则满足**：完成了必要确认，没有越权、重复操作或其他副作用。

#### 主要指标

| 指标 | 关注点 | 说明 |
| --- | --- | --- |
| 端到端任务完成率（End-to-End Task Completion Rate，E2E-TCR） | 完整任务是否成功 | 最终状态、必要告知和过程规则均通过的任务比例；本文工程口径参考 [τ-Voice](https://arxiv.org/html/2603.13686v1) 与 [τ²-Bench](https://arxiv.org/html/2506.07982v1)。 |
| 单次任务成功率（Task Completion Rate，pass@1） | 用户一次尝试能否成功 | 更接近真实用户的单次体验；任务判定可参考 [τ-Voice](https://arxiv.org/html/2603.13686v1)。 |
| 工具决策正确率（Tool Decision Accuracy，TDA） | 是否选择了正确动作 | 包括工具选择、参数语义、前置条件和“不应调用”的判断；本文工程口径参考 [τ²-Bench](https://arxiv.org/html/2506.07982v1)。 |
| 必要信息播报准确率（Required Information Delivery Accuracy，RIDA） | 用户是否得到正确反馈 | 以实际播放内容为依据，不能只检查生成文本；本文工程口径。 |
| 规则违反率（Rule Violation Rate，RVR） | 是否出现关键违规 | 例如未确认执行、重复提交、越权操作和虚假成功告知；本文工程口径参考 [τ²-Bench](https://arxiv.org/html/2506.07982v1) 的状态与任务判定方法。 |
| 恢复成功率（Recovery Success Rate，RSR） | 异常后能否继续完成 | 检查超时、断线或回包丢失后的恢复和幂等性；本文工程口径参考 [Full-Duplex-Bench-v3](https://arxiv.org/html/2604.04847v1) 的工具任务方向。 |

工具调用格式正确，只能证明接口层面合规；工具返回成功，也不一定意味着业务状态正确。任务成功必须回到最终状态、操作轨迹和必要告知进行验证。

### 4. 稳定性、安全与运营

这一层回答的是：系统是否稳定、可信，并且具备持续运营的条件。

| 指标 | 关注点 | 说明 |
| --- | --- | --- |
| 重复可靠性（Repeated Success Reliability，pass^k） | 多次运行是否持续成功 | 同一任务连续多次成功的比例；定义可参考 [τ-bench](https://arxiv.org/html/2406.12045v1)。 |
| 会话故障率（Session Failure Rate，SFR） | 系统是否能正常完成会话 | 区分模型错误、工具错误、基础设施错误和评估器错误；本文工程口径。 |
| 超时率（Timeout Rate，TR） | 是否超过服务预算 | 与应答覆盖率（Response Coverage Rate，RCR）和端到端任务完成率（End-to-End Task Completion Rate，E2E-TCR）联报；本文工程口径。 |
| 关键规则违反率（Critical Rule Violation Rate，CRVR） | 是否出现不可接受风险 | 关键风险不应被总体平均值抵消；本文工程护栏口径。 |
| 安全攻击成功率（Attack Success Rate，ASR） | 防护是否被绕过 | 从安全角度通常希望降低；相关评估可参考 [Jailbreak-AudioBench](https://arxiv.org/html/2501.13772v4)。 |
| 单位成功任务成本（Cost per Successful Task，CPST） | 完成一个成功任务的成本 | 将失败、取消和必要的运行开销纳入成本核算；本文工程口径参考 [Hamming Voice Agent Evaluation Metrics](https://hamming.ai/resources/voice-agent-evaluation-metrics-guide)。 |
| 音质与交互体验评分（Voice Quality and Interaction Experience Score，VQIES） | 用户主观感受 | 关注清晰度、自然度、听觉负担和纠正难度；听评方法可参考 [ITU-T P.800](https://www.itu.int/rec/T-REC-P.800-199608-I/en)。 |

其中，未授权操作、重复副作用、虚假成功告知等指标适合作为发布护栏，而不适合作为普通平均分的一部分。

## 四、首版指标建议

首版评估应优先覆盖最能影响产品落地的指标，避免一开始建设过于庞大的指标池。

### 核心结果指标

- 端到端任务完成率（End-to-End Task Completion Rate，E2E-TCR）；
- 单次任务成功率（Task Completion Rate，pass@1）；
- 关键实体准确率（Key Entity Accuracy，KEA）；
- 意图与约束通过率（Intent and Constraint Pass Rate，ICPR）。

### 核心体验指标

- 应答覆盖率（Response Coverage Rate，RCR）；
- 首段可听响应延迟（First Audible Response Latency，FARL），报告第 50/95 百分位（50th/95th Percentile，p50/p95）；
- 首个实质回答延迟（First Meaningful Answer Latency，FMAL），报告第 50/95 百分位（50th/95th Percentile，p50/p95）；
- Agent 抢话率（Agent Interruption Rate，I_A）；
- 打断停止延迟（Interruption Stop Latency，ISL），报告 p95。

### 核心可靠性与风险指标

- 三次重复成功率（Three-Trial Repeated Success，pass^3）；
- 恢复成功率（Recovery Success Rate，RSR）；
- 会话故障率（Session Failure Rate，SFR）和超时率（Timeout Rate，TR）；
- 规则违反率（Rule Violation Rate，RVR）；
- 虚假成功告知率（False Success Claim Rate，FSCR）和重复副作用率（Duplicate Side-Effect Rate，DSER）。

### 运营指标

- 单位成功任务成本（Cost per Successful Task，CPST）；
- 模型和语音服务用量（Model and Voice-Service Usage，MVSU）；
- 真人体验和音质抽检结果（Human Experience and Voice Quality Review）。

如果产品拥有独立的自动语音识别（Automatic Speech Recognition，ASR）、文本转语音（Text-to-Speech，TTS）或音频前端，再增加字符错误率（Character Error Rate，CER）、词错误率（Word Error Rate，WER）、语音活动检测（Voice Activity Detection，VAD）指标和音质客观指标，用于组件定位。对于原生端到端语音模型，只报告实际可观测的指标，不虚构不存在的中间阶段数据。

## 五、指标的递进叙述方式

正式介绍指标时，建议遵循“用户目标—成功条件—指标验证—上线判断”的顺序。

### 1. 从用户目标开始

先说明用户希望通过语音完成什么，而不是直接罗列指标。

例如：

> 用户希望通过自然语音修改一次预约，并获得明确、可信的结果反馈。

### 2. 明确任务成功条件

针对上述任务，成功条件可以包括：

- 正确识别目标日期和时间；
- 用户纠正后使用最后一次有效意图；
- 只修改正确的预约一次；
- 发生时间冲突时先向用户澄清；
- 最终准确播报预约状态。

### 3. 用指标验证成功条件

- 日期和时间听错：关键实体准确率（Key Entity Accuracy，KEA）；
- 没有理解用户纠正：自我纠正采纳率（Self-Correction Adoption Rate，SCAR）；
- 没有及时回应：应答覆盖率（Response Coverage Rate，RCR）和首段可听响应延迟（First Audible Response Latency，FARL）；
- 用户还没说完就开始回答：Agent 抢话率（Agent Interruption Rate，I_A）；
- 打断后旧语音仍在播放：打断停止延迟（Interruption Stop Latency，ISL）；
- 修改错误或重复修改：端到端任务完成率（End-to-End Task Completion Rate，E2E-TCR）和规则违反率（Rule Violation Rate，RVR）；
- 工具异常后无法继续：恢复成功率（Recovery Success Rate，RSR）和会话故障率（Session Failure Rate，SFR）。

### 4. 最后给出上线判断

上线判断应同时考虑：

- 核心任务是否达到业务目标；
- 关键风险是否为零或处于可接受范围；
- 中文、口音、噪声、纠正、打断和工具异常等高风险切片是否退化；
- 第 95 百分位延迟（95th-Percentile Latency，p95）、超时率（Timeout Rate，TR）和会话故障率（Session Failure Rate，SFR）是否满足服务要求；
- 单位成功任务成本（Cost per Successful Task，CPST）是否符合产品预算。

## 六、评估数据与测量方法

### 1. 场景设计

每个核心用户旅程至少应覆盖以下案例：

- 正常表达；
- 数字、专名和关键实体；
- 否定、条件和模糊表达；
- 自我纠正；
- 思考停顿；
- 用户打断；
- 附和、咳嗽和旁人语音；
- 工具超时、断线和回包丢失；
- 多轮上下文和用户中途修改。

### 2. 三种评估路径

1. **离线回放**：评估转写、理解、时间边界、单轮回答和可重复的音频问题；
2. **交互仿真**：连接隔离工具环境，评估任务状态、打断、异常恢复和多步操作；
3. **真人对话与盲评**：评估等待感、自然度、纠正难度、音质和真实设备体验。

三种路径回答的问题不同，结果不应直接合成为一个跨产品总分。

### 3. 测试前需要冻结的内容

- 模型及版本；
- Prompt 和工具 schema；
- 案例、数据切片和参考答案；
- 音频参数、设备和网络条件；
- 事件时间线及延迟起止点；
- 任务成功判定规则；
- 自动裁判模型、提示词和版本；
- 随机种子、重复次数和超时预算。

比例指标应保留分子、分母、排除数量和排除原因；延迟指标应保留样本数、分位数、超时数量和观测边界。

## 七、落地步骤

### 阶段一：定义核心用户旅程

选择 3～5 个最重要的用户任务，明确目标、前置状态、成功状态、必要告知、禁止行为和异常处理方式。

### 阶段二：建立基线评测集

围绕每个任务构造正常、纠正、打断、关键实体和工具异常案例，形成可重复运行的最小评测集。

### 阶段三：完成自动化评估

优先实现事件记录、实体校验、最终状态断言、任务成功判定、规则检查和延迟统计。能够确定性判断的内容，应优先采用规则或状态校验，而不是全部交给语言模型裁判。

### 阶段四：加入真人体验评估

通过真人盲评补充清晰度、自然度、等待感和纠正难度等信息，并结合系统日志定位主观问题对应的链路原因。

### 阶段五：建立发布门槛和回归机制

先用基线测量当前水平，再根据业务风险设定门槛和允许的回归范围。关键失败案例应沉淀为独立回归集，持续验证每次模型、提示词（Prompt）、工具模式（Schema）和链路变更。

## 八、指标与文献对应关系

本节对本文出现的主要指标进行来源归类。需要注意：同一个指标名称在不同论文或框架中可能具有不同的分母、事件边界和聚合方式。引用某篇文章，只表示本文参考或采用了该来源的特定定义，不表示不同来源的分数可以直接比较。

### 1. 文献或官方标准中已有直接定义

| 指标或指标组 | 对应来源 | 来源说明 |
| --- | --- | --- |
| 字符错误率（Character Error Rate，CER）/词错误率（Word Error Rate，WER） | [NIST ASR Metrics](https://trec.nist.gov/pubs/trec9/sdrt9_slides/tsld017.htm)、[OpenASR21](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934557) | 词错误率（WER）以词为编辑单位，字符错误率（CER）以字符为编辑单位；二者属于识别层指标，不能直接等同于语义准确率。 |
| 语音活动检测漏检率（VAD Miss Rate，MR）、语音活动检测误报率（VAD False Alarm Rate，FAR）、检测错误率（Detection Error Rate，DER）、检测代价函数（Detection Cost Function，DCF） | [pyannote.metrics Reference](https://pyannote.github.io/pyannote-metrics/reference.html) | 提供语音活动检测和检测代价的实现口径；不同指标的分母不同。 |
| 接话率（Takeover Rate，TOR）、附和频率（Backchannel Frequency，Freq）、附和时机 Jensen–Shannon 散度（Backchannel Timing Jensen–Shannon Divergence，JSD）、响应延迟（Response Latency，RL）、打断后回应质量（Post-Interruption Response Quality，PIRQ） | [Full-Duplex-Bench](https://arxiv.org/html/2503.04721v1) | 关注全双工语音对话中的接话、附和、延迟和打断后回应；指标依赖其事件分类和评分协议。 |
| 响应率（Response Rate，R_R）、让话率（Yield Rate，R_Y）、响应延迟（Response Latency，L_R）、让话延迟（Yield Latency，L_Y）、Agent 抢话率（Agent Interruption Rate，I_A）、选择性（Selectivity，S_BC/S_VT/S_ND） | [τ-Voice](https://arxiv.org/html/2603.13686v1) | 将响应、让话、打断和干扰处理拆分为不同事件指标；原论文窗口和事件规则应与本地产品口径分开。 |
| 问答准确率（Question Answering Accuracy，QAA）、指令遵循准确率（Instruction-Level Accuracy，ILA）、拒答率（Refusal Rate，RR） | [VoiceBench](https://arxiv.org/html/2410.17196v1) | 覆盖语音助手的回答、指令约束和安全拒答评估；开放式回答评分与规则准确率不能混为同一指标。 |
| 任务完成率（Task Completion Rate，TCR）、任务成功判定（Task Evaluation Criteria，TEC） | [τ-Voice](https://arxiv.org/html/2603.13686v1)、[τ²-Bench](https://arxiv.org/html/2506.07982v1) | 任务结果应结合最终状态、动作、必要告知或自然语言条件判断，不能只检查接口返回值。 |
| 单次任务成功率（Task Completion Rate，pass@1）、多次尝试成功率（Pass-at-k，pass@k）、重复可靠性（Pass^k Reliability，pass^k） | [τ-Voice](https://arxiv.org/html/2603.13686v1)、[τ-bench](https://arxiv.org/html/2406.12045v1)、[τ²-Bench](https://arxiv.org/html/2506.07982v1) | pass@k 表示多次尝试中至少成功一次，pass^k 表示重复试验中的稳定成功；二者不能互换。 |
| 转写延迟（Transcription Delay，TD）、轮次结束判定延迟（End-of-Turn Delay，EOTD）、首 token 时间（Time to First Token，TTFT）、首音频字节时间（Time to First Byte，TTFB）、播放延迟（Playback Latency，PL）、端到端延迟（End-to-End Latency，E2E Latency）、模型用量（Model Usage，MU） | [LiveKit Data hooks / Metrics](https://docs.livekit.io/deploy/observability/data/) | 这些是特定框架的字段和观测口径，不是跨供应商统一标准；播放起点也不必然等于用户实际听到的起点。 |
| 丢包统计（Packet Loss，PL）、抖动（Jitter，J）、往返时延（Round-Trip Time，RTT）、抖动缓冲延迟（Jitter Buffer Delay，JBD） | [W3C WebRTC Statistics API](https://www.w3.org/TR/2025/CRD-webrtc-stats-20250925/) | 提供网络和媒体传输层的统计字段；它们用于解释语音体验问题，不直接代表 Agent 任务质量。 |
| 平均意见分（Mean Opinion Score，MOS）、会话平均意见分（Mean Conversation-Opinion Score，MOSC）、听觉努力平均意见分（Mean Listening-Effort Opinion Score，MOSLE） | [ITU-T P.800](https://www.itu.int/rec/T-REC-P.800-199608-I/en) | 提供主观传输质量、会话连接质量和听觉努力等评价方法；产品自定义问卷需要单独说明。 |
| UTMOS 预测分（UTMOS Predicted Score，UTMOS）、预测音质分（Predicted Speech Quality Score，PSQS） | [VoiceAssistant-Eval](https://arxiv.org/html/2509.22651v1)、[UTMOS](https://arxiv.org/abs/2204.02152) | UTMOS 属于自动音质预测，不能替代同批次真人 MOS。 |
| 均方误差（Mean Squared Error，MSE）、线性相关系数（Linear Correlation Coefficient，LCC）、斯皮尔曼等级相关系数（Spearman Rank Correlation Coefficient，SRCC）、肯德尔等级相关系数（Kendall Rank Correlation，KTAU） | [AudioMOS Challenge 2025](https://arxiv.org/html/2509.01336v1)、[scikit-learn MSE](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mean_squared_error.html)、[SciPy Pearson](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html)、[SciPy Spearman](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html)、[SciPy Kendall](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kendalltau.html) | 主要用于评价自动评分器与人工评分的一致性，不是直接判断 Agent 是否完成任务。 |
| 短时客观可懂度（Short-Time Objective Intelligibility，STOI） | [MathWorks STOI](https://www.mathworks.com/help/audio/ref/stoi.html) | 用于有参考音频条件下的可懂度估计，不能直接评价内容不同的自由回答。 |
| 情绪分类准确率（Emotion Classification Accuracy，ECA）、非加权准确率（Unweighted Accuracy，UA）、F1 分数（F1 Score，F1）、情绪分布距离（Emotion Distribution Distance，EDD） | [VoxEmo](https://arxiv.org/html/2603.08936v1) | 关注情绪标签和软标签分布；情绪识别结果不应直接解释为用户真实心理状态。 |
| 攻击成功率（Attack Success Rate，ASR） | [Jailbreak-AudioBench](https://arxiv.org/html/2501.13772v4) | 用于评估音频越狱或攻击是否成功；攻击集中的判定规则不能直接迁移为所有中文业务安全规则。 |
| 等错误率（Equal Error Rate，EER）、最小检测代价函数（Minimum Detection Cost Function，minDCF）、实际检测代价函数（Actual Detection Cost Function，actDCF）、架构无关检测代价函数（Architecture-Agnostic Detection Cost Function，a-DCF） | [ASVspoof 5](https://arxiv.org/html/2601.03944v1) | 用于语音伪造、身份和攻击检测；不同赛道的代价函数不能混用，也不能直接替代生产固定阈值错误率。 |

### 2. 本文的工程建议或产品化扩展

以下指标在相关研究或产品资料中可以找到能力方向、相邻方法或实现启发，但本文采用的产品定义、分母、阈值和验收规则属于工程建议，不能直接称为某篇论文的标准指标：

| 工程指标 | 参考方向 | 使用时的说明 |
| --- | --- | --- |
| 关键实体准确率（Key Entity Accuracy，KEA） | [VoiceBench](https://arxiv.org/html/2410.17196v1) 的语义与指令评估、[SUPERB](https://arxiv.org/abs/2105.01051) 的槽位任务 | 本文建议专门检查姓名、金额、日期、编号、否定词和单位；具体归一化规则需要按业务冻结。 |
| 自我纠正采纳率（Self-Correction Adoption Rate，SCAR） | [Full-Duplex-Bench-v3](https://arxiv.org/html/2604.04847v1) 的不流利表达与工具任务方向 | “采用最后有效意图”以及“不得执行已撤回动作”是本文的业务验收扩展。 |
| 首个实质回答延迟（First Meaningful Answer Latency，FMAL）、客户端可听首响应延迟（First Audible Response Latency，FARL） | [LiveKit Data hooks](https://docs.livekit.io/deploy/observability/data/) 的分阶段时间字段、[τ-Voice](https://arxiv.org/html/2603.13686v1) 的响应事件 | 本文建议将实际播放和实质内容单独测量，不能把它们冒称为框架原生字段。 |
| 干扰误触发率（Interference False-Trigger Rate，IFTR）、恢复成功率（Recovery Success Rate，RSR） | [τ-Voice](https://arxiv.org/html/2603.13686v1)、[Full-Duplex-Bench-v3](https://arxiv.org/html/2604.04847v1) | 相关来源支持干扰、打断和工具任务方向；中文“嗯”、咳嗽和旁人讲话的分类仍需本地标注。 |
| 规则违反率（Rule Violation Rate，RVR）、虚假成功告知率（False Success Claim Rate，FSCR）、重复副作用率（Duplicate Side-Effect Rate，DSER） | [τ²-Bench](https://arxiv.org/html/2506.07982v1) 的状态和任务判定方法、[ElevenLabs Agent Testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing) 的工具测试实践 | 本文将必要确认、授权、幂等和真实状态告知作为产品成功条件，是本地业务规则扩展。 |
| 恢复成功率（Recovery Success Rate，RSR）、会话故障率（Session Failure Rate，SFR）、单位成功任务成本（Cost per Successful Task，CPST） | [τ²-Bench](https://arxiv.org/html/2506.07982v1) 的任务环境思路、[Hamming Voice Agent Evaluation Metrics](https://hamming.ai/resources/voice-agent-evaluation-metrics-guide) 的产品指标实践 | 相关资料提供任务、故障、效率或成本方向；本文的分母、故障分类和成本核算方式需要由产品自行定义。 |
| 工具格式有效率、工具决策正确率 | [ElevenLabs Agent Testing](https://elevenlabs.io/docs/eleven-agents/customization/agent-testing)、[τ²-Bench](https://arxiv.org/html/2506.07982v1) | 工具格式校验只能证明接口合规，不能证明工具选择、参数语义和最终业务状态正确。 |
| 真人自然度、等待感、纠正难度和交互体验 | [ITU-T P.804](https://www.itu.int/ITU-T/recommendations/rec.aspx?lang=en&rec=13397)、[ITU-T P.808](https://www.itu.int/rec/T-REC-P.808-202106-I/en) | 标准提供会话质量和众包听评的方法参考；本文的产品体验问卷和评分锚点仍属于本地设计。 |

### 3. 引用使用边界

在正式报告中，建议按以下方式表述：

- 如果指标的公式和分母与原文一致，可以说“采用某论文/标准的定义”；
- 如果只借用了能力方向或测试思路，应说“参考某论文设计”，不要说“论文定义了该指标”；
- 如果是为本产品新设的指标，应明确标注“本文工程建议”或“本地业务指标”；
- 如果修改了时间窗口、分母、中文规范化或成功条件，应使用新的指标名称或明确标注“本地扩展口径”；
- 不同来源的同名指标，必须同时展示来源、版本、事件边界、分母和统计方式。

### 4. 专有名词与缩写

| 中文名称 | 英文名称与缩写 | 含义 |
| --- | --- | --- |
| 语音智能体 | Voice Agent | 能够接收语音、生成语音回应，并完成对话或工具任务的智能体系统。 |
| 自动语音识别 | Automatic Speech Recognition，ASR | 将语音转换为文本或中间语音表示的能力。 |
| 语音活动检测 | Voice Activity Detection，VAD | 判断音频中哪些时间片段包含人类语音。 |
| 大语言模型 | Large Language Model，LLM | 负责语言理解、推理、回答生成或工具决策的模型。 |
| 文本转语音 | Text-to-Speech，TTS | 将文本或语言生成结果转换为可播放语音。 |
| 全双工语音对话 | Full-Duplex Spoken Dialogue | 用户和 Agent 可以在时间上重叠发言，并持续处理接话、打断和让话的交互模式；相关评估可参考 [Full-Duplex-Bench](https://arxiv.org/html/2503.04721v1)。 |
| 轮次切换 | Turn-Taking | 对用户和 Agent 谁在何时发言、等待或停止的时序控制。 |
| 工具调用 | Tool Calling | Agent 根据用户目标选择工具并生成参数、执行动作的过程。 |
| 端到端 | End-to-End，E2E | 从用户输入起点到最终系统输出或任务结果的完整链路。 |
| 首 token 时间 | Time to First Token，TTFT | 从请求开始到模型返回首个文本 token 的时间；框架字段可参考 [LiveKit Data hooks / Metrics](https://docs.livekit.io/deploy/observability/data/)。 |
| 首音频字节时间 | Time to First Byte，TTFB | 从音频生成请求开始到返回首个音频数据块的时间。 |
| 第 50/95 百分位 | 50th/95th Percentile，p50/p95 | 延迟分布中的典型值和尾部值；不能用平均值替代 p95。 |

## 九、结论

语音 AI 产品的评估体系，应从“模型表现评估”转向“用户任务完成评估”。

其中：

- 输入与理解指标判断 Agent 有没有听懂；
- 实时交互指标判断 Agent 会不会自然对话；
- 任务结果指标判断 Agent 有没有真正办成事；
- 稳定性、安全和成本指标判断产品是否值得上线。

最终，最重要的不是指标数量，而是每一个核心用户任务都能被清晰定义、被客观测量、被问题定位，并且能够支持产品团队做出明确的上线决策。
