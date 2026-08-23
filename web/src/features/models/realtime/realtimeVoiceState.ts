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

export type RealtimeVoiceTurn = {
  turnId: string;
  userTranscript: string;
  assistantTranscript: string;
  toolCalls: RealtimeVoiceToolCall[];
};

export type RealtimeVoiceToolCall = {
  id: string;
  callId: string;
  toolId: string | null;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "proposed" | "running" | "completed" | "failed" | "cancelled";
  success: boolean | null;
  result: unknown;
  errorCode: string;
  errorMessage: string;
  durationMs: number;
};

export type RealtimeVoiceState = {
  status: RealtimeVoiceStatus;
  activeUserTurnId: string | null;
  activeAssistantTurnId: string | null;
  userTranscript: string;
  assistantTranscript: string;
  turns: RealtimeVoiceTurn[];
  toolIds: string[];
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
  turns: [],
  toolIds: [],
  firstAudioLatencyMs: null,
  startedAt: null,
  userTurnStartedAt: null,
  error: "",
  retryable: false,
};

type ServerEvent = Record<string, unknown> & { type: string };
export type RealtimeVoiceAction =
  | { type: "prepare"; toolIds: string[] }
  | { type: "connecting" }
  | { type: "server"; event: ServerEvent; now: number }
  | { type: "local_error"; message: string; retryable?: boolean }
  | { type: "reset" };

function updateTurn(
  turns: RealtimeVoiceTurn[],
  turnId: string | null,
  patch: Partial<Omit<RealtimeVoiceTurn, "turnId">>,
) {
  if (!turnId) return turns;
  const index = turns.findIndex((turn) => turn.turnId === turnId);
  if (index < 0) {
    return [
      ...turns,
      {
        turnId,
        userTranscript: "",
        assistantTranscript: "",
        toolCalls: [],
        ...patch,
      },
    ];
  }
  return turns.map((turn, turnIndex) =>
    turnIndex === index ? { ...turn, ...patch } : turn,
  );
}

function turnById(turns: RealtimeVoiceTurn[], turnId: string | null) {
  return turns.find((turn) => turn.turnId === turnId);
}

