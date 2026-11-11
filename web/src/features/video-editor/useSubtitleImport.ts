import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseSubtitleFile,
  subtitleImportOperations,
  type SubtitleParseResult,
  type SubtitleTimingMode,
} from "./subtitleImport";
import type { TimelineEditBuilder } from "./timelineSaveQueue";

type Draft = { fileName: string; result?: SubtitleParseResult; error?: string };

export function useSubtitleImport({
  projectId,
  playheadUs,
  commit,
  onCommitted,
}: {
  projectId: string;
  playheadUs: number;
  commit: (build: TimelineEditBuilder) => Promise<unknown>;
  onCommitted: (clipId: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<Draft>();
  const [pending, setPending] = useState(false);
  const request = useRef(0);
  const committing = useRef(false);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  useEffect(() => {
    setDraft(undefined);
    setPending(false);
    committing.current = false;
    return invalidate;
  }, [projectId, invalidate]);

  const read = async (file: File) => {
    if (committing.current) return;
    const version = ++request.current;
    setDraft({ fileName: file.name });
    try {
      const result = await parseSubtitleFile(file);
      if (version === request.current)
        setDraft({ fileName: file.name, result });
    } catch (error) {
      if (version === request.current)
        setDraft({
          fileName: file.name,
          error: error instanceof Error ? error.message : "字幕文件解析失败",
        });
    }
  };
  const confirm = async (mode: SubtitleTimingMode) => {
    if (!draft?.result?.cues.length || committing.current) return;
    const { cues } = draft.result;
    const version = request.current;
    committing.current = true;
    setPending(true);
    try {
      let clipId: string | undefined;
      await commit(({ document }) => {
        const edit = subtitleImportOperations(
          cues,
          document.tracks ?? [],
          playheadUs,
          mode,
        );
        clipId = edit.track.clips?.[0]?.id;
        return edit;
      });
      if (version !== request.current) return;
      setDraft(undefined);
      onCommitted(clipId);
    } catch (error) {
      if (version === request.current)
        setDraft({
          ...draft,
          error: error instanceof Error ? error.message : "字幕导入失败",
        });
    } finally {
      if (version === request.current) {
        committing.current = false;
        setPending(false);
      }
    }
  };
  return {
    read,
    pending,
    dialog: draft && {
      ...draft,
      pending,
      onCancel: () => {
        if (committing.current) return;
        invalidate();
        setDraft(undefined);
      },
      onConfirm: (mode: SubtitleTimingMode) => void confirm(mode),
    },
  };
}
