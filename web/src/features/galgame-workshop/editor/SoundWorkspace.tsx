import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  CircleHelp,
  Layers3,
  Mic2,
  MoreHorizontal,
  Music2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import {
  createGalgameTranscriptions,
  deleteGalgameProjectAsset,
  getGalgameAsrSettings,
  getGalgameProjectAssets,
  getGalgameStoryDocument,
  getGalgameTranscriptions,
  matchGalgameVoiceDialogue,
  patchGalgameAsrSettings,
  patchGalgameTranscript,
  uploadGalgameProjectAsset,
  type GalgameStoryAudioAsset,
  type GalgameStoryProject,
} from "@features/galgame-workshop/api";
import { getCatalog } from "@features/models";
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  AUDIO_ROLE_LABELS,
  audioReferences,
  stableId,
  type AudioRole,
} from "@features/galgame-workshop/editor/model";
import {
  StoryAudioPicker,
  type StoryAudioPickerSource,
} from "@features/galgame-workshop/editor/StoryAudioPicker";
import { StoryAudioPreview } from "@features/galgame-workshop/editor/StoryAudioPreview";

type SoundMode = "bgm" | "sfx" | "voice";
type SpeakerFilter = "all" | "narrator" | "unknown" | `character:${string}`;
type InspectorTab = "properties" | "references";

const MODE_ROLES: Record<SoundMode, AudioRole[]> = {
  bgm: ["backgroundMusic"],
  sfx: ["soundEffect", "ambientSound"],
  voice: ["voiceLine", "voiceSample"],
};

const MODE_COPY = {
  bgm: {
    title: "BGM",
    description: "通常循环播放",
    search: "搜索 BGM",
    emptyTitle: "还没有 BGM",
    emptyDescription: "导入一首背景音乐，供时间轴和背景音乐 Block 使用。",
  },
  sfx: {
    title: "音效",
    description: "单次触发 · 含环境音",
    search: "搜索音效",
    emptyTitle: "还没有音效",
    emptyDescription: "导入音效或环境音，供演出时间轴使用。",
  },
  voice: {
    title: "语音",
    description: "识别并匹配角色",
    search: "搜索文件名或识别文本",
    emptyTitle: "还没有语音",
    emptyDescription: "导入对白语音或角色样本，再进行识别和对白匹配。",
  },
} as const;

function displayLabel(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || "未命名声音";
}

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

