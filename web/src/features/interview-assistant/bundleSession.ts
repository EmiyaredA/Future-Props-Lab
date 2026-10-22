import type { Bundle, PreparationTask } from "./api";
import { interviewDate } from "./api";
import type { InterviewSession } from "./types";

export function sessionFromBundle(
  task: PreparationTask,
  bundle: Bundle,
): InterviewSession {
  const input = task.snapshot;
  return {
    id: task.id,
    createdAt: interviewDate(task.created_at).toLocaleString("zh-CN"),
    role: input.role,
    jd: input.jd,
    resume: input.resume || bundle.material_summary,
    filename: input.material?.filename || "",
    duration: input.duration,
    assistant: "Codex",
    project: bundle.experiences[0]?.title || "项目经历",
    focus: bundle.requirements.map((item) => item.capability),
    questions: bundle.first_round
      .map((id) => bundle.questions.find((item) => item.id === id)!)
      .map((question) => ({
        category: question.category,
        title: question.question,
        basis: `${question.objective} · 岗位 ${question.requirement_ids.join("、")} · 经历 ${question.experience_ids.join("、") || "通用"} · 来源 ${question.source_ids.join("、")}`,
        sample: question.answer_points.join("\n"),
      })),
    preparation: { taskId: task.id, inputVersion: task.input_version, bundle },
  };
}
