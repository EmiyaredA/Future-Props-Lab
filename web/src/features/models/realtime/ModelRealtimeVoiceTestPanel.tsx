import { useModelCompactPanels } from "@features/models/workspace/useModelCompactPanels";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Waves } from "lucide-react";
import {
  getRealtimeVoiceOptions,
  type RealtimeVoiceModel,
} from "@features/models/api";
import { RealtimeVoiceConversation } from "@features/models/realtime/RealtimeVoiceConversation";
import { useRealtimeVoiceCall } from "@features/models/realtime/useRealtimeVoiceCall";
import {
  ModelTestWorkspaceHeader,
  type ModelTestMode,
} from "@features/models/workspace/ModelTestWorkspaceHeader";
import { CustomSelect, type SelectOption } from "@shared/ui/CustomSelect";
import "@features/models/styles/realtime-voice.css";
import { modelQueryKeys } from "@features/models/queryKeys";

type TestModel = {
  value: string;
  label: string;
  description: string;
  capabilities: string[];
  providerKind: string;
};

type NumberParameter = {
  default: number;
  minimum: number;
  maximum: number;
  step: number;
};

type CallParameters = {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechMs: number;
  preSpeechPadMs: number;
  commitSilenceMs: number;
  startBufferMs: number;
  recoveryBufferMs: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  interruptionEnabled: boolean;
};

const DEFAULT_PARAMETERS: CallParameters = {
  positiveSpeechThreshold: 0.55,
  negativeSpeechThreshold: 0.38,
  minSpeechMs: 320,
  preSpeechPadMs: 160,
  commitSilenceMs: 400,
  startBufferMs: 400,
  recoveryBufferMs: 800,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  interruptionEnabled: true,
};

function NumberField({
  label,
  unit,
  parameter,
  value,
  disabled,
  onChange,
}: {
  label: string;
  unit?: string;
  parameter: NumberParameter;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="realtime-number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          min={parameter.minimum}
          max={parameter.maximum}
          step={parameter.step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit ? <small>{unit}</small> : null}
      </div>
    </label>
  );
}

function ToggleSetting({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="realtime-toggle-setting">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </div>
  );
}

