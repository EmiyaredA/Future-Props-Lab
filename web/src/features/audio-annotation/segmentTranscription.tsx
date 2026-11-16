import { annotationSnapshot as snapshot } from "./model/snapshot";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getAudioAnnotationTranscriptionOptions,
  transcribeAudioAnnotationSegment,
} from "@features/audio-annotation/api";
import type {
  LanguageTranscriptionControls,
  LanguageTranscriptionTarget,
} from "@features/audio-annotation/LanguageAnnotationEditor";
import type {
  AnnotationSnapshot,
  AudioAnnotationDocument,
  AudioAnnotationSegment,
  AudioAnnotationTranscriptionOption,
} from "@features/audio-annotation/types";
import type { AnnotationPlayback as AudioWaveformHandle } from "./playback";
import { modelQueryKeys } from "@features/models";

const MODEL_STORAGE_PREFIX = "fpl_audio_annotation_transcription_model";
const EMPTY_OPTIONS: AudioAnnotationTranscriptionOption[] = [];

type SegmentTranscriptionTarget = LanguageTranscriptionTarget & {
  segmentId: string;
  startMs: number;
  endMs: number;
  scope: symbol;
};

type CompletedSegmentTranscription = {
  target: SegmentTranscriptionTarget;
  text: string;
};

export type SegmentTranscriptionController = ReturnType<
  typeof useSegmentTranscription
>;

