import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createSpeechTask,
  deleteInferenceAudio,
  importInferenceAudio,
  uploadInferenceAudio,
  type InferenceAsset,
} from "@features/models/localModelApi";
import { modelQueryKeys } from "@features/models/queryKeys";
import { apiErrorMessage } from "@platform/api/errors";
import type { InferenceTask } from "@features/models/localModelApi";

export type SpeechLimits = {
  languages?: string[];
  max_text_length?: number;
  max_reference_bytes?: number;
  reference_extensions?: string[];
  min_reference_seconds?: number;
  max_reference_seconds?: number;
};

export function useSpeechDraft({
  modelId,
  limits,
  allowed,
  onCreated,
}: {
  modelId: string;
  limits?: SpeechLimits;
  allowed: boolean;
  onCreated: (id: string) => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [language, setLanguage] = useState("Chinese");
  const [reference, setReference] = useState<InferenceAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const maxLength = limits?.max_text_length ?? 2000;
  const languages = limits?.languages ?? [];
  const effectiveLanguage = languages.includes(language)
    ? language
    : (languages[0] ?? "");
  const valid =
    !!text.trim() &&
    !!referenceText.trim() &&
    !!reference &&
    !!effectiveLanguage &&
    text.length <= maxLength &&
    referenceText.length <= maxLength;
  const canSubmit = allowed && valid && !busy;

  async function replaceReference(load: () => Promise<InferenceAsset>) {
    if (!allowed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = await load();
      if (!mounted.current) return;
      const previous = reference;
      setReference(next);
      if (previous) {
        try {
          await deleteInferenceAudio(previous.id);
        } catch {
          if (mounted.current)
            setMessage("新参考录音已就绪，旧输入清理失败；可继续生成。");
        }
      }
    } catch (cause) {
      if (mounted.current) setError(apiErrorMessage(cause, "参考录音读取失败"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    const maxBytes = limits?.max_reference_bytes ?? 20 * 1024 ** 2;
    if (file.size > maxBytes) {
      setError("参考录音超过大小限制");
      return;
    }
    const suffix = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (
      limits?.reference_extensions?.length &&
      !limits.reference_extensions.includes(suffix)
    ) {
      setError(`请选择 ${limits.reference_extensions.join(" / ")} 格式的录音`);
      return;
    }
    await replaceReference(() => uploadInferenceAudio(file));
  }

  async function submit() {
    if (!canSubmit || !reference || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const scope = client
      .getQueryCache()
      .find({ queryKey: modelQueryKeys.inferenceTasks, exact: true });
    const isCurrent = () =>
      mounted.current &&
      client
        .getQueryCache()
        .find({ queryKey: modelQueryKeys.inferenceTasks, exact: true }) ===
        scope;
    try {
      const task = await createSpeechTask(
        modelId,
        text,
        effectiveLanguage,
        reference,
        referenceText,
      );
      if (!isCurrent()) return;
      setReference(null);
      // The task owns its input now; only a new explicit selection can supply another task.
      setMessage(
        "已提交生成任务。下次生成请重新选择参考录音，文稿与对应文字已保留。",
      );
      if (task) {
        client.setQueryData<{ items: InferenceTask[]; total: number }>(
          modelQueryKeys.inferenceTasks,
          (current) => ({
            items: [
              task,
              ...(current?.items ?? []).filter((item) => item.id !== task.id),
            ],
            total:
              (current?.total ?? 0) +
              (current?.items.some((item) => item.id === task.id) ? 0 : 1),
          }),
        );
        onCreated(task.id);
      }
      try {
        await client.invalidateQueries(
          { queryKey: modelQueryKeys.inferenceTasks },
          { throwOnError: true },
        );
      } catch {
        if (isCurrent())
          setError("任务已提交，记录刷新失败。请刷新记录核对，不要重复提交。");
      }
    } catch (cause) {
      if (isCurrent())
        setError(apiErrorMessage(cause, "提交失败，请检查生成记录后再操作"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    text,
    setText,
    referenceText,
    setReferenceText,
    language: effectiveLanguage,
    setLanguage,
    reference,
    busy,
    error,
    message,
    canSubmit,
    maxLength,
    upload,
    importReference: (id: string) =>
      replaceReference(() => importInferenceAudio(id)),
    submit,
  };
}
