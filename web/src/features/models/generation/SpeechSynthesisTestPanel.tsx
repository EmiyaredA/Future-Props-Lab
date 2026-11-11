import { useModelCompactPanels } from "@features/models/workspace/useModelCompactPanels";
import { TransferFeedback } from "@shared/ui/TransferFeedback";
import { LoadingState } from "@shared/ui/LoadingState";
import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileAudio2,
  FolderOpen,
  LockKeyhole,
  RefreshCw,
  Upload,
} from "lucide-react";
import { LibraryPicker } from "./ModelTranscriptionTaskViews";
import {
  useAccountId,
  useAccountPermission,
} from "@platform/auth/AccountAccess";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { formatFileSize } from "@shared/lib/fileSize";
import {
  ModelTestWorkspaceHeader,
  type ModelTestMode,
} from "@features/models/workspace/ModelTestWorkspaceHeader";
import type { CapabilityTestModel } from "@features/models/conversation/ModelTestCapabilityPanel";
import {
  getInferenceOptions,
  getInferenceTasks,
} from "@features/models/localModelApi";
import { modelQueryKeys } from "@features/models/queryKeys";
import { SpeechSynthesisResult } from "./SpeechSynthesisResult";
import {
  speechLanguageLabel,
  speechTaskStatus,
} from "./speechSynthesisPresentation";
import { useSpeechDraft, type SpeechLimits } from "./useSpeechDraft";
import "./speech-synthesis.css";

type SpeechPanelProps = {
  models: CapabilityTestModel[];
  modelId: string;
  onSelectMode: (mode: ModelTestMode) => void;
  onSelectModel: (id: string) => void;
};
export function SpeechSynthesisTestPanel(props: SpeechPanelProps) {
  const account = useAccountId();
  const workspace = useAccountId();
  return <SpeechWorkspace key={`${account}:${workspace}`} {...props} />;
}

