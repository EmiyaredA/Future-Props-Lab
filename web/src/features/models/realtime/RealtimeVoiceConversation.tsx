import { useEffect, useRef } from "react";
import {
  Bot,
  CircleAlert,
  Clock3,
  Copy,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Play,
  RefreshCw,
  Square,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ModelTestToolCallList } from "@features/models/conversation/ModelTestToolControls";
import { useRealtimeVoiceCall } from "@features/models/realtime/useRealtimeVoiceCall";
import "@features/models/styles/realtime-voice-chat.css";

type RealtimeCall = ReturnType<typeof useRealtimeVoiceCall>;

const statusLabels = {
  idle: "等待开始",
  preparing: "正在初始化麦克风与 VAD",
  connecting: "正在连接实时模型",
  connected: "已连接，直接说话即可",
  listening: "正在聆听…",
  thinking: "模型正在思考",
  speaking: "模型正在回答",
  ended: "通话已结束",
  error: "通话异常",
} as const;

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function TurnAudioButton({
  label,
  durationMs,
  playing,
  disabled,
  onClick,
}: {
  label: string;
  durationMs: number;
  playing: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const duration = Math.max(0.1, durationMs / 1_000).toFixed(1);
  return (
    <button
      type="button"
      className="realtime-turn-audio"
      aria-label={`${playing ? "停止" : "播放"}${label}`}
      title={`${playing ? "停止播放" : "播放"}${label}（${duration} 秒）`}
      disabled={disabled}
      onClick={onClick}
    >
      {playing ? <Square aria-hidden /> : <Play aria-hidden />}
      <span>{duration}s</span>
    </button>
  );
}

function LiveWaveform() {
  return (
    <span className="realtime-live-waveform" aria-hidden>
      {Array.from({ length: 14 }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function CallMessageList({
  call,
  active,
  modelLabel,
}: {
  call: RealtimeCall;
  active: boolean;
  modelLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, [call.state.turns]);

  if (!call.state.turns.length) {
    return (
      <div className="chat-scroll realtime-chat-scroll" ref={scrollRef}>
        <div className="realtime-chat-empty">
          <Mic aria-hidden />
          <strong>{statusLabels[call.state.status]}</strong>
          <span>开始通话后，双方的实时转写会按文本对话的形式显示。</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat-scroll realtime-chat-scroll"
      aria-label="当前通话对话历史"
      aria-live="polite"
      ref={scrollRef}
    >
      {call.state.turns.map((turn, index) => {
        const audio = call.getTurnAudioInfo(turn.turnId);
        const userActive =
          call.state.activeUserTurnId === turn.turnId &&
          ["listening", "thinking"].includes(call.state.status);
        const assistantActive =
          call.state.activeAssistantTurnId === turn.turnId &&
          call.state.status === "speaking";
        const calls = turn.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          tool_name: toolCall.toolName,
          arguments: toolCall.arguments,
          status: toolCall.status,
          success: toolCall.success,
          result: toolCall.result,
          error_code: toolCall.errorCode,
          error_message: toolCall.errorMessage,
          duration_ms: toolCall.durationMs,
        }));
        return (
          <div className="realtime-turn" key={turn.turnId}>
            <article
              className={`chat-message user ${userActive ? "active" : ""}`}
            >
              <div className="chat-avatar">
                <UserRound aria-hidden />
              </div>
              <div className="chat-message-body">
                <div className="chat-message-meta">
                  <strong>你</strong>
                  <span>{userActive ? "实时转写" : `第 ${index + 1} 轮`}</span>
                  {audio.hasUserAudio ? (
                    <TurnAudioButton
                      label={`第 ${index + 1} 轮我的语音`}
                      durationMs={audio.userDurationMs}
                      playing={call.replayingAudio === `${turn.turnId}:user`}
                      disabled={active}
                      onClick={() =>
                        void call.replayTurnAudio(turn.turnId, "user")
                      }
                    />
                  ) : null}
                </div>
                <p className="user-copy">
                  {turn.userTranscript ||
                    (userActive ? "正在识别你的声音…" : "本轮没有识别文字。")}
                  {userActive ? <LiveWaveform /> : null}
                </p>
              </div>
            </article>

            <article
              className={`chat-message assistant ${assistantActive ? "active" : ""}`}
            >
              <div className="chat-avatar">
                <Bot aria-hidden />
              </div>
              <div className="chat-message-body">
                <div className="chat-message-meta">
                  <strong>模型回复</strong>
                  <span>{modelLabel}</span>
                  {assistantActive ? <em>实时转写</em> : null}
                  {audio.hasAssistantAudio ? (
                    <TurnAudioButton
                      label={`第 ${index + 1} 轮模型语音`}
                      durationMs={audio.assistantDurationMs}
                      playing={
                        call.replayingAudio === `${turn.turnId}:assistant`
                      }
                      disabled={active}
                      onClick={() =>
                        void call.replayTurnAudio(turn.turnId, "assistant")
                      }
                    />
                  ) : null}
                </div>
                <ModelTestToolCallList calls={calls} />
                <div className="markdown-body">
                  <p>
                    {turn.assistantTranscript ||
                      (calls.some((item) => item.status === "running")
                        ? "正在等待工具返回结果…"
                        : "正在等待模型回复…")}
                    {assistantActive ? <i className="stream-caret" /> : null}
                  </p>
                </div>
                {turn.assistantTranscript ? (
                  <div className="message-actions">
                    <button
                      type="button"
                      aria-label="复制模型回复"
                      title="复制模型回复"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          turn.assistantTranscript,
                        )
                      }
                    >
                      <Copy aria-hidden />
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}

export function RealtimeVoiceConversation({
  call,
  elapsed,
  canStart,
  modelLabel,
  loading,
  onStart,
}: {
  call: RealtimeCall;
  elapsed: number;
  canStart: boolean;
  modelLabel: string;
  loading: boolean;
  onStart: () => void;
}) {
  const active = !["idle", "ended", "error"].includes(call.state.status);
  const toolRunning = call.state.turns.some((turn) =>
    turn.toolCalls.some((toolCall) => toolCall.status === "running"),
  );
  const liveLabel = toolRunning
    ? "正在调用工具…"
    : statusLabels[call.state.status];

  return (
    <main className="realtime-voice-stage chat-panel">
      <div className="chat-titlebar realtime-chat-titlebar">
        <div className="chat-title-copy">
          <strong>实时语音会话</strong>
          <span className="chat-model-name">{modelLabel}</span>
        </div>
        <span className={`realtime-session-status ${active ? "active" : ""}`}>
          <i aria-hidden />{" "}
          {active ? `通话中 · ${formatDuration(elapsed)}` : liveLabel}
        </span>
      </div>

      {call.state.error ? (
        <div className="inline-alert danger realtime-error" role="alert">
          <CircleAlert aria-hidden />
          <span>{call.state.error}</span>
          {call.state.retryable ? (
            <button type="button" onClick={onStart} disabled={!canStart}>
              <RefreshCw aria-hidden /> 重试
            </button>
          ) : null}
        </div>
      ) : null}

      <CallMessageList call={call} active={active} modelLabel={modelLabel} />

      <div className="composer-wrap realtime-composer-wrap">
        <div className="realtime-voice-composer">
          <div
            className="realtime-input-level"
            role="status"
            aria-live="polite"
          >
            <Mic aria-hidden />
            <strong>{liveLabel}</strong>
            <LiveWaveform />
            <small>
              <Clock3 aria-hidden /> 首包延迟{" "}
              {call.state.firstAudioLatencyMs == null
                ? "—"
                : `${call.state.firstAudioLatencyMs} ms`}
            </small>
          </div>
          <button
            type="button"
            className={call.micMuted ? "muted" : ""}
            aria-label={call.micMuted ? "取消麦克风静音" : "麦克风静音"}
            disabled={!active}
            onClick={() => call.setMicMuted(!call.micMuted)}
          >
            {call.micMuted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
            <span>麦克风</span>
          </button>
          {active ? (
            <button
              type="button"
              className="hangup"
              onClick={() => void call.stop()}
            >
              <PhoneOff aria-hidden />
              <span>结束通话</span>
            </button>
          ) : (
            <button
              type="button"
              className="start-call"
              disabled={!canStart}
              onClick={onStart}
            >
              <Phone aria-hidden />
              <span>{loading ? "加载配置中" : "开始通话"}</span>
            </button>
          )}
          <button
            type="button"
            className={call.speakerMuted ? "muted" : ""}
            aria-label={call.speakerMuted ? "取消扬声器静音" : "扬声器静音"}
            disabled={!active}
            onClick={() => call.setSpeakerMuted(!call.speakerMuted)}
          >
            {call.speakerMuted ? (
              <VolumeX aria-hidden />
            ) : (
              <Volume2 aria-hidden />
            )}
            <span>扬声器</span>
          </button>
        </div>
        <p className="realtime-privacy-note">
          转写与语音仅保留在当前页面；工具调用详情会写入测试记录。
        </p>
      </div>
    </main>
  );
}
