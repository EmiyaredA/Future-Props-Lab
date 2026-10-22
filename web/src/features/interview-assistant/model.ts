import type {
  InterviewInput,
  InterviewSession,
  InterviewAnswer,
  InterviewFeedback,
} from "./types";

export const example: InterviewInput = {
  role: "AI 应用工程师",
  jd: "负责企业 AI 应用的设计与落地，构建 RAG 与 Agent 工作流。\n能设计离线评估与线上监控，理解检索质量、模型输出与服务可靠性的取舍。\n熟悉 Python、API 设计与故障恢复，能清晰解释技术决策和个人贡献。",
  resume:
    "客服 RAG 项目\n负责知识检索与问答链路，使用 Python 搭建服务，参与文档切分、召回优化和评估。\n搭建 Agent 工具调用原型，为内部业务提供自动化支持。",
  filename: "个人简历 · 示例.pdf",
  duration: "30",
  assistant: "Codex",
};

export const preparationSteps = [
  "解析岗位与简历",
  "检索相关资料",
  "整理提问与评估依据",
  "校验并保存知识包",
];
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export function createSession(form: InterviewInput): InterviewSession {
  const role = form.role.trim() || "目标岗位";
  const project = (
    form.resume.trim().split("\n").find(Boolean) || "项目经历"
  ).slice(0, 36);
  const tags = [
    "RAG",
    "Agent",
    "Python",
    "React",
    "评估",
    "可靠性",
    "产品",
    "设计",
    "运营",
  ].filter((tag) => form.jd.toLowerCase().includes(tag.toLowerCase()));
  const focus = tags.length
    ? tags.slice(0, 3)
    : ["岗位理解", "项目能力", "问题解决"];
  const isRag = /rag|检索/i.test(form.jd + form.resume);
  return {
    ...form,
    role,
    project,
    focus,
    id: `interview-${Date.now()}`,
    createdAt: new Date().toLocaleString("zh-CN"),
    questions: [
      {
        category: "经历与贡献",
        title: `请结合简历中的「${project}」，介绍你负责的部分，以及最重要的一次技术取舍。`,
        basis: "简历经历",
        sample: `在${project}中，我主要负责方案设计和评估。我先明确业务目标，再比较实现方案，选择可验证、便于维护的路径。遇到的关键取舍是效果与响应时延，需要通过对照实验和线上反馈共同判断。`,
      },
      {
        category: "技术判断",
        title: isRag
          ? `在「${project}」中，你会如何区分检索失败与生成失败？请说明验证方法。`
          : `这个岗位强调「${focus[0]}」。请结合「${project}」，说明你如何定位问题、验证解决方案。`,
        basis: "JD × 项目交叉追问",
        sample: isRag
          ? "我会先用带标准答案和相关文档标注的样本，分开评估检索与生成。首先检查召回内容能否支持答案，再用固定的参考上下文测试生成。如果相关文档未进入上下文，优先查召回与排序；如果上下文足够但回答错误，再排查提示词与模型。最后用独立测试集做回归。"
          : `我会先把${focus[0]}拆成可观察的目标，复现问题并建立基线。然后比较替代方案，用独立样本验证结果，同时检查副作用，最终通过灰度和监控确认改进。`,
      },
      {
        category: "可靠性与协作",
        title: `作为${role}，如果你的方案上线后效果下降，你会如何止损、排查并向团队同步？`,
        basis: "岗位要求",
        sample:
          "我会先确认影响范围，通过回滚或降级恢复服务。排查时保留版本、输入与日志，分别检查数据、依赖和配置变化。同步时明确已知事实、风险与下一次更新时间。修复后补充回归测试与告警，并复盘责任边界和恢复流程。",
      },
    ],
  };
}

export function makeFeedback(
  answers: readonly InterviewAnswer[],
): InterviewFeedback[] {
  return answers.map((answer, index) => {
    const short = answer.text.trim().length < 90;
    const concrete = /\d|对照|样本|验证|回归|指标|基线/.test(answer.text);
    return {
      ...answer,
      index,
      title: short
        ? "补充具体过程，让结论更有依据"
        : concrete
          ? "保留验证思路，进一步说明个人贡献"
          : "补充可验证的方法与结果",
      detail: short
        ? "这段回答较简短。可以按“结论 → 自己的行动 → 判断依据 → 结果”展开，再补一个真实例子。"
        : concrete
          ? "回答中出现了验证或对照思路。建议明确哪些动作由你完成，以及如何判断方案有效。"
          : "已有行动描述，可以补充基线、比较对象与验证方式。没有真实数据时，说明验证计划，不编造指标。",
      excerpt: answer.text.trim().slice(0, 88) || "本题没有提交回答。",
    };
  });
}

export function buildReport(
  session: InterviewSession,
  answers: readonly InterviewAnswer[],
  seconds: number,
) {
  return `# ${session.role} · 模拟面试复盘\n\n> 面试助手模拟版。复盘反馈基于实际回答的文本规则，不进行模型评分或真实音视频分析；资料准备的来源见本场资料版本。\n\n- 时长：${formatTime(seconds)}\n- 已回答：${answers.length} / ${session.questions.length}\n- 准备助手：${session.assistant}${session.preparation ? "（真实资料准备）" : "（模拟）"}\n\n## 岗位 JD\n${session.jd}\n\n## 简历摘要\n${session.resume}\n\n${session.preparation ? `## 本场资料版本\n输入版本：${session.preparation.inputVersion}\n任务：${session.preparation.taskId}\n${session.preparation.bundle.sources.map((source) => `- ${source.title}：${source.url}`).join("\n")}\n\n` : ""}## 回答与反馈\n${makeFeedback(
    answers,
  )
    .map(
      (item) =>
        `### ${formatTime(item.at)} · ${item.question}\n\n${item.text}\n\n**${item.title}**\n${item.detail}`,
    )
    .join(
      "\n\n",
    )}\n\n## 简历建议\n围绕「${session.project}」，补充个人职责、关键取舍、验证方法与可核实的结果。所有指标请由本人确认。\n`;
}