function SpeechWorkspace({
  models,
  modelId,
  onSelectMode,
  onSelectModel,
}: SpeechPanelProps) {
  const compact = useModelCompactPanels("generation");
  const canUse = useAccountPermission("models.use");
  const canWrite = useAccountPermission("content.write");
  const fileInput = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedTask, setSelectedTask] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(5);
  const id = useId();
  const options = useQuery({
    queryKey: modelQueryKeys.inferenceOptions,
    queryFn: getInferenceOptions,
  });
  const tasks = useQuery({
    queryKey: modelQueryKeys.inferenceTasks,
    queryFn: getInferenceTasks,
    refetchInterval: 2000,
  });
  const selected = options.data?.items.find((model) => model.id === modelId);
  const limits = selected?.parameters.speech_synthesis as
    SpeechLimits | undefined;
  const draft = useSpeechDraft({
    modelId,
    limits,
    allowed: !!selected && !options.isError && canUse && canWrite,
    onCreated: (taskId) => {
      setSelectedTask(taskId);
      setAutoPlay(false);
      compact.setPanel("result");
    },
  });
  const history = (tasks.data?.items ?? []).filter(
    (task) => task.kind === "speech_synthesis" && task.model_id === modelId,
  );
  const focused =
    history.find((task) => task.id === selectedTask) ?? history[0];
  const inputDisabled =
    draft.busy || !selected || options.isError || !canUse || !canWrite;
  return (
    <section
      className="model-test-page model-speech-test"
      data-compact-panel={compact.panel}
    >
      <TransferFeedback progress={draft.transferProgress} />

      <ModelTestWorkspaceHeader
        activeMode="synthesis"
        availableModes={{
          chat:
            !draft.busy && models.some((m) => m.capabilities.includes("chat")),
          image:
            !draft.busy &&
            models.some((m) => m.capabilities.includes("image_generation")),
          video:
            !draft.busy &&
            models.some((m) => m.capabilities.includes("video_generation")),
          speech:
            !draft.busy &&
            models.some((m) => m.capabilities.includes("speech_recognition")),
          synthesis: true,
          enhancement: models.some((model) =>
            model.capabilities.includes("video_enhancement"),
          ),
          realtime_voice:
            !draft.busy && models.some((m) => m.capabilities.includes("voice")),
        }}
        onSelectMode={onSelectMode}
        modelId={modelId}
        modelDisabled={draft.busy}
        modelOptions={models
          .filter((m) => m.capabilities.includes("speech_synthesis"))
          .map((m) => ({ value: m.value, label: m.label }))}
        onSelectModel={onSelectModel}
      />
      {compact.tabs}
      <div className="speech-workbench generation-test-grid">
        <aside
          className="speech-history generation-test-history"
          aria-label="生成记录"
        >
          <header className="speech-heading">
            <div className="speech-history-title">
              <h2>生成记录</h2>
              <button
                className="speech-icon-button"
                aria-label="刷新生成记录"
                type="button"
                disabled={tasks.isFetching}
                onClick={() => void tasks.refetch()}
              >
                <RefreshCw size={16} aria-hidden />
              </button>
            </div>
            <p>{history.length} 条记录</p>
          </header>
          {tasks.isPending && (
            <LoadingState
              label="正在读取生成记录…"
              variant="region"
              className="speech-help"
            />
          )}
          {tasks.isError && (
            <p className="speech-feedback is-error" role="alert">
              生成记录读取失败：{tasks.error.message}。请刷新记录重试。
            </p>
          )}
          {!!history.length && (
            <div className="speech-history-list" aria-label="语音生成历史">
              {history.slice(0, historyLimit).map((task) => (
                <button
                  className={`speech-history-row${task.id === focused?.id ? " is-active" : ""}`}
                  aria-pressed={task.id === focused?.id}
                  type="button"
                  key={task.id}
                  aria-label={`试听生成记录：${String(task.request_payload.text ?? "未命名文稿")}`}
                  onClick={() => {
                    setSelectedTask(task.id);
                    setAutoPlay(task.result_available);
                    compact.setPanel("result");
                  }}
                >
                  <span className="speech-history-icon">
                    <AudioLines size={19} aria-hidden />
                  </span>
                  <span className="speech-history-copy">
                    <strong>
                      {String(task.request_payload.text ?? "未命名文稿")}
                    </strong>
                    <small>{speechTaskStatus(task.status)}</small>
                  </span>
                  <ChevronRight size={15} aria-hidden />
                </button>
              ))}
              {history.length > historyLimit && (
                <button
                  className="speech-text-button"
                  type="button"
                  onClick={() => setHistoryLimit((count) => count + 5)}
                >
                  显示更多记录
                </button>
              )}
            </div>
          )}
        </aside>
        <main
          className="speech-output generation-test-result"
          aria-label="语音合成结果"
        >
          <header className="speech-heading">
            <h2>合成结果</h2>
            <p>生成完成后可试听、下载或保存到文件库。</p>
          </header>
          {!tasks.isPending && !tasks.isError && !focused && (
            <div className="speech-history-empty">
              <AudioLines size={32} aria-hidden />
              <h3>等待第一段声音</h3>
              <p>填写参数面板中的文稿与参考音色，生成结果会显示在这里。</p>
            </div>
          )}
          {focused && (
            <SpeechSynthesisResult
              key={focused.id}
              task={focused}
              autoPlay={autoPlay}
            />
          )}
        </main>
        <form
          className="speech-composer generation-test-settings"
          aria-label="语音合成参数"
          onSubmit={(event) => {
            event.preventDefault();
            void draft.submit();
          }}
        >
          <header className="speech-heading">
            <h2>语音合成</h2>
            <p>使用参考录音的音色，为文字生成配音。</p>
          </header>
          {options.isPending && (
            <LoadingState
              label="正在读取模型参数…"
              variant="region"
              className="speech-help"
            />
          )}
          {options.isError && (
            <div className="speech-feedback is-error" role="alert">
              模型参数读取失败：{options.error.message}
              <button
                className="btn"
                type="button"
                onClick={() => void options.refetch()}
              >
                重新读取
              </button>
            </div>
          )}
          {!options.isPending && !options.isError && !selected && (
            <p role="alert" className="speech-feedback is-error">
              模型尚不可用，请在模型服务中检查安装与启用状态。
            </p>
          )}
          <div className="speech-writing">
            <label htmlFor={`${id}-text`}>配音文稿</label>
            <textarea
              id={`${id}-text`}
              aria-label="目标文字"
              value={draft.text}
              maxLength={draft.maxLength}
              rows={5}
              placeholder="输入需要朗读的文字，让参考音色为你的文稿配音…"
              disabled={draft.busy}
              onChange={(event) => draft.setText(event.target.value)}
            />
            <div className="speech-editor-footer">
              <span className="speech-character-count">
                {draft.text.length} / {draft.maxLength} 字
              </span>
              <CustomSelect
                ariaLabel="合成语言"
                value={draft.language}
                options={(limits?.languages ?? []).map((value) => ({
                  value,
                  label: speechLanguageLabel(value),
                }))}
                onChange={draft.setLanguage}
                disabled={draft.busy || !selected || !limits?.languages?.length}
              />
            </div>
          </div>
          <section className="speech-reference" aria-label="参考音色">
            <h2>参考音色</h2>
            <p className="speech-help">
              请上传一段 {limits?.min_reference_seconds ?? 3}–
              {limits?.max_reference_seconds ?? 30} 秒的清晰单人录音，最大{" "}
              {Math.round(
                (limits?.max_reference_bytes ?? 20 * 1024 ** 2) / 1024 ** 2,
              )}{" "}
              MiB，支持{" "}
              {(
                limits?.reference_extensions ?? [".wav", ".mp3", ".m4a", ".ogg"]
              )
                .map((ext) => ext.replace(".", "").toUpperCase())
                .join(" / ")}
              。
            </p>
            <input
              hidden
              ref={fileInput}
              type="file"
              aria-label="参考录音"
              accept={limits?.reference_extensions?.join(",")}
              disabled={inputDisabled}
              onChange={(event) => {
                void draft.upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <div
              className={`speech-reference-file${draft.reference ? " is-ready" : ""}`}
            >
              <span className="speech-file-icon">
                <FileAudio2 size={23} aria-hidden />
              </span>
              <div className="speech-file-name">
                <strong>{draft.reference?.filename ?? "选择参考录音"}</strong>
                <span>
                  {draft.reference ? (
                    <>
                      <CheckCircle2 size={13} aria-hidden />
                      已上传 · {formatFileSize(draft.reference.byte_size)}
                    </>
                  ) : (
                    "从本机上传，或从当前空间的文件库选择"
                  )}
                </span>
              </div>
              <div className="speech-reference-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={inputDisabled}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} aria-hidden />
                  {draft.reference ? "更换" : "上传参考录音"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={inputDisabled}
                  onClick={() => setLibraryOpen(true)}
                >
                  <FolderOpen size={15} aria-hidden />
                  从文件库选择
                </button>
              </div>
            </div>
            <div className="speech-transcript-header">
              <label htmlFor={`${id}-reference-text`}>录音对应文字</label>
              <button
                className="speech-text-button"
                type="button"
                aria-expanded={expanded}
                aria-controls={`${id}-reference-text`}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起编辑" : "展开编辑"}
                <ChevronDown size={14} aria-hidden />
              </button>
            </div>
            <p className="speech-help">
              请填写这段参考录音中实际说出的内容，帮助模型还原音色。
            </p>
            <textarea
              id={`${id}-reference-text`}
              value={draft.referenceText}
              maxLength={draft.maxLength}
              rows={expanded ? 5 : 2}
              placeholder="例如：今天的天气很好，适合出门散步。"
              disabled={draft.busy}
              onChange={(event) => draft.setReferenceText(event.target.value)}
            />
            <span className="speech-character-count speech-transcript-count">
              {draft.referenceText.length} / {draft.maxLength} 字
            </span>
          </section>
          <div className="speech-submit-row">
            <button
              className="btn primary speech-generate"
              type="submit"
              disabled={!draft.canSubmit}
            >
              {draft.busy ? null : <AudioLines size={19} aria-hidden />}
              {draft.busy ? (
                <LoadingState variant="inline" label="正在处理…" />
              ) : (
                "生成语音"
              )}
            </button>
            <span className="speech-privacy">
              <LockKeyhole size={15} aria-hidden />
              参考录音与生成音频在本机处理。
            </span>
          </div>
          {!canUse || !canWrite ? (
            <p className="speech-help">
              生成语音与上传参考录音需要模型使用和内容写入权限。
            </p>
          ) : (
            !draft.reference && (
              <p className="speech-help">
                准备好配音文稿、参考录音和对应文字后，即可生成语音。
              </p>
            )
          )}
          {draft.message && (
            <p className="speech-feedback" role="status">
              {draft.message}
            </p>
          )}
          {draft.error && (
            <p className="speech-feedback is-error" role="alert">
              {draft.error}
            </p>
          )}
        </form>
      </div>
      {libraryOpen && (
        <LibraryPicker
          maxBytes={limits?.max_reference_bytes ?? 20 * 1024 ** 2}
          onClose={() => setLibraryOpen(false)}
          onSelect={(file) => {
            setLibraryOpen(false);
            void draft.importReference(file.id);
          }}
        />
      )}
    </section>
  );
}
