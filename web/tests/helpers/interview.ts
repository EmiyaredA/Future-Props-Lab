import type {
  Bundle,
  PreparationTask,
  Room,
} from "@features/interview-assistant/api";

export function interviewBundle(task = "task-1", hash = "hash-1"): Bundle {
  return {
    schema_version: 1,
    task_id: task,
    input_hash: hash,
    material_summary: "交易看板项目：候选人负责交互与回归验证。",
    requirements: [
      {
        id: "r1",
        capability: "React 与可访问性",
        importance: "core",
        evidence: [{ file_id: "jd", location: "line:1", excerpt: "React" }],
      },
    ],
    experiences: [
      {
        id: "e1",
        title: "交易看板项目",
        summary: "负责键盘交互与回归验收",
        evidence: [
          {
            file_id: "resume",
            location: "paragraph:1",
            excerpt: "交易看板项目",
          },
        ],
        uncertainties: ["具体指标待本人确认"],
      },
    ],
    topics: [
      {
        id: "t1",
        title: "焦点管理与验证",
        summary: "围绕键盘访问设计测试",
        relevance: "岗位和项目交叉",
        version: "2026",
        source_ids: ["s1"],
        key_points: ["独立回归样本"],
      },
    ],
    sources: [1, 2, 3].map((i) => ({
      id: `s${i}`,
      url: `https://www.w3.org/WAI/test-${i}`,
      title: `官方来源 ${i}`,
      retrieved_at: "2026-10-22T00:00:00Z",
      published_at: null,
      version: null,
      excerpt: "可访问性原始参考片段",
      supports: ["t1"],
    })),
    questions: [1, 2, 3, 4, 5, 6].map((i) => ({
      id: `q${i}`,
      category: "项目实践",
      question: `真实蓝图问题 ${i}：解释交易看板的个人贡献与验证`,
      objective: "核实设计依据",
      requirement_ids: ["r1"],
      experience_ids: ["e1"],
      source_ids: ["s1"],
      answer_points: [
        "明确个人职责",
        "React 组件焦点管理",
        "使用独立回归样本验证",
      ],
      follow_ups: ["如何比较替代方案？"],
    })),
    first_round: ["q2", "q1", "q3"],
    rubric: [
      {
        dimension: "验证依据",
        question_ids: ["q1", "q2", "q3"],
        answer_points: ["对照基线"],
        common_gaps: ["缺少个人贡献"],
      },
    ],
    limitations: ["测试资料；来源内容仍需人工审阅"],
    material_complete: true,
  };
}
export function interviewTask(
  status: PreparationTask["status"] = "succeeded",
  id = "task-1",
): PreparationTask {
  return {
    id,
    room_id: "room-1",
    input_hash: "hash-1",
    input_version: 1,
    revision: 2,
    status,
    snapshot: {
      role: "前端工程师",
      jd: "React",
      resume: "交易看板项目",
      material: null,
      duration: "30",
    },
    result:
      status === "succeeded" || status === "needs_input"
        ? interviewBundle(id)
        : null,
    events: [
      {
        sequence: 1,
        kind: "search",
        message: "Codex 已完成一次联网检索",
        at: "2026-10-22T00:00:00Z",
        urls: [],
      },
    ],
    message: status === "succeeded" ? "本场资料已准备完成" : "任务等待执行",
    created_at: "2026-10-22T00:00:00Z",
    updated_at: "2026-10-22T00:00:00Z",
  };
}
export function interviewRoom(task?: PreparationTask): Room {
  return {
    id: "room-1",
    title: "前端工程师",
    revision: 0,
    input_version: task ? 1 : 0,
    active_task_id: task?.id || null,
    active_bundle_id: task?.status === "succeeded" ? task.id : null,
    materials: [],
    tasks: task ? [task] : [],
    created_at: "2026-10-22T00:00:00Z",
    updated_at: "2026-10-22T00:00:00Z",
  };
}
