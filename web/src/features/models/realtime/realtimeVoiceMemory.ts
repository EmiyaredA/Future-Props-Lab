import {
  initialRealtimeVoiceState,
  realtimeVoiceReducer,
  type RealtimeVoiceAction,
  type RealtimeVoiceState,
} from "@features/models/realtime/realtimeVoiceState";
import {
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
} from "@platform/voice/pcm";

export type RealtimeVoiceAudioSide = "user" | "assistant";

type RetainedAudioTrack = {
  chunks: string[];
  bytes: number;
  truncated: boolean;
};

type RetainedTurnAudio = Record<RealtimeVoiceAudioSide, RetainedAudioTrack>;

const MAX_RETAINED_AUDIO_BYTES = 64 * 1024 * 1024;

let retainedAudioBytes = 0;
let retainedAudio = new Map<string, RetainedTurnAudio>();

function freshInitialState(): RealtimeVoiceState {
  return { ...initialRealtimeVoiceState, turns: [] };
}

let retainedState = freshInitialState();

function emptyTrack(): RetainedAudioTrack {
  return { chunks: [], bytes: 0, truncated: false };
}

function clearRetainedAudio() {
  retainedAudioBytes = 0;
  retainedAudio = new Map();
}

export function pcm16Base64ByteLength(input: string) {
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((input.length * 3) / 4) - padding);
}

export function appendRetainedTurnAudio(
  turnId: string,
  side: RealtimeVoiceAudioSide,
  chunk: string,
) {
  if (!turnId || !chunk) return;
  const current = retainedAudio.get(turnId) ?? {
    user: emptyTrack(),
    assistant: emptyTrack(),
  };
  retainedAudio.set(turnId, current);
  const bytes = pcm16Base64ByteLength(chunk);
  if (retainedAudioBytes + bytes > MAX_RETAINED_AUDIO_BYTES) {
    current[side].truncated = true;
    return;
  }
  current[side].chunks.push(chunk);
  current[side].bytes += bytes;
  retainedAudioBytes += bytes;
}

export function getRetainedTurnAudioInfo(turnId: string) {
  const current = retainedAudio.get(turnId);
  const duration = (bytes: number, sampleRate: number) =>
    Math.round((bytes / 2 / sampleRate) * 1_000);
  return {
    hasUserAudio: Boolean(current?.user.chunks.length),
    hasAssistantAudio: Boolean(current?.assistant.chunks.length),
    userDurationMs: duration(current?.user.bytes ?? 0, VOICE_INPUT_SAMPLE_RATE),
    assistantDurationMs: duration(
      current?.assistant.bytes ?? 0,
      VOICE_OUTPUT_SAMPLE_RATE,
    ),
    userTruncated: current?.user.truncated ?? false,
    assistantTruncated: current?.assistant.truncated ?? false,
  };
}

export function getRetainedTurnAudio(
  turnId: string,
  side: RealtimeVoiceAudioSide,
) {
  return [...(retainedAudio.get(turnId)?.[side].chunks ?? [])];
}

export function getRetainedRealtimeVoiceState() {
  return retainedState;
}

export function retainedRealtimeVoiceReducer(
  state: RealtimeVoiceState,
  action: RealtimeVoiceAction,
) {
  if (action.type === "prepare" || action.type === "reset") {
    clearRetainedAudio();
  }
  retainedState = realtimeVoiceReducer(state, action);
  return retainedState;
}

export function retainEndedRealtimeVoiceState(state: RealtimeVoiceState) {
  retainedState = {
    ...state,
    status:
      state.status === "error"
        ? "error"
        : state.status === "idle"
          ? "idle"
          : "ended",
    activeUserTurnId: null,
    activeAssistantTurnId: null,
    startedAt: null,
    userTurnStartedAt: null,
  };
}

export function clearRetainedRealtimeVoiceState() {
  retainedState = freshInitialState();
  clearRetainedAudio();
}