function formatBytes(bytes?: number | null) {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function modeForRole(role: AudioRole): SoundMode {
  if (role === "backgroundMusic") return "bgm";
  if (role === "voiceLine" || role === "voiceSample") return "voice";
  return "sfx";
}

function voiceAssignments(
  document: GalgameStoryProject,
  assets: GalgameStoryAudioAsset[],
) {
  const knownCharacterIds = new Set(
    (document.characters ?? []).map((character) => character.id),
  );
  return new Map(
    assets.map((asset) => {
      const characterIds = new Set<string>();
      let narrator = false;
      let assigned = false;
      for (const character of document.characters ?? []) {
        if (character.voiceProfile?.sampleAssetId !== asset.id) continue;
        assigned = true;
        characterIds.add(character.id);
      }
      for (const chapter of document.chapters ?? []) {
        for (const fragment of chapter.fragments ?? []) {
          for (const block of fragment.blocks ?? []) {
            if (block.type !== "dialogue" || block.voiceAssetId !== asset.id)
              continue;
            assigned = true;
            const speakers = dialogueSpeakerIds(block).filter(Boolean);
            if (!speakers.length) narrator = true;
            for (const speakerId of speakers) {
              if (knownCharacterIds.has(speakerId)) characterIds.add(speakerId);
            }
          }
        }
      }
      return [
        asset.id,
        { characterIds, narrator, unknown: !assigned },
      ] as const;
    }),
  );
}

export function SoundWorkspace({
  projectId,
  document,
  onDocument,
  onCommitDocument,
  onLocate,
  onCharacter,
  onNotice,
  initialRole = "backgroundMusic",
  storyRevision,
}: {
  projectId: string;
  document: GalgameStoryProject;
  onDocument: (document: GalgameStoryProject) => void;
  onCommitDocument: (document: GalgameStoryProject) => Promise<boolean>;
  onLocate: (fragmentId: string, blockId: string) => void;
  onCharacter: (characterId: string) => void;
  onNotice: (message: string) => void;
  initialRole?: AudioRole;
  storyRevision: number;
}) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const mode = modeForRole(initialRole);
  const copy = MODE_COPY[mode];
  const ModeIcon = mode === "bgm" ? Music2 : mode === "voice" ? Mic2 : Volume2;
  const allAudioAssets = useMemo(
    () =>
      (document.assets ?? []).filter(
        (asset): asset is GalgameStoryAudioAsset => asset.type === "audio",
      ),
    [document.assets],
  );
  const assets = useMemo(
    () =>
      allAudioAssets.filter((asset) => MODE_ROLES[mode].includes(asset.role)),
    [allAudioAssets, mode],
  );
  const assignments = useMemo(
    () => voiceAssignments(document, assets),
    [assets, document],
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [pendingRole, setPendingRole] = useState<AudioRole>(initialRole);
  const [pickerSource, setPickerSource] =
    useState<StoryAudioPickerSource>("project");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speakerFilter, setSpeakerFilter] = useState<SpeakerFilter>("all");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties");
  const [measuredDurations, setMeasuredDurations] = useState<
    Record<string, number>
  >({});
  const [busyDelete, setBusyDelete] = useState(false);
  const projectFilesQuery = useQuery({
    queryKey: ["galgame-project-assets", projectId, ""],
    queryFn: () => getGalgameProjectAssets(projectId),
  });
  const asrSettings = useQuery({
    queryKey: ["galgame-asr-settings", projectId],
    queryFn: () => getGalgameAsrSettings(projectId),
    enabled: mode === "voice",
  });
  const catalog = useQuery({
    queryKey: ["model-catalog", "galgame-asr"],
    queryFn: getCatalog,
    enabled: mode === "voice",
  });
  const transcriptionTasks = useQuery({
    queryKey: ["galgame-asr-tasks", projectId],
    queryFn: () => getGalgameTranscriptions(projectId),
    enabled: mode === "voice",
    refetchInterval: mode === "voice" ? 3000 : false,
  });
  const filesById = useMemo(
    () =>
      new Map(
        (projectFilesQuery.data?.items ?? []).map((file) => [file.id, file]),
      ),
    [projectFilesQuery.data?.items],
  );
  const selected = assets.find((asset) => asset.id === selectedId);
  const references = selected ? audioReferences(document, selected.id) : [];
  const selectedFile = selected ? filesById.get(selected.fileId) : undefined;
  const asrModels = (catalog.data?.providers ?? []).flatMap((provider) =>
    ["openai", "senseaudio_asr"].includes(provider.kind) && provider.enabled
      ? provider.models.filter(
          (model) =>
            model.enabled &&
            (model.capabilities.includes("speech_recognition") ||
              model.categories.includes("speech_recognition")),
        )
      : [],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visible = assets.filter((asset) => {
    const file = filesById.get(asset.fileId);
    const matchesQuery =
      !normalizedQuery ||
      `${asset.label} ${file?.display_name ?? ""} ${file?.transcript ?? ""}`
        .toLocaleLowerCase("zh-CN")
        .includes(normalizedQuery);
    if (!matchesQuery || mode !== "voice" || speakerFilter === "all")
      return matchesQuery;
    const assignment = assignments.get(asset.id);
    if (speakerFilter === "narrator") return assignment?.narrator ?? false;
    if (speakerFilter === "unknown") return assignment?.unknown ?? true;
    return (
      assignment?.characterIds.has(speakerFilter.replace("character:", "")) ??
      false
    );
  });
  const usedFileIds = new Set(
    (document.assets ?? []).map((asset) => asset.fileId),
  );
  const currentScopeLabel =
    speakerFilter === "all"
      ? "全部"
      : speakerFilter === "narrator"
        ? "旁白"
        : speakerFilter === "unknown"
          ? "未知"
          : ((document.characters ?? []).find(
              (character) =>
                character.id === speakerFilter.replace("character:", ""),
            )?.name ?? "角色");

  useEffect(() => {
    setPendingRole(initialRole);
    setSelectedId(undefined);
    setQuery("");
    setSpeakerFilter("all");
    setInspectorTab("properties");
  }, [initialRole]);

  useEffect(() => {
    if (selectedId && !assets.some((asset) => asset.id === selectedId))
      setSelectedId(undefined);
  }, [assets, selectedId]);

  const bindFile = (fileId: string, name: string) => {
    const existing = allAudioAssets.find(
      (asset) => asset.fileId === fileId && asset.role === pendingRole,
    );
    if (existing) {
      setSelectedId(existing.id);
      setPickerOpen(false);
      return;
    }
    const asset: GalgameStoryAudioAsset = {
      id: stableId(),
      type: "audio",
      role: pendingRole,
      label: displayLabel(name),
      fileId,
      status: "ready",
    };
    onDocument({ ...document, assets: [...(document.assets ?? []), asset] });
    setSelectedId(asset.id);
    setPickerOpen(false);
  };

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadGalgameProjectAsset(
        projectId,
        file,
        pendingRole === "backgroundMusic"
          ? "bgm"
          : pendingRole === "ambientSound"
            ? "ambient"
            : pendingRole === "soundEffect"
              ? "sfx"
              : "voice",
      ),
    onSuccess: (asset) => {
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      bindFile(asset.id, asset.display_name);
    },
    onError: (caught) =>
      onNotice(caught instanceof Error ? caught.message : "声音上传失败"),
  });
  const updateAsrSettings = useMutation({
    mutationFn: (changes: {
      modelId?: string | null;
      defaultLanguage?: "auto" | "zh" | "ja";
      concurrency?: number;
    }) => patchGalgameAsrSettings(projectId, asrSettings.data!, changes),
    onSuccess: (value) =>
      client.setQueryData(["galgame-asr-settings", projectId], value),
    onError: () => onNotice("语音识别设置保存失败。"),
  });
  const recognize = useMutation({
    mutationFn: (force: boolean) =>
      createGalgameTranscriptions(projectId, {
        language: asrSettings.data?.defaultLanguage,
        force,
      }),
    onSuccess: (result) => {
      void client.invalidateQueries({
        queryKey: ["galgame-asr-tasks", projectId],
      });
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      onNotice(`已提交 ${result.items.length} 个语音识别任务。`);
    },
    onError: () => onNotice("无法提交识别任务，请先选择可用模型。"),
  });
  const manualTranscript = useMutation({
    mutationFn: (text: string) =>
      patchGalgameTranscript(
        projectId,
        selectedFile!.id,
        selectedFile!.transcriptRevision ?? 0,
        text,
        (asrSettings.data?.defaultLanguage ?? "auto") as "auto" | "zh" | "ja",
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["galgame-project-assets", projectId],
      });
      onNotice("识别文本已标记为手工修正。");
    },
    onError: () => onNotice("识别文本保存失败。"),
  });
  const autoMatch = useMutation({
    mutationFn: () => matchGalgameVoiceDialogue(projectId, storyRevision),
    onSuccess: async (result) => {
      const latest = await getGalgameStoryDocument(projectId);
      onDocument(latest.document);
      onNotice(`已自动匹配 ${result.matches.length} 条对白。`);
    },
    onError: () => onNotice("对白匹配失败，Story 可能已被其他修改占用。"),
  });

  const chooseRoleAndOpen = (nextRole: AudioRole) => {
    setPendingRole(nextRole);
    setPickerSource("project");
    setPickerOpen(true);
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (references.length) {
      onNotice(`无法删除：声音仍被 ${references.length} 处内容引用。`);
      return;
    }
    const next = {
      ...document,
      assets: (document.assets ?? []).filter(
        (asset) => asset.id !== selected.id,
      ),
    };
    setBusyDelete(true);
    const saved = await onCommitDocument(next);
    if (!saved) {
      setBusyDelete(false);
      return;
    }
    const projectFile = filesById.get(selected.fileId);
    const fileStillBound = (next.assets ?? []).some(
      (asset) => asset.fileId === selected.fileId,
    );
    if (projectFile && !fileStillBound) {
      try {
        await deleteGalgameProjectAsset(projectId, projectFile);
        await client.invalidateQueries({
          queryKey: ["galgame-project-assets", projectId],
        });
      } catch (caught) {
        onNotice(
          caught instanceof Error
            ? `故事引用已移除，但文件删除失败：${caught.message}`
            : "故事引用已移除，但文件删除失败。",
        );
      }
    }
    setSelectedId(undefined);
    setBusyDelete(false);
  };

  const speakerCount = (filter: SpeakerFilter) =>
    assets.filter((asset) => {
      if (filter === "all") return true;
      const assignment = assignments.get(asset.id);
      if (filter === "narrator") return assignment?.narrator ?? false;
      if (filter === "unknown") return assignment?.unknown ?? true;
      return (
        assignment?.characterIds.has(filter.replace("character:", "")) ?? false
      );
    }).length;

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
                <span>{formatBytes(file?.byte_size)}</span>
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