export function realtimeVoiceReducer(
  state: RealtimeVoiceState,
  action: RealtimeVoiceAction,
): RealtimeVoiceState {
  if (action.type === "reset") return initialRealtimeVoiceState;
  if (action.type === "prepare") {
    return {
      ...initialRealtimeVoiceState,
      status: "preparing",
      toolIds: action.toolIds,
    };
  }
  if (action.type === "connecting") return { ...state, status: "connecting" };
  if (action.type === "local_error") {
    return {
      ...state,
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
        toolIds: state.toolIds,
      };
    case "user_speech_started": {
      const nextTurnId = turnId ?? `user-${Math.round(action.now)}`;
      return {
        ...state,
        status: "listening",
        activeUserTurnId: nextTurnId,
        activeAssistantTurnId: null,
        userTranscript: "",
        assistantTranscript: "",
        turns: updateTurn(state.turns, nextTurnId, {
          userTranscript: "",
          assistantTranscript: "",
        }),
        firstAudioLatencyMs: null,
        userTurnStartedAt: action.now,
        error: "",
        retryable: false,
      };
    }
    case "user_speech_stopped":
      return { ...state, status: "thinking" };
    case "user_transcript_delta": {
      // Realtime ASR partials are replaceable hypotheses, not token deltas.
      const nextText = text || state.userTranscript;
      const userTurnId = turnId ?? state.activeUserTurnId;
      return {
        ...state,
        userTranscript: nextText,
        turns: updateTurn(state.turns, userTurnId, {
          userTranscript: nextText,
        }),
      };
    }
    case "user_transcript": {
      const nextText = text || state.userTranscript;
      const userTurnId = turnId ?? state.activeUserTurnId;
      return {
        ...state,
        userTranscript: nextText,
        turns: updateTurn(state.turns, userTurnId, {
          userTranscript: nextText,
        }),
      };
    }
    case "user_transcription_empty": {
      const emptyMessage = "未识别到有效语音，请再说一次。";
      const userTurnId = turnId ?? state.activeUserTurnId;
      return {
        ...state,
        status: "connected",
        activeUserTurnId: null,
        userTranscript: emptyMessage,
        turns: updateTurn(state.turns, userTurnId, {
          userTranscript: emptyMessage,
        }),
      };
    }
    case "user_transcription_failed":
      return {
        ...state,
        status: "connected",
        activeUserTurnId: null,
        error: String(event.message || "本轮语音转写失败，请再说一次。"),
        retryable: false,
      };
    case "assistant_transcript_delta": {
      const assistantTurnId =
        turnId ?? state.activeAssistantTurnId ?? state.activeUserTurnId;
      const currentText =
        turnById(state.turns, assistantTurnId)?.assistantTranscript ?? "";
      const nextText = currentText + text;
      return {
        ...state,
        status: "speaking",
        activeAssistantTurnId: assistantTurnId,
        assistantTranscript: nextText,
        turns: updateTurn(state.turns, assistantTurnId, {
          assistantTranscript: nextText,
        }),
      };
    }
    case "assistant_transcript_done": {
      const assistantTurnId =
        turnId ?? state.activeAssistantTurnId ?? state.activeUserTurnId;
      const currentText =
        turnById(state.turns, assistantTurnId)?.assistantTranscript ??
        state.assistantTranscript;
      const nextText = text || currentText;
      return {
        ...state,
        status: "speaking",
        activeAssistantTurnId: assistantTurnId,
        assistantTranscript: nextText,
        turns: updateTurn(state.turns, assistantTurnId, {
          assistantTranscript: nextText,
        }),
      };
    }
    case "audio": {
      const assistantTurnId =
        turnId ?? state.activeAssistantTurnId ?? state.activeUserTurnId;
      return {
        ...state,
        status: "speaking",
        activeAssistantTurnId: assistantTurnId,
        turns: updateTurn(state.turns, assistantTurnId, {}),
        firstAudioLatencyMs:
          state.firstAudioLatencyMs ??
          (state.userTurnStartedAt == null
            ? null
            : Math.max(0, Math.round(action.now - state.userTurnStartedAt))),
      };
    }
    case "tool_call_update": {
      const toolTurnId =
        turnId ?? state.activeAssistantTurnId ?? state.activeUserTurnId;
      const existingTurn = turnById(state.turns, toolTurnId);
      const callId = String(event.call_id || "");
      const nextCall: RealtimeVoiceToolCall = {
        id: String(event.id || callId),
        callId,
        toolId: String(event.tool_id || "") || null,
        toolName: String(event.tool_name || "未命名工具"),
        arguments:
          event.arguments &&
          typeof event.arguments === "object" &&
          !Array.isArray(event.arguments)
            ? (event.arguments as Record<string, unknown>)
            : {},
        status: String(
          event.status || "running",
        ) as RealtimeVoiceToolCall["status"],
        success: typeof event.success === "boolean" ? event.success : null,
        result: event.result ?? null,
        errorCode: String(event.error_code || ""),
        errorMessage: String(event.error_message || ""),
        durationMs: Number(event.duration_ms || 0),
      };
      const calls = [
        ...(existingTurn?.toolCalls ?? []).filter(
          (call) => call.callId !== callId,
        ),
        nextCall,
      ];
      return {
        ...state,
        status: nextCall.status === "running" ? "thinking" : state.status,
        turns: updateTurn(state.turns, toolTurnId, { toolCalls: calls }),
      };
    }
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
        ...state,
        status: state.status === "error" ? "error" : "ended",
        activeUserTurnId: null,
        activeAssistantTurnId: null,
        startedAt: null,
        userTurnStartedAt: null,
      };
    default:
      return state;
  }
}
