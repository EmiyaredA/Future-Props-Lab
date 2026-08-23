import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  RealtimePcmPlayer,
  createVoiceAudioContext,
  startMicCapture,
  type MicCapture,
  type MicrophoneProcessingSettings,
  type PlaybackBufferSettings,
} from "@platform/voice/audioRuntime";
import { EchoAwareBargeInDetector } from "@platform/voice/echoBargeIn";
import {
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_OUTPUT_SAMPLE_RATE,
} from "@platform/voice/pcm";
import {
  createVoiceVad,
  type VoiceVad,
  type VoiceVadSettings,
} from "@platform/voice/vad";
import { VadEndpointCommitter } from "@platform/voice/vadEndpoint";
import {
  appendRetainedTurnAudio,
  clearRetainedRealtimeVoiceState,
  getRetainedRealtimeVoiceState,
  getRetainedTurnAudio,
  getRetainedTurnAudioInfo,
  pcm16Base64ByteLength,
  type RealtimeVoiceAudioSide,
  retainedRealtimeVoiceReducer,
  retainEndedRealtimeVoiceState,
} from "@features/models/realtime/realtimeVoiceMemory";

export type RealtimeVoiceStartOptions = {
  modelId: string;
  voice: string;
  instructions: string;
  greeting: string;
  toolIds: string[];
  vad: VoiceVadSettings;
  microphone: MicrophoneProcessingSettings;
  playback: PlaybackBufferSettings;
  interruptionEnabled: boolean;
};

function realtimeSocketUrl() {
  const base = String(import.meta.env.VITE_API_BASE || window.location.origin);
  const url = new URL("/v1/model-test/realtime", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function permissionMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "麦克风权限被拒绝，请在浏览器地址栏中允许后重试。";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "没有找到可用麦克风，请连接设备后重试。";
  }
  return error instanceof Error ? error.message : "麦克风初始化失败，请重试。";
}

