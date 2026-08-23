export type RealtimeVoiceStatus =
  | "idle"
  | "preparing"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "ended"
  | "error";

export type RealtimeVoiceState = {
  status: RealtimeVoiceStatus;
  activeUserTurnId: string | null;
  activeAssistantTurnId: string | null;
  userTranscript: string;
  assistantTranscript: string;
  firstAudioLatencyMs: number | null;
  startedAt: number | null;
  userTurnStartedAt: number | null;
  error: string;
  retryable: boolean;
};

export const initialRealtimeVoiceState: RealtimeVoiceState = {
  status: "idle",
  activeUserTurnId: null,
  activeAssistantTurnId: null,
  userTranscript: "",
  assistantTranscript: "",
  firstAudioLatencyMs: null,
  startedAt: null,
  userTurnStartedAt: null,
  error: "",
  retryable: false,
};

type ServerEvent = Record<string, unknown> & { type: string };
export type RealtimeVoiceAction =
  | { type: "prepare" }
  | { type: "connecting" }
  | { type: "server"; event: ServerEvent; now: number }
  | { type: "local_error"; message: string; retryable?: boolean }
  | { type: "reset" };

export function realtimeVoiceReducer(
  state: RealtimeVoiceState,
  action: RealtimeVoiceAction,
): RealtimeVoiceState {
  if (action.type === "reset") return initialRealtimeVoiceState;
  if (action.type === "prepare") {
    return { ...initialRealtimeVoiceState, status: "preparing" };
  }
  if (action.type === "connecting") return { ...state, status: "connecting" };
  if (action.type === "local_error") {
    return {
      ...initialRealtimeVoiceState,
      status: "error",
      error: action.message,
      retryable: Boolean(action.retryable),
    };
  }

  const event = action.event;
  const text = String(event.text || "");
  const turnId = String(event.turn_id || "") || null;
  switch (event.type) {
    case "call_started":
      return {
        ...initialRealtimeVoiceState,
        status: "connected",
        startedAt: action.now,
      };
    case "user_speech_started":
      return {
        ...state,
        status: "listening",
        activeUserTurnId: turnId,
        userTranscript: "",
        assistantTranscript:
          state.status === "speaking" ? "" : state.assistantTranscript,
        firstAudioLatencyMs: null,
        userTurnStartedAt: action.now,
        error: "",
        retryable: false,
      };
    case "user_speech_stopped":
      return { ...state, status: "thinking" };
    case "user_transcript_delta":
      return { ...state, userTranscript: state.userTranscript + text };
    case "user_transcript":
      return { ...state, userTranscript: text || state.userTranscript };
    case "user_transcription_empty":
      return {
        ...state,
        status: "connected",
        activeUserTurnId: null,
        userTranscript: "未识别到有效语音，请再说一次。",
      };
    case "user_transcription_failed":
      return {
        ...state,
        status: "connected",
        activeUserTurnId: null,
        error: String(event.message || "本轮语音转写失败，请再说一次。"),
        retryable: false,
      };
    case "assistant_transcript_delta":
      return {
        ...state,
        status: "speaking",
        activeAssistantTurnId: turnId,
        assistantTranscript: state.assistantTranscript + text,
      };
    case "assistant_transcript_done":
      return {
        ...state,
        status: "speaking",
        activeAssistantTurnId: turnId,
        assistantTranscript: text || state.assistantTranscript,
      };
    case "audio":
      return {
        ...state,
        status: "speaking",
        activeAssistantTurnId: turnId,
        firstAudioLatencyMs:
          state.firstAudioLatencyMs ??
          (state.userTurnStartedAt == null
            ? null
            : Math.max(0, Math.round(action.now - state.userTurnStartedAt))),
      };
    case "turn_done":
      return {
        ...state,
        status: "connected",
        activeUserTurnId: null,
        activeAssistantTurnId: null,
      };
    case "interrupt":
      return { ...state, status: "listening", activeAssistantTurnId: null };
    case "error":
      return {
        ...state,
        status: "error",
        error: String(event.message || "实时语音连接失败。"),
        retryable: Boolean(event.retryable),
      };
    case "call_ended":
      return {
        ...initialRealtimeVoiceState,
        status: state.status === "error" ? "error" : "ended",
        error: state.error,
        retryable: state.retryable,
      };
    default:
      return state;
  }
}
