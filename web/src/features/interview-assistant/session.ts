import { createSession, example } from "./model";
import type {
  Devices,
  InterviewInput,
  InterviewSession,
  InterviewState,
} from "./types";

export type InterviewAction =
  | {
      type: "edit";
      form: InterviewInput | ((previous: InterviewInput) => InterviewInput);
    }
  | { type: "prepare" }
  | { type: "job-tick"; attempt: number }
  | { type: "job-failed"; attempt: number }
  | { type: "materials" }
  | { type: "start"; devices: Devices; session?: InterviewSession }
  | { type: "draft"; value: string }
  | { type: "submit" }
  | { type: "end" }
  | { type: "tick" }
  | { type: "pause" }
  | { type: "device"; device: keyof Devices }
  | { type: "review-ready" }
  | { type: "reset" };

export function initialInterviewState(): InterviewState {
  return {
    form: { ...example },
    touched: false,
    session: null,
    stage: "materials",
    jobStep: 0,
    jobStatus: "loading",
    attempt: 0,
    index: 0,
    answers: [],
    draft: "",
    seconds: 0,
    paused: false,
    devices: { mic: true, camera: true },
  };
}

function withCurrentAnswer(state: InterviewState) {
  const question = state.session?.questions[state.index];
  return question && state.draft.trim()
    ? [
        ...state.answers,
        {
          question: question.title,
          category: question.category,
          text: state.draft.trim(),
          at: state.seconds,
        },
      ]
    : state.answers;
}

export function interviewReducer(
  state: InterviewState,
  action: InterviewAction,
): InterviewState {
  switch (action.type) {
    case "edit":
      return state.stage === "materials"
        ? {
            ...state,
            form:
              typeof action.form === "function"
                ? action.form(state.form)
                : { ...action.form },
            touched: true,
          }
        : state;
    case "prepare":
      if (
        !state.form.role.trim() ||
        !state.form.jd.trim() ||
        !state.form.resume.trim()
      )
        return state;
      return {
        ...state,
        session: createSession(state.form),
        stage: "preparation",
        touched: true,
        attempt: state.attempt + 1,
        jobStep: 0,
        jobStatus: "loading",
      };
    case "job-tick":
      if (
        state.stage !== "preparation" ||
        action.attempt !== state.attempt ||
        state.jobStatus !== "loading"
      )
        return state;
      return state.jobStep < 3
        ? { ...state, jobStep: state.jobStep + 1 }
        : { ...state, jobStep: 4, jobStatus: "ready" };
    case "job-failed":
      return state.stage === "preparation" &&
        state.attempt === action.attempt &&
        state.jobStatus === "loading"
        ? { ...state, jobStatus: "failed" }
        : state;
    case "materials":
      return {
        ...state,
        stage: "materials",
        attempt: state.attempt + 1,
        session: null,
      };
    case "start":
      if (!action.session && (!state.session || state.jobStatus !== "ready"))
        return state;
      return {
        ...state,
        session: action.session || state.session,
        devices: action.devices,
        stage: "interview",
        index: 0,
        answers: [],
        draft: "",
        seconds: 0,
        paused: false,
        touched: true,
      };
    case "draft":
      return state.stage === "interview" && !state.paused
        ? { ...state, draft: action.value }
        : state;
    case "submit": {
      if (
        state.stage !== "interview" ||
        state.paused ||
        !state.draft.trim() ||
        !state.session
      )
        return state;
      const last = state.index === state.session.questions.length - 1;
      return {
        ...state,
        answers: withCurrentAnswer(state),
        draft: "",
        index: last ? state.index : state.index + 1,
        stage: last ? "evaluating" : "interview",
      };
    }
    case "end":
      return state.stage === "interview"
        ? {
            ...state,
            answers: withCurrentAnswer(state),
            draft: "",
            stage: "evaluating",
          }
        : state;
    case "tick":
      return state.stage === "interview" && !state.paused
        ? { ...state, seconds: state.seconds + 1 }
        : state;
    case "pause":
      return state.stage === "interview"
        ? { ...state, paused: !state.paused }
        : state;
    case "device":
      return {
        ...state,
        devices: {
          ...state.devices,
          [action.device]: !state.devices[action.device],
        },
      };
    case "review-ready":
      return state.stage === "evaluating"
        ? { ...state, stage: "review" }
        : state;
    case "reset":
      return { ...initialInterviewState(), attempt: state.attempt + 1 };
  }
}