export function useSegmentTranscription({
  projectId,
  accountId,
  readDocument,
  applySnapshot,
  selected,
  conflict,
  waveformRef,
  setNotice,
}: {
  projectId: string;
  accountId: string;
  readDocument: () => AudioAnnotationDocument | null;
  applySnapshot: (next: AnnotationSnapshot) => boolean;
  selected: AudioAnnotationSegment | null;
  conflict: boolean;
  waveformRef: MutableRefObject<AudioWaveformHandle | null>;
  setNotice: Dispatch<SetStateAction<string>>;
}) {
  const { run: runTransfer, progress: activeTransferProgress } =
    useTransferProgress();

  const [audioReady, setAudioReady] = useState(false);
  const [modelId, setModelId] = useState("");
  const [confirmTarget, setConfirmTarget] =
    useState<SegmentTranscriptionTarget | null>(null);
  const [completed, setCompleted] =
    useState<CompletedSegmentTranscription | null>(null);
  const scope = useMemo(
    () => Symbol(`annotation-transcription:${accountId}:${projectId}`),
    [accountId, projectId],
  );
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    currentScope.current = scope;
    return () => {
      if (currentScope.current === scope)
        currentScope.current = Symbol("closed");
    };
  }, [scope]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const optionsQuery = useQuery({
    queryKey: modelQueryKeys.transcriptionOptions,
    queryFn: getAudioAnnotationTranscriptionOptions,
  });
  const options = optionsQuery.data?.items ?? EMPTY_OPTIONS;
  const selectedOption = options.find((option) => option.id === modelId);

  useEffect(() => {
    if (!options.length) {
      setModelId("");
      return;
    }
    if (options.some((option) => option.id === modelId)) return;
    const remembered = window.localStorage.getItem(
      `${MODEL_STORAGE_PREFIX}:${accountId}`,
    );
    setModelId(
      options.find((option) => option.id === remembered)?.id ?? options[0]!.id,
    );
  }, [modelId, options, accountId]);

  const targetText = (target: SegmentTranscriptionTarget): string | null => {
    if (target.scope !== currentScope.current) return null;
    const segment = readDocument()?.segments.find(
      (item) => item.id === target.segmentId,
    );
    if (
      !segment ||
      segment.start_ms !== target.startMs ||
      segment.end_ms !== target.endMs
    )
      return null;
    if (target.version === "primary") return segment.text;
    return (
      segment.localized_texts?.find((item) => item.language === target.version)
        ?.text ?? null
    );
  };

  const applyText = (target: SegmentTranscriptionTarget, text: string) => {
    const current = readDocument();
    if (!current || targetText(target) === null) return false;
    let found = false;
    const segments = current.segments.map((segment) => {
      if (segment.id !== target.segmentId) return segment;
      if (target.version === "primary") {
        found = true;
        return { ...segment, text, status: "draft" as const };
      }
      const localized = segment.localized_texts ?? [];
      if (!localized.some((item) => item.language === target.version))
        return segment;
      found = true;
      return {
        ...segment,
        localized_texts: localized.map((item) =>
          item.language === target.version ? { ...item, text } : item,
        ),
        status: "draft" as const,
      };
    });
    if (!found) return false;
    return applySnapshot(snapshot({ ...current, segments }));
  };

  const mutation = useMutation({
    mutationFn: (input: { target: SegmentTranscriptionTarget; wav: Blob }) =>
      runTransfer((onProgress) =>
        transcribeAudioAnnotationSegment(
          projectId,
          {
            wav: input.wav,
            modelId,
            segmentId: input.target.segmentId,
            startMs: input.target.startMs,
            endMs: input.target.endMs,
            languageTag: input.target.sourceLanguage,
            targetLanguageTag: input.target.targetLanguage,
          },
          { onProgress },
        ),
      ),
    onSuccess: (result, input) => {
      if (input.target.scope !== currentScope.current) return;
      if (!result.text.trim()) {
        setNotice("当前片段未识别到语音，内容保持不变。");
        return;
      }
      const latestText = targetText(input.target);
      if (latestText === null) {
        setNotice("目标片段或语言版本已不存在，转写结果未写入。");
      } else if (latestText !== input.target.text) {
        setCompleted({
          target: input.target,
          text: result.text,
        });
      } else if (applyText(input.target, result.text)) {
        setNotice(`已自动识别语音并转写到${input.target.label}。`);
      }
    },
    onError: (error) =>
      setNotice(
        error instanceof Error ? error.message : "当前片段转写失败，请重试。",
      ),
  });

  const start = (target: SegmentTranscriptionTarget) => {
    if (!selectedOption) {
      setNotice("请先选择可用的语音识别模型。");
      return;
    }
    const wav = waveformRef.current?.exportRangeWav(
      target.startMs,
      target.endMs,
    );
    if (!wav) {
      setNotice("音频仍在加载，暂时不能转写当前片段。");
    } else if (wav.size > selectedOption.max_input_bytes) {
      setNotice(
        `当前片段超过所选模型 ${Math.round(selectedOption.max_input_bytes / 1024 / 1024)} MB 的上传上限。`,
      );
    } else {
      setNotice("");
      mutation.mutate({ target, wav });
    }
  };

  const request = (target: LanguageTranscriptionTarget) => {
    const current = selectedRef.current;
    if (!current) return;
    const captured: SegmentTranscriptionTarget = {
      ...target,
      scope,
      segmentId: current.id,
      startMs: current.start_ms,
      endMs: current.end_ms,
    };
    if (target.text.trim()) setConfirmTarget(captured);
    else start(captured);
  };

  const estimatedBytes = selected
    ? 44 +
      Math.round(((selected.end_ms - selected.start_ms) / 1000) * 16_000) * 2
    : 0;
  const disabledReason = conflict
    ? "请先处理文档版本冲突，再转写片段。"
    : !audioReady
      ? "音频仍在加载，加载完成后即可转写。"
      : optionsQuery.isError
        ? "语音识别模型列表加载失败，请稍后重试。"
        : selectedOption && estimatedBytes > selectedOption.max_input_bytes
          ? `当前片段超过所选模型 ${Math.round(selectedOption.max_input_bytes / 1024 / 1024)} MB 的上传上限。`
          : undefined;

  const controls: LanguageTranscriptionControls = {
    options,
    modelId,
    pending: mutation.isPending,
    disabledReason,
    onModelChange: (nextModelId) => {
      setModelId(nextModelId);
      window.localStorage.setItem(
        `${MODEL_STORAGE_PREFIX}:${accountId}`,
        nextModelId,
      );
    },
    onTranscribe: request,
  };

  return {
    transferProgress: activeTransferProgress,
    controls,
    setAudioReady,
    confirmTarget,
    setConfirmTarget,
    completed,
    setCompleted,
    start,
    applyText,
    setNotice,
  };
}