export function ModelRealtimeVoiceTestPanel({
  models,
  modelId,
  onSelectMode,
  onSelectModel,
}: {
  models: TestModel[];
  modelId: string;
  onSelectMode: (mode: ModelTestMode) => void;
  onSelectModel: (modelId: string) => void;
}) {
  const compact = useModelCompactPanels("realtime");
  const optionsQuery = useQuery({
    queryKey: modelQueryKeys.realtimeOptions,
    queryFn: getRealtimeVoiceOptions,
  });
  const realtimeModels = optionsQuery.data?.models ?? [];
  const selectedModel = realtimeModels.find((model) => model.id === modelId);
  const [voice, setVoice] = useState("");
  const [greeting, setGreeting] = useState("");
  const [instructions, setInstructions] = useState(
    "你是一位简洁、自然、耐心的中文语音助手。请使用适合口语交流的短句回答。",
  );
  const [parameters, setParameters] =
    useState<CallParameters>(DEFAULT_PARAMETERS);
  const [elapsed, setElapsed] = useState(0);
  const call = useRealtimeVoiceCall();
  const active = !["idle", "ended", "error"].includes(call.state.status);

  useEffect(() => {
    if (!selectedModel) return;
    setVoice(selectedModel.default_voice);
    setParameters({
      positiveSpeechThreshold:
        selectedModel.client_vad.positive_speech_threshold.default,
      negativeSpeechThreshold:
        selectedModel.client_vad.negative_speech_threshold.default,
      minSpeechMs: selectedModel.client_vad.min_speech_ms.default,
      preSpeechPadMs: selectedModel.client_vad.pre_speech_pad_ms.default,
      commitSilenceMs: selectedModel.client_vad.commit_silence_ms.default,
      startBufferMs: selectedModel.playback.start_buffer_ms.default,
      recoveryBufferMs: selectedModel.playback.recovery_buffer_ms.default,
      echoCancellation: selectedModel.microphone.echo_cancellation,
      noiseSuppression: selectedModel.microphone.noise_suppression,
      autoGainControl: selectedModel.microphone.auto_gain_control,
      interruptionEnabled: selectedModel.supports_interruption,
    });
  }, [selectedModel]);

  useEffect(() => {
    if (!active || call.state.startedAt == null) {
      if (!active) setElapsed(0);
      return;
    }
    const update = () =>
      setElapsed(
        Math.max(0, (performance.now() - call.state.startedAt!) / 1_000),
      );
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [active, call.state.startedAt]);

  const modelOptions: SelectOption[] = realtimeModels.length
    ? realtimeModels.map((model) => ({
        value: model.id,
        label: model.label,
        description: `${model.provider_name} · ${model.slug}`,
      }))
    : [{ value: "", label: "暂无已启用的实时语音模型", disabled: true }];
  const voiceOptions: SelectOption[] =
    selectedModel?.voices.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.value,
    })) ?? [];
  const availableModes = useMemo<Record<ModelTestMode, boolean>>(
    () => ({
      chat: models.some((model) => model.capabilities.includes("chat")),
      image: models.some((model) =>
        model.capabilities.includes("image_generation"),
      ),
      video: models.some((model) =>
        model.capabilities.includes("video_generation"),
      ),
      synthesis: models.some((model) =>
        model.capabilities.includes("speech_synthesis"),
      ),
      speech: models.some((model) =>
        model.capabilities.includes("speech_recognition"),
      ),
      enhancement: models.some((model) =>
        model.capabilities.includes("video_enhancement"),
      ),
      realtime_voice: Boolean(realtimeModels.length),
    }),
    [models, realtimeModels.length],
  );
  const parameterError = useMemo(() => {
    if (!selectedModel) return "";
    const checks: Array<[number, NumberParameter]> = [
      [
        parameters.positiveSpeechThreshold,
        selectedModel.client_vad.positive_speech_threshold,
      ],
      [
        parameters.negativeSpeechThreshold,
        selectedModel.client_vad.negative_speech_threshold,
      ],
      [parameters.minSpeechMs, selectedModel.client_vad.min_speech_ms],
      [parameters.preSpeechPadMs, selectedModel.client_vad.pre_speech_pad_ms],
      [parameters.commitSilenceMs, selectedModel.client_vad.commit_silence_ms],
      [parameters.startBufferMs, selectedModel.playback.start_buffer_ms],
      [parameters.recoveryBufferMs, selectedModel.playback.recovery_buffer_ms],
    ];
    if (
      checks.some(
        ([value, constraint]) =>
          !Number.isFinite(value) ||
          value < constraint.minimum ||
          value > constraint.maximum,
      )
    )
      return "参数超出允许范围，请检查后重试。";
    if (
      parameters.negativeSpeechThreshold >= parameters.positiveSpeechThreshold
    )
      return "停口阈值必须小于开口阈值。";
    if (parameters.recoveryBufferMs < parameters.startBufferMs)
      return "欠载恢复缓冲不能小于起播缓冲。";
    return "";
  }, [parameters, selectedModel]);
  const canStart =
    Boolean(selectedModel && voice) &&
    !optionsQuery.isLoading &&
    !parameterError;
  const start = () => {
    if (!selectedModel || !voice) return;
    void call.start({
      modelId: selectedModel.id,
      voice,
      instructions,
      greeting,
      vad: {
        positiveSpeechThreshold: parameters.positiveSpeechThreshold,
        negativeSpeechThreshold: parameters.negativeSpeechThreshold,
        minSpeechMs: parameters.minSpeechMs,
        preSpeechPadMs: parameters.preSpeechPadMs,
        commitSilenceMs: parameters.commitSilenceMs,
      },
      microphone: {
        echoCancellation: parameters.echoCancellation,
        noiseSuppression: parameters.noiseSuppression,
        autoGainControl: parameters.autoGainControl,
      },
      playback: {
        startBufferMs: parameters.startBufferMs,
        recoveryBufferMs: parameters.recoveryBufferMs,
      },
      interruptionEnabled: parameters.interruptionEnabled,
    });
  };

  const updateParameter = <Key extends keyof CallParameters>(
    key: Key,
    value: CallParameters[Key],
  ) => setParameters((current) => ({ ...current, [key]: value }));

  return (
    <section
      data-compact-panel={compact.panel}
      className="model-test-page realtime-voice-page"
    >
      <ModelTestWorkspaceHeader
        activeMode="realtime_voice"
        availableModes={availableModes}
        onSelectMode={onSelectMode}
        modelId={selectedModel?.id ?? modelId}
        modelOptions={modelOptions}
        onSelectModel={(next) => {
          setVoice("");
          onSelectModel(next);
        }}
        modelDisabled={active}
      />

      {compact.tabs}
      <div className="realtime-voice-layout">
        <aside className="realtime-voice-settings">
          <div className="realtime-panel-heading">
            <span className="realtime-panel-icon">
              <Waves aria-hidden />
            </span>
            <div>
              <strong>通话设置</strong>
              <small>连接后锁定配置</small>
            </div>
          </div>
          <label>
            <span>音色</span>
            <CustomSelect
              ariaLabel="实时语音音色"
              value={voice}
              options={voiceOptions}
              onChange={setVoice}
              disabled={active || !selectedModel}
            />
          </label>
          <label>
            <span>
              开场白 <em className="optional-badge">可选</em>
            </span>
            <textarea
              rows={3}
              maxLength={selectedModel?.greeting_max_chars ?? 2_000}
              value={greeting}
              placeholder="连接成功后由助手主动说出的第一句话"
              disabled={active}
              onChange={(event) => setGreeting(event.target.value)}
            />
            <small>
              {greeting.length} / {selectedModel?.greeting_max_chars ?? 2_000}
            </small>
          </label>
          <label>
            <span>系统提示词</span>
            <textarea
              rows={7}
              maxLength={selectedModel?.instructions_max_chars ?? 20_000}
              value={instructions}
              disabled={active}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <small>
              {instructions.length} /{" "}
              {selectedModel?.instructions_max_chars ?? 20_000}
            </small>
          </label>
          {selectedModel ? (
            <>
              <section className="realtime-parameter-section">
                <header>
                  <strong>端点检测</strong>
                  <small>浏览器本地 VAD 与自动提交</small>
                </header>
                <div className="realtime-parameter-grid">
                  <NumberField
                    label="开口阈值"
                    parameter={
                      selectedModel.client_vad.positive_speech_threshold
                    }
                    value={parameters.positiveSpeechThreshold}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("positiveSpeechThreshold", value)
                    }
                  />
                  <NumberField
                    label="停口阈值"
                    parameter={
                      selectedModel.client_vad.negative_speech_threshold
                    }
                    value={parameters.negativeSpeechThreshold}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("negativeSpeechThreshold", value)
                    }
                  />
                  <NumberField
                    label="最短语音"
                    unit="ms"
                    parameter={selectedModel.client_vad.min_speech_ms}
                    value={parameters.minSpeechMs}
                    disabled={active}
                    onChange={(value) => updateParameter("minSpeechMs", value)}
                  />
                  <NumberField
                    label="前置保留"
                    unit="ms"
                    parameter={selectedModel.client_vad.pre_speech_pad_ms}
                    value={parameters.preSpeechPadMs}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("preSpeechPadMs", value)
                    }
                  />
                  <NumberField
                    label="静音断句"
                    unit="ms"
                    parameter={selectedModel.client_vad.commit_silence_ms}
                    value={parameters.commitSilenceMs}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("commitSilenceMs", value)
                    }
                  />
                </div>
              </section>

              <section className="realtime-parameter-section">
                <header>
                  <strong>音频体验</strong>
                  <small>采集、播放缓冲与插话</small>
                </header>
                <div className="realtime-parameter-grid">
                  <NumberField
                    label="起播缓冲"
                    unit="ms"
                    parameter={selectedModel.playback.start_buffer_ms}
                    value={parameters.startBufferMs}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("startBufferMs", value)
                    }
                  />
                  <NumberField
                    label="欠载恢复"
                    unit="ms"
                    parameter={selectedModel.playback.recovery_buffer_ms}
                    value={parameters.recoveryBufferMs}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("recoveryBufferMs", value)
                    }
                  />
                </div>
                <div className="realtime-toggle-list">
                  <ToggleSetting
                    label="说话打断"
                    description="检测到近端人声时停止当前回复"
                    checked={parameters.interruptionEnabled}
                    disabled={active || !selectedModel.supports_interruption}
                    onChange={(value) =>
                      updateParameter("interruptionEnabled", value)
                    }
                  />
                  <ToggleSetting
                    label="回声消除"
                    description="请求浏览器抑制扬声器回声"
                    checked={parameters.echoCancellation}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("echoCancellation", value)
                    }
                  />
                  <ToggleSetting
                    label="环境降噪"
                    description="减少持续背景噪声"
                    checked={parameters.noiseSuppression}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("noiseSuppression", value)
                    }
                  />
                  <ToggleSetting
                    label="自动增益"
                    description="自动平衡麦克风输入响度"
                    checked={parameters.autoGainControl}
                    disabled={active}
                    onChange={(value) =>
                      updateParameter("autoGainControl", value)
                    }
                  />
                </div>
              </section>
              {parameterError ? (
                <p className="realtime-parameter-error" role="alert">
                  {parameterError}
                </p>
              ) : null}
            </>
          ) : null}
          {selectedModel ? (
            <div className="realtime-specs" aria-label="音频参数">
              <span>
                输入 {selectedModel.input_sample_rate / 1_000} kHz{" "}
                {selectedModel.input_format}
              </span>
              <span>
                输出 {selectedModel.output_sample_rate / 1_000} kHz{" "}
                {selectedModel.output_format}
              </span>
              <span>{selectedModel.channels} 声道</span>
              <span>40 ms PCM 上行帧</span>
            </div>
          ) : null}
        </aside>

        <RealtimeVoiceConversation
          call={call}
          elapsed={elapsed}
          canStart={canStart}
          modelLabel={selectedModel?.label ?? "未选择实时语音模型"}
          loading={optionsQuery.isLoading}
          onStart={start}
        />
      </div>
    </section>
  );
}

export type { RealtimeVoiceModel };
