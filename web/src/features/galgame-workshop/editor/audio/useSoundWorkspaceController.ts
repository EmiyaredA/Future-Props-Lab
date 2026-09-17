import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCatalog, modelQueryKeys } from "@features/models";
import { Mic2, Music2, Volume2 } from "lucide-react";
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
import { dialogueSpeakerIds } from "@features/galgame-workshop/editor/dialogue";
import {
  audioReferences,
  stableId,
  type AudioRole,
} from "@features/galgame-workshop/editor/model";
import type { StoryAudioPickerSource } from "@features/galgame-workshop/editor/StoryAudioPicker";
import {
  galgameQueryKeys,
  invalidateGalgameAssetQueries,
} from "@features/galgame-workshop/queryKeys";

type SoundMode = "bgm" | "sfx" | "voice";
type SpeakerFilter = "all" | "narrator" | "unknown" | `character:${string}`;
type InspectorTab = "properties" | "references";

const MODE_ROLES: Record<SoundMode, AudioRole[]> = {
  bgm: ["backgroundMusic"],
  sfx: ["soundEffect", "ambientSound"],
  voice: ["voiceLine", "voiceSample", "timelineMaster"],
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

function modeForRole(role: AudioRole): SoundMode {
  if (role === "backgroundMusic") return "bgm";
  if (
    role === "voiceLine" ||
    role === "voiceSample" ||
    role === "timelineMaster"
  )
    return "voice";
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

export function useSoundWorkspaceController({
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
    queryKey: galgameQueryKeys.projectAssets(projectId, ""),
    queryFn: () => getGalgameProjectAssets(projectId),
  });
  const asrSettings = useQuery({
    queryKey: ["galgame-asr-settings", projectId],
    queryFn: () => getGalgameAsrSettings(projectId),
    enabled: mode === "voice",
  });
  const catalog = useQuery({
    queryKey: modelQueryKeys.catalogFor("galgame-asr"),
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
    ["openai", "senseaudio_asr", "senseaudio_asr_pro"].includes(
      provider.kind,
    ) && provider.enabled
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
      void invalidateGalgameAssetQueries(client, projectId);
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
      void invalidateGalgameAssetQueries(client, projectId);
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
      void invalidateGalgameAssetQueries(client, projectId);
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
        await invalidateGalgameAssetQueries(client, projectId);
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

  return {
    projectId,
    document,
    onDocument,
    onCommitDocument,
    onLocate,
    onCharacter,
    onNotice,
    initialRole,
    storyRevision,
    fileInput,
    mode,
    copy,
    ModeIcon,
    allAudioAssets,
    assets,
    assignments,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    pendingRole,
    setPendingRole,
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
    setBusyDelete,
    projectFilesQuery,
    asrSettings,
    catalog,
    transcriptionTasks,
    filesById,
    selected,
    references,
    selectedFile,
    asrModels,
    normalizedQuery,
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
  };
}
