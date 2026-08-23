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
  createVoiceVad,
  type VoiceVad,
  type VoiceVadSettings,
} from "@platform/voice/vad";
import { VadEndpointCommitter } from "@platform/voice/vadEndpoint";
import {
  initialRealtimeVoiceState,
  realtimeVoiceReducer,
} from "@features/models/realtime/realtimeVoiceState";

export type RealtimeVoiceStartOptions = {
  modelId: string;
  voice: string;
  instructions: string;
  greeting: string;
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
    realtimeVoiceReducer,
    initialRealtimeVoiceState,
  );
  const [micMuted, setMicMutedState] = useState(false);
  const [speakerMuted, setSpeakerMutedState] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<MicCapture | null>(null);
  const vadRef = useRef<VoiceVad | null>(null);
  const playerRef = useRef<RealtimePcmPlayer | null>(null);
  const detectorRef = useRef<EchoAwareBargeInDetector | null>(null);
  const endpointRef = useRef<VadEndpointCommitter | null>(null);
  const endingRef = useRef(false);

  const send = useCallback((payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(payload));
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
      await release();
      endingRef.current = false;
      dispatch({ type: "prepare" });
      try {
        const context = await createVoiceAudioContext();
        contextRef.current = context;
        const capture = await startMicCapture(
          context,
          (data) => send({ type: "audio", data }),
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
            onSpeechEnd: () => endpoint.speechEnded(),
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
              client_vad: {
                positive_speech_threshold:
                  options.vad.positiveSpeechThreshold,
                negative_speech_threshold:
                  options.vad.negativeSpeechThreshold,
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
            if (turnId) endpoint.userSpeechStarted(turnId);
          } else if (
            event.type === "assistant_transcript_delta" ||
            event.type === "assistant_transcript_done" ||
            event.type === "audio"
          ) {
            detector.setPlaybackTurn(turnId);
          }
          if (event.type === "audio" && typeof event.data === "string") {
            player.enqueueBase64(event.data);
          }
          if (event.type === "interrupt") {
            player.clear();
            detector.setPlaybackTurn(null);
          }
          if (event.type === "turn_done") {
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
    [micMuted, release, send, speakerMuted],
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
    const close = () => void stop();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      void release();
    };
  }, [release, stop]);

  return {
    state,
    micMuted,
    speakerMuted,
    start,
    stop,
    setMicMuted,
    setSpeakerMuted,
  };
}
