import {
  ChevronRight,
  CircleHelp,
  Layers3,
  Mic2,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { formatFileSize } from "@shared/lib/fileSize";
import {
  AUDIO_ROLE_LABELS,
  audioReferences,
  type AudioRole,
} from "@features/galgame-workshop/editor/model";
import { StoryAudioPicker } from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

type SoundMode = "bgm" | "sfx" | "voice";

const MODE_ROLES: Record<SoundMode, AudioRole[]> = {
  bgm: ["backgroundMusic"],
  sfx: ["soundEffect", "ambientSound"],
  voice: ["voiceLine", "voiceSample", "timelineMaster"],
};

function formatDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return "—";
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

function formatTranscriptTime(durationMs: number) {
  const seconds = Math.max(0, durationMs) / 1000;
  const wholeSeconds = Math.floor(seconds);
  const milliseconds = Math.round((seconds - wholeSeconds) * 1000);
  return `${Math.floor(wholeSeconds / 60)}:${(wholeSeconds % 60)
    .toString()
    .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

function speakerTone(speaker: string) {
  let hash = 0;
  for (const character of speaker)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 6;
}

import { useSoundWorkspaceController } from "@features/galgame-workshop/editor/audio/useSoundWorkspaceController";

export function SoundWorkspaceView({
  controller,
}: {
  controller: ReturnType<typeof useSoundWorkspaceController>;
}) {
  const {
    projectId,
    document,
    onDocument,
    onLocate,
    onCharacter,
    initialRole,
    fileInput,
    mode,
    copy,
    ModeIcon,
    assets,
    query,
    setQuery,
    setSelectedId,
    pendingRole,
    pickerSource,
    setPickerSource,
    pickerOpen,
    setPickerOpen,
    speakerFilter,
    setSpeakerFilter,
    inspectorTab,
    setInspectorTab,
    measuredDurations,
    setMeasuredDurations,
    busyDelete,
    asrSettings,
    transcriptionTasks,
    filesById,
    selected,
    references,
    selectedFile,
    asrModels,
    visible,
    usedFileIds,
    currentScopeLabel,
    bindFile,
    upload,
    updateAsrSettings,
    recognize,
    manualTranscript,
    autoMatch,
    chooseRoleAndOpen,
    deleteSelected,
    speakerCount,
  } = controller;
  return (
    <section className={`galgame-sound-workspace is-${mode}`}>
      <header className="galgame-sound-workspace-header">
        <span>
          <ModeIcon aria-hidden />
          <strong>{copy.title}</strong>
          <em>{assets.length} 项</em>
        </span>
      </header>

      {mode === "voice" ? (
        <aside className="galgame-voice-speakers" aria-label="语音角色筛选">
          <button
            type="button"
            className={speakerFilter === "all" ? "active" : ""}
            onClick={() => setSpeakerFilter("all")}
          >
            <span className="galgame-voice-speaker-icon is-all">
              <Layers3 aria-hidden />
            </span>
            <strong>全部</strong>
            <em>{speakerCount("all")}</em>
          </button>
          {(document.characters ?? []).map((character) => {
            const filter = `character:${character.id}` as const;
            return (
              <button
                key={character.id}
                type="button"
                className={speakerFilter === filter ? "active" : ""}
                onClick={() => setSpeakerFilter(filter)}
              >
                <span className="galgame-voice-speaker-avatar" aria-hidden>
                  {character.name.trim().slice(0, 1) || "角"}
                </span>
                <strong>{character.name}</strong>
                <em>{speakerCount(filter)}</em>
              </button>
            );
          })}
          <button
            type="button"
            className={speakerFilter === "narrator" ? "active" : ""}
            onClick={() => setSpeakerFilter("narrator")}
          >
            <span className="galgame-voice-speaker-icon">
              <Mic2 aria-hidden />
            </span>
            <strong>旁白</strong>
            <em>{speakerCount("narrator")}</em>
          </button>
          <button
            type="button"
            className={speakerFilter === "unknown" ? "active" : ""}
            onClick={() => setSpeakerFilter("unknown")}
          >
            <span className="galgame-voice-speaker-icon">
              <CircleHelp aria-hidden />
            </span>
            <strong>未知</strong>
            <em>{speakerCount("unknown")}</em>
          </button>
        </aside>
      ) : null}

      <main className="galgame-sound-library">
        <section className="galgame-sound-library-toolbar">
          <span>
            {mode === "voice" ? <strong>{currentScopeLabel}</strong> : null}
            <small>{copy.description}</small>
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => chooseRoleAndOpen(initialRole)}
          >
            <Upload aria-hidden /> 导入
          </button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </section>

        {mode === "voice" ? (
          <section className="galgame-asr-toolbar">
            <header>
              <span
                className={asrSettings.data?.modelReady ? "ready" : "danger"}
              >
                {asrSettings.data?.modelReady ? "模型已就绪" : "模型未就绪"}
              </span>
              <small>当前视图：{currentScopeLabel}</small>
            </header>
            <div>
              <CustomSelect
                value={asrSettings.data?.modelId ?? ""}
                disabled={!asrSettings.data || updateAsrSettings.isPending}
                ariaLabel="语音识别模型"
                className="galgame-asr-model-select"
                options={[
                  { value: "", label: "选择语音识别模型" },
                  ...asrModels.map((model) => ({
                    value: model.id,
                    label: model.label || model.slug,
                  })),
                ]}
                onChange={(value) =>
                  updateAsrSettings.mutate({
                    modelId: value || null,
                  })
                }
              />
              <label>
                语言
                <CustomSelect
                  value={asrSettings.data?.defaultLanguage ?? "auto"}
                  ariaLabel="识别语言"
                  className="galgame-asr-language-select"
                  options={[
                    { value: "auto", label: "自动" },
                    { value: "zh", label: "中文" },
                    { value: "ja", label: "日语" },
                  ]}
                  onChange={(value) =>
                    updateAsrSettings.mutate({
                      defaultLanguage: value as "auto" | "zh" | "ja",
                    })
                  }
                />
              </label>
              <label>
                并发
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={asrSettings.data?.concurrency ?? 2}
                  onChange={(event) =>
                    updateAsrSettings.mutate({
                      concurrency: Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
            <footer>
              <button
                type="button"
                disabled={!asrSettings.data?.modelReady || recognize.isPending}
                onClick={() => recognize.mutate(false)}
              >
                <Sparkles aria-hidden /> 识别待处理
              </button>
              <button
                type="button"
                className="primary"
                disabled={!asrSettings.data?.modelReady || recognize.isPending}
                onClick={() => recognize.mutate(true)}
              >
                <RefreshCw aria-hidden /> 重新识别
              </button>
              <button
                type="button"
                disabled={autoMatch.isPending}
                onClick={() => autoMatch.mutate()}
              >
                自动匹配对白
              </button>
            </footer>
          </section>
        ) : null}

        <label className="galgame-sound-search">
          <Search aria-hidden />
          <input
            aria-label={`搜索${copy.title}`}
            value={query}
            placeholder={copy.search}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>
            {visible.length} / {assets.length}
          </span>
        </label>

        <div
          className={`galgame-sound-table-heading ${mode === "voice" ? "is-voice" : ""}`}
          aria-hidden
        >
          <span>{mode === "voice" ? "文件名 / 识别文本" : "文件名"}</span>
          <span>时长</span>
          <span>大小</span>
          <span />
        </div>
        <div
          className={`galgame-sound-list ${mode === "voice" ? "is-voice" : ""}`}
        >
          {visible.map((asset) => {
            const file = filesById.get(asset.fileId);
            const filename = file?.display_name ?? asset.label;
            const usage = audioReferences(document, asset.id).length;
            return (
              <article
                key={asset.id}
                className={asset.id === selected?.id ? "selected" : ""}
              >
                <StoryAudioPreview
                  fileId={asset.fileId}
                  label={asset.label}
                  compact
                  onDurationMs={(durationMs) =>
                    setMeasuredDurations((current) =>
                      current[asset.fileId] === durationMs
                        ? current
                        : { ...current, [asset.fileId]: durationMs },
                    )
                  }
                />
                <button
                  type="button"
                  className="galgame-sound-row-identity"
                  aria-label={`选择声音 ${asset.label}`}
                  onClick={() => {
                    setSelectedId(asset.id);
                    setInspectorTab("properties");
                  }}
                >
                  <strong>{filename}</strong>
                  {mode === "voice" ? (
                    <small>
                      {file?.transcript ||
                        (file?.transcriptStatus === "failed"
                          ? "识别失败"
                          : "等待识别文本")}
                    </small>
                  ) : usage ? (
                    <small>使用 {usage} 次</small>
                  ) : null}
                </button>
                <time>
                  {formatDuration(
                    file?.durationMs ?? measuredDurations[asset.fileId],
                  )}
                </time>
                <span>{formatFileSize(file?.byte_size)}</span>
                <button
                  type="button"
                  className="galgame-sound-row-more"
                  aria-label={`查看 ${asset.label} 详情`}
                  onClick={() => setSelectedId(asset.id)}
                >
                  <MoreHorizontal aria-hidden />
                </button>
              </article>
            );
          })}
          {!visible.length ? (
            <div className="galgame-sound-empty">
              <ModeIcon aria-hidden />
              <strong>{copy.emptyTitle}</strong>
              <span>{copy.emptyDescription}</span>
            </div>
          ) : null}
        </div>
      </main>

      <aside className="galgame-sound-inspector">
        {selected ? (
          <>
            <nav aria-label="声音详情视图">
              <button
                type="button"
                className={inspectorTab === "properties" ? "active" : ""}
                onClick={() => setInspectorTab("properties")}
              >
                属性
              </button>
              <button
                type="button"
                className={inspectorTab === "references" ? "active" : ""}
                onClick={() => setInspectorTab("references")}
              >
                使用位置 <em>{references.length}</em>
              </button>
            </nav>
            {inspectorTab === "properties" ? (
              <div className="galgame-sound-properties">
                <header>
                  <span>
                    <ModeIcon aria-hidden />
                  </span>
                  <span>
                    <small>{AUDIO_ROLE_LABELS[selected.role]}</small>
                    <strong>{selected.label}</strong>
                  </span>
                </header>
                <StoryAudioPreview
                  fileId={selected.fileId}
                  label={selected.label}
                />
                {mode === "voice" ? (
                  <section className="galgame-voice-transcript">
                    <header>
                      <strong>识别文本</strong>
                      <span>{selectedFile?.transcriptStatus ?? "pending"}</span>
                    </header>
                    <textarea
                      key={`${selectedFile?.id}-${selectedFile?.transcriptRevision}`}
                      defaultValue={selectedFile?.transcript ?? ""}
                      placeholder="识别完成后显示文本，也可以在此手工修正。"
                      onBlur={(event) => {
                        if (
                          selectedFile &&
                          event.target.value !== (selectedFile.transcript ?? "")
                        )
                          manualTranscript.mutate(event.target.value);
                      }}
                    />
                    <section className="galgame-transcript-segments">
                      <header>
                        <strong>说话人分段</strong>
                        <span>
                          {selectedFile?.transcriptSegments?.length ?? 0} 段
                        </span>
                      </header>
                      {selectedFile?.transcriptSegments?.length ? (
                        <ol>
                          {selectedFile.transcriptSegments.map(
                            (segment, index) => (
                              <li
                                key={`${segment.speaker}-${segment.startMs}-${index}`}
                                className={`speaker-tone-${speakerTone(segment.speaker)}`}
                              >
                                <header>
                                  <strong>{segment.speaker}</strong>
                                  <time>
                                    {formatTranscriptTime(segment.startMs)}–
                                    {formatTranscriptTime(segment.endMs)}
                                  </time>
                                </header>
                                <p>{segment.text}</p>
                              </li>
                            ),
                          )}
                        </ol>
                      ) : (
                        <small>
                          暂无说话人分段；使用 SenseAudio ASR Pro
                          重新识别后可生成。
                        </small>
                      )}
                    </section>
                    <small>
                      {selectedFile?.virtualPath ?? "voice/"} ·{" "}
                      {selectedFile?.durationMs
                        ? `${(selectedFile.durationMs / 1000).toFixed(2)} 秒`
                        : "时长待扫描"}
                    </small>
                    <small>
                      最近任务：
                      {transcriptionTasks.data?.items.find(
                        (task) => task.assetId === selectedFile?.id,
                      )?.status ?? "无"}
                    </small>
                  </section>
                ) : null}
                <label className="galgame-field">
                  <span>显示名称</span>
                  <input
                    value={selected.label}
                    onChange={(event) =>
                      onDocument({
                        ...document,
                        assets: (document.assets ?? []).map((asset) =>
                          asset.id === selected.id && asset.type === "audio"
                            ? { ...asset, label: event.target.value }
                            : asset,
                        ),
                      })
                    }
                  />
                </label>
                <label className="galgame-field">
                  <span>声音类型</span>
                  <CustomSelect
                    ariaLabel="声音类型"
                    value={selected.role}
                    disabled={references.length > 0}
                    options={MODE_ROLES[mode].map((item) => ({
                      value: item,
                      label: AUDIO_ROLE_LABELS[item],
                    }))}
                    onChange={(nextRole) =>
                      onDocument({
                        ...document,
                        assets: (document.assets ?? []).map((asset) =>
                          asset.id === selected.id && asset.type === "audio"
                            ? { ...asset, role: nextRole as AudioRole }
                            : asset,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ) : (
              <section className="galgame-sound-references">
                <header>
                  <strong>使用位置</strong>
                  <small>{references.length} 处引用</small>
                </header>
                {references.map((reference) => (
                  <button
                    key={`${reference.kind}-${reference.blockId ?? reference.characterId ?? reference.fragmentId}`}
                    type="button"
                    onClick={() => {
                      if (reference.characterId)
                        onCharacter(reference.characterId);
                      if (reference.fragmentId && reference.blockId)
                        onLocate(reference.fragmentId, reference.blockId);
                    }}
                  >
                    <span>{reference.label}</span>
                    <ChevronRight aria-hidden />
                  </button>
                ))}
                {!references.length ? <small>尚未在故事中使用</small> : null}
              </section>
            )}
            <footer>
              <button
                type="button"
                className="danger"
                disabled={busyDelete || references.length > 0}
                onClick={() => void deleteSelected()}
              >
                <Trash2 aria-hidden /> 删除{copy.title}
              </button>
            </footer>
          </>
        ) : (
          <div className="galgame-sound-inspector-empty">
            <span>
              <ModeIcon aria-hidden />
            </span>
            <strong>未选择{copy.title}</strong>
            <small>
              在左侧列表中选择并试听
              {mode === "bgm" ? "一首" : "一条"}
              {copy.title}，查看属性与引用位置。
            </small>
          </div>
        )}
      </aside>

      {pickerOpen ? (
        <StoryAudioPicker
          projectId={projectId}
          title={`添加${AUDIO_ROLE_LABELS[pendingRole]}`}
          source={pickerSource}
          usedFileIds={usedFileIds}
          onSource={setPickerSource}
          onChoose={bindFile}
          onUpload={() => fileInput.current?.click()}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  );
}
