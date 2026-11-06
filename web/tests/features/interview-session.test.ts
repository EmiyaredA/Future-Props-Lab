import {
  createSession,
  example,
  buildReport,
  makeFeedback,
} from "@features/interview-assistant/model";
import {
  initialInterviewState,
  interviewReducer,
} from "@features/interview-assistant/session";
import { parseRoute, pathFor, isWorkshopPage } from "@app/routes";

test("interview entry resolves as a native workshop route", () => {
  expect(parseRoute("/apps/interview-assistant/")).toEqual({
    page: "interview-assistant-session",
  });
  expect(pathFor("interview-assistant-session")).toBe(
    "/apps/interview-assistant",
  );
  expect(isWorkshopPage("interview-assistant-session")).toBe(true);
});

test("questions use the submitted JD and resume snapshot", () => {
  const input = {
    ...example,
    role: "前端工程师",
    jd: "React、产品协作和交互设计",
    resume: "交易看板项目\n负责可访问性改进",
  };
  const session = createSession(input);
  input.resume = "改动后的材料";
  expect(session.questions[0].title).toContain("交易看板项目");
  expect(session.questions[1].title).toContain("React");
  expect(session.questions[1].title).not.toContain("检索失败");
  expect(session.questions[2].title).toContain("前端工程师");
  expect(session.resume).toContain("可访问性");
  expect(createSession(example).questions[1].title).toContain(
    "检索失败与生成失败",
  );
});

test("cancelled and superseded preparation callbacks cannot alter the current task", () => {
  let state = interviewReducer(initialInterviewState(), { type: "prepare" });
  const oldAttempt = state.attempt;
  state = interviewReducer(state, { type: "materials" });
  const cancelled = state;
  expect(
    interviewReducer(state, { type: "job-tick", attempt: oldAttempt }),
  ).toBe(cancelled);
  state = interviewReducer(state, { type: "prepare" });
  expect(
    interviewReducer(state, { type: "job-failed", attempt: oldAttempt }),
  ).toBe(state);
  state = interviewReducer(state, {
    type: "job-failed",
    attempt: state.attempt,
  });
  expect(state.jobStatus).toBe("failed");
  const failedAttempt = state.attempt;
  state = interviewReducer(state, { type: "prepare" });
  expect(state.jobStatus).toBe("loading");
  expect(
    interviewReducer(state, { type: "job-tick", attempt: failedAttempt }),
  ).toBe(state);
  for (let i = 0; i < 4; i++)
    state = interviewReducer(state, {
      type: "job-tick",
      attempt: state.attempt,
    });
  expect(state.jobStatus).toBe("ready");
});

test("pause stops time and submissions; early end preserves the current draft once", () => {
  let state = interviewReducer(initialInterviewState(), {
    type: "start",
    devices: { mic: true, camera: true },
    session: createSession(example),
  });
  state = interviewReducer(state, {
    type: "draft",
    value: "我负责基线评估和回归验证。",
  });
  state = interviewReducer(state, { type: "tick" });
  state = interviewReducer(state, { type: "pause" });
  expect(interviewReducer(state, { type: "tick" })).toBe(state);
  expect(interviewReducer(state, { type: "submit" })).toBe(state);
  state = interviewReducer(state, { type: "end" });
  expect(state.answers).toEqual([
    expect.objectContaining({ text: "我负责基线评估和回归验证。", at: 1 }),
  ]);
  expect(interviewReducer(state, { type: "end" })).toBe(state);
  const report = buildReport(state.session!, state.answers, state.seconds);
  expect(report).toContain("00:01");
  expect(report).toContain("我负责基线评估和回归验证。");
  expect(report).toContain("模拟版");
  expect(makeFeedback(state.answers)[0].excerpt).toBe(state.answers[0].text);
});

test("empty sessions create no invented feedback and reset clears all records", () => {
  let state = interviewReducer(initialInterviewState(), {
    type: "start",
    devices: { mic: false, camera: false },
    session: createSession(example),
  });
  state = interviewReducer(state, { type: "end" });
  state = interviewReducer(state, { type: "review-ready" });
  expect(state.stage).toBe("review");
  expect(makeFeedback(state.answers)).toEqual([]);
  expect(buildReport(state.session!, state.answers, 0)).toContain(
    "已回答：0 / 3",
  );
  state = interviewReducer(state, { type: "reset" });
  expect(state.session).toBeNull();
  expect(state.answers).toEqual([]);
  expect(state.touched).toBe(false);
});
