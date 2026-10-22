import { useEffect, useReducer } from "react";
import { initialInterviewState, interviewReducer } from "./session";
import type { Devices, InterviewSession, InterviewState } from "./types";

/** Only the practice conversation is ephemeral. Preparation is owned by the API. */
export function useInterviewSession(
  blocked: boolean,
  session: InterviewSession,
  devices: Devices,
) {
  const [state, dispatch] = useReducer(
    interviewReducer,
    undefined,
    (): InterviewState => ({
      ...initialInterviewState(),
      session,
      devices,
      stage: "interview",
      touched: true,
    }),
  );
  useEffect(() => {
    if (state.stage !== "interview" || state.paused || blocked) return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => window.clearInterval(timer);
  }, [state.stage, state.paused, blocked]);
  useEffect(() => {
    if (state.stage !== "evaluating") return;
    const timer = window.setTimeout(
      () => dispatch({ type: "review-ready" }),
      900,
    );
    return () => window.clearTimeout(timer);
  }, [state.stage]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return { state, dispatch };
}