export function useRealtimeVoiceCall() {
  const [state, dispatch] = useReducer(
    retainedRealtimeVoiceReducer,
    getRetainedRealtimeVoiceState(),
  );
  const [micMuted, setMicMutedState] = useState(false);
  const [speakerMuted, setSpeakerMutedState] = useState(false);
  const [replayingAudio, setReplayingAudio] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const vadRef = useRef<VoiceVad | null>(null);
  const playerRef = useRef<RealtimePcmPlayer | null>(null);
  const detectorRef = useRef<EchoAwareBargeInDetector | null>(null);
  const endpointRef = useRef<VadEndpointCommitter | null>(null);
  const endingRef = useRef(false);
  const pageHiddenRef = useRef(false);
  const inputTurnRef = useRef<string | null>(null);
  const micPreRollRef = useRef<Array<{ chunk: string; bytes: number }>>([]);
  const micPreRollBytesRef = useRef(0);
  const replayContextRef = useRef<AudioContext | null>(null);
  const replayPlayerRef = useRef<RealtimePcmPlayer | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const replayingAudioRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(payload));
  }, []);

  const releaseReplay = useCallback(async (updateState = true) => {
    if (replayTimerRef.current != null) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    const player = replayPlayerRef.current;
    replayPlayerRef.current = null;
    const context = replayContextRef.current;
    replayContextRef.current = null;
    replayingAudioRef.current = null;
    player?.destroy();
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
    if (updateState) setReplayingAudio(null);
  }, []);

  const release = useCallback(async (closeSocket = true) => {
    const socket = socketRef.current;
    socketRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    const vad = vadRef.current;
    vadRef.current = null;
    const player = playerRef.current;
    playerRef.current = null;
    const detector = detectorRef.current;
    detectorRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    const endpoint = endpointRef.current;
    endpointRef.current = null;
    inputTurnRef.current = null;
    micPreRollRef.current = [];
    micPreRollBytesRef.current = 0;
    if (closeSocket && socket && socket.readyState < WebSocket.CLOSING)
      socket.close(1000);
    capture?.stop();
    player?.destroy();
    detector?.reset();
    endpoint?.reset();
    if (vad) await vad.destroy().catch(() => undefined);
    if (context && context.state !== "closed")
      await context.close().catch(() => undefined);
  }, []);

  const stop = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    send({ type: "stop" });
    await release();
    dispatch({
      type: "server",
      event: { type: "call_ended" },
      now: performance.now(),
    });
    endingRef.current = false;
  }, [release, send]);

  const start = useCallback(
    async (options: RealtimeVoiceStartOptions) => {
      await releaseReplay();
      await release();
      endingRef.current = false;
      dispatch({ type: "prepare", toolIds: options.toolIds });
      try {
        const context = await createVoiceAudioContext();
        contextRef.current = context;
        const capture = await startMicCapture(
          context,
          (data) => {
            send({ type: "audio", data });
            const inputTurnId = inputTurnRef.current;
            if (inputTurnId) {
              appendRetainedTurnAudio(inputTurnId, "user", data);
              return;
            }
            const bytes = pcm16Base64ByteLength(data);
            micPreRollRef.current.push({ chunk: data, bytes });
            micPreRollBytesRef.current += bytes;
            const maxPreRollBytes =
              Math.max(1_000, options.vad.preSpeechPadMs + 400) *
              ((VOICE_INPUT_SAMPLE_RATE * 2) / 1_000);
            while (micPreRollBytesRef.current > maxPreRollBytes) {
              const removed = micPreRollRef.current.shift();
              if (!removed) break;
              micPreRollBytesRef.current -= removed.bytes;
            }
          },
          options.microphone,
        );
        captureRef.current = capture;
        capture.setMuted(micMuted);

        const detector = new EchoAwareBargeInDetector((turnId) => {
          if (!options.interruptionEnabled) return;
          playerRef.current?.clear();
          send({ type: "interrupt", turn_id: turnId });
        });
        detectorRef.current = detector;
        const endpoint = new VadEndpointCommitter((turnId) =>
          send({ type: "commit_input", turn_id: turnId }),
        );
        endpointRef.current = endpoint;
        const player = new RealtimePcmPlayer(
          context,
          (reference) => detector.addReference(reference),
          options.playback,
        );
        player.setMuted(speakerMuted);
        playerRef.current = player;

        try {
          vadRef.current = await createVoiceVad({
            context,
            stream: capture.stream,
            settings: options.vad,
            onFrame: (frame) => {
              if (options.interruptionEnabled)
                detector.process(frame, player.hasActivePlayback());
            },
            onSpeechStart: () => undefined,
            onSpeechEnd: () => {
              endpoint.speechEnded();
              inputTurnRef.current = null;
            },
          });
        } catch (error) {
          throw new Error(
            `VAD 初始化失败，免按键通话未启动。${error instanceof Error ? ` ${error.message}` : ""}`,
          );
        }

        dispatch({ type: "connecting" });
        const socket = new WebSocket(realtimeSocketUrl());
        socketRef.current = socket;
        socket.addEventListener("open", () => {
          socket.send(
            JSON.stringify({
              type: "start",
              model_id: options.modelId,
              voice: options.voice,
              instructions: options.instructions,
              greeting: options.greeting,
              tool_ids: options.toolIds,
              client_vad: {
                positive_speech_threshold: options.vad.positiveSpeechThreshold,
                negative_speech_threshold: options.vad.negativeSpeechThreshold,
                min_speech_ms: options.vad.minSpeechMs,
                pre_speech_pad_ms: options.vad.preSpeechPadMs,
                commit_silence_ms: options.vad.commitSilenceMs,
              },
              microphone: {
                echo_cancellation: options.microphone.echoCancellation,
                noise_suppression: options.microphone.noiseSuppression,
                auto_gain_control: options.microphone.autoGainControl,
              },
              playback: {
                start_buffer_ms: options.playback.startBufferMs,
                recovery_buffer_ms: options.playback.recoveryBufferMs,
              },
              interruption_enabled: options.interruptionEnabled,
            }),
          );
        });
        socket.addEventListener("message", (message) => {
          let event: Record<string, unknown> & { type: string };
          try {
            event = JSON.parse(String(message.data)) as typeof event;
          } catch {
            return;
          }
          const turnId = String(event.turn_id || "") || null;
          if (event.type === "user_speech_started") {
            if (turnId) {
              inputTurnRef.current = turnId;
              for (const { chunk } of micPreRollRef.current) {
                appendRetainedTurnAudio(turnId, "user", chunk);
              }
              micPreRollRef.current = [];
              micPreRollBytesRef.current = 0;
              endpoint.userSpeechStarted(turnId);
            }
          } else if (event.type === "user_speech_stopped") {
            inputTurnRef.current = null;
          } else if (
            event.type === "assistant_transcript_delta" ||
            event.type === "assistant_transcript_done" ||
            event.type === "audio"
          ) {
            detector.setPlaybackTurn(turnId);
          }
          if (event.type === "audio" && typeof event.data === "string") {
            if (turnId) {
              appendRetainedTurnAudio(turnId, "assistant", event.data);
            }
            player.enqueueBase64(event.data);
          }
          if (event.type === "interrupt") {
            player.clear();
            detector.setPlaybackTurn(null);
          }
          if (event.type === "turn_done") {
            inputTurnRef.current = null;
            player.drain();
            endpoint.finishTurn();
          }
          dispatch({ type: "server", event, now: performance.now() });
        });
        socket.addEventListener("error", () => {
          dispatch({
            type: "local_error",
            message: "实时语音连接失败，请检查网络后重试。",
            retryable: true,
          });
        });
        socket.addEventListener("close", (event) => {
          if (!endingRef.current && event.code !== 1000) {
            const message =
              event.code === 4401
                ? "登录状态已失效，请重新登录。"
                : event.code === 4403
                  ? "当前页面来源不允许建立实时语音连接。"
                  : "实时语音连接已断开，请重新通话。";
            dispatch({
              type: "local_error",
              message,
              retryable: event.code !== 4403,
            });
          }
          void release(false);
        });
      } catch (error) {
        await release();
        dispatch({
          type: "local_error",
          message: permissionMessage(error),
          retryable: true,
        });
      }
    },
    [micMuted, release, releaseReplay, send, speakerMuted],
  );

  const replayTurnAudio = useCallback(
    async (turnId: string, side: RealtimeVoiceAudioSide) => {
      const key = `${turnId}:${side}`;
      if (replayingAudioRef.current === key) {
        await releaseReplay();
        return;
      }
      await releaseReplay(false);
      const chunks = getRetainedTurnAudio(turnId, side);
      if (!chunks.length) return;
      const info = getRetainedTurnAudioInfo(turnId);
      const durationMs =
        side === "user" ? info.userDurationMs : info.assistantDurationMs;
      const context = await createVoiceAudioContext();
      const player = new RealtimePcmPlayer(
        context,
        undefined,
        { startBufferMs: 0, recoveryBufferMs: 0 },
        side === "user" ? VOICE_INPUT_SAMPLE_RATE : VOICE_OUTPUT_SAMPLE_RATE,
      );
      replayContextRef.current = context;
      replayPlayerRef.current = player;
      replayingAudioRef.current = key;
      setReplayingAudio(key);
      for (const chunk of chunks) player.enqueueBase64(chunk);
      player.drain();
      replayTimerRef.current = window.setTimeout(
        () => void releaseReplay(),
        Math.max(250, durationMs + 200),
      );
    },
    [releaseReplay],
  );

  const setMicMuted = useCallback(
    (muted: boolean) => {
      setMicMutedState(muted);
      captureRef.current?.setMuted(muted);
      send({ type: "mute", microphone: muted });
    },
    [send],
  );
  const setSpeakerMuted = useCallback((muted: boolean) => {
    setSpeakerMutedState(muted);
    playerRef.current?.setMuted(muted);
  }, []);

  useEffect(() => {
    const close = () => {
      pageHiddenRef.current = true;
      send({ type: "stop" });
      clearRetainedRealtimeVoiceState();
      void release();
      void releaseReplay(false);
    };
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      if (pageHiddenRef.current) clearRetainedRealtimeVoiceState();
      else retainEndedRealtimeVoiceState(stateRef.current);
      void release();
      void releaseReplay(false);
    };
  }, [release, releaseReplay, send]);

  return {
    state,
    replayingAudio,
    micMuted,
    speakerMuted,
    start,
    stop,
    replayTurnAudio,
    getTurnAudioInfo: getRetainedTurnAudioInfo,
    setMicMuted,
    setSpeakerMuted,
  };
}
