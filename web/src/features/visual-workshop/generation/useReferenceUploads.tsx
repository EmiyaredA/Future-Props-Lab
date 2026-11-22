import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SearchablePickerDialog } from "@shared/ui/SearchablePickerDialog";
import { useTransferProgress } from "@platform/api/useTransferProgress";
import { ApiError, apiErrorMessage } from "@platform/api/errors";
import {
  invalidateFileScope,
  uploadManagedFile,
  type ManagedFile,
} from "@features/files";
import { getVisualCanvas, type VisualCanvasVideoGenerationDraft } from "../api";
import {
  cardsKey,
  projectCardsKey,
  listProjectCards,
  registerReferenceImage,
  type Card,
  type CardKind,
  type ReferenceImageInput,
  type ReferenceImageResult,
} from "../creative/api";
import { referenceContentCardIds } from "./referenceContentLinks";
import "./reference-uploads.css";

export type RegisterReferenceImage = (
  input: Omit<ReferenceImageInput, "expected_revision">,
) => Promise<ReferenceImageResult>;
export type DesignReference = NonNullable<
  VisualCanvasVideoGenerationDraft["design_references"]
>[number];
type UploadJob = {
  file: File;
  title: string;
  kind?: CardKind;
  requestId: string;
  uploaded?: ManagedFile;
  error?: string;
};
export function referenceFileKind(file: File) {
  if (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(file.name)
  )
    return "image";
  if (
    file.type.startsWith("video/") ||
    /\.(mp4|webm|mov|mkv)$/i.test(file.name)
  )
    return "video";
  if (
    file.type.startsWith("audio/") ||
    /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file.name)
  )
    return "audio";
}

/** One preparation/registration path serves file selection and OS file drops. */
export function useReferenceUploads({
  projectId,
  targetKey,
  registerImage,
  validate,
  onUploaded,
  onResult,
}: {
  projectId: string;
  targetKey?: string;
  registerImage?: RegisterReferenceImage;
  validate: (kind: ReturnType<typeof referenceFileKind>) => void;
  onUploaded: (file: ManagedFile, design?: DesignReference) => void;
  onResult: (tone: "pending" | "success" | "error", message: string) => void;
}) {
  const client = useQueryClient();
  const transfer = useTransferProgress();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<UploadJob[] | null>(null);
  const [failures, setFailures] = useState<UploadJob[]>([]);
  const [choices, setChoices] = useState<Card[] | null>(null);
  const formAnswer = useRef<((jobs: UploadJob[] | null) => void) | undefined>(
    undefined,
  );
  const cardAnswer = useRef<((card: Card | null) => void) | undefined>(
    undefined,
  );
  const session = useRef({ cancelled: false });
  const locked = useRef(false);
  const latest = useRef({ registerImage, validate, onUploaded, onResult });
  useEffect(() => {
    latest.current = { registerImage, validate, onUploaded, onResult };
  });
  useEffect(() => {
    const current = { cancelled: false };
    session.current = current;
    setForm(null);
    setChoices(null);
    setFailures([]);
    setPending(false);
    return () => {
      current.cancelled = true;
      formAnswer.current?.(null);
      formAnswer.current = undefined;
      cardAnswer.current?.(null);
      cardAnswer.current = undefined;
    };
  }, [projectId, targetKey]);
  async function register(job: UploadJob, current: { cancelled: boolean }) {
    const input = {
      request_id: job.requestId,
      asset_id: job.uploaded!.id,
      kind: job.kind!,
      title: job.title,
    };
    const invoke = async (reuse_card_id?: string) => {
      if (latest.current.registerImage)
        return latest.current.registerImage({ ...input, reuse_card_id });
      const canvas = await getVisualCanvas(projectId);
      return registerReferenceImage(projectId, {
        ...input,
        reuse_card_id,
        expected_revision: canvas.revision,
      });
    };
    let result: ReferenceImageResult;
    try {
      result = await invoke();
    } catch (error) {
      if (current.cancelled) throw error;
      if (
        !(error instanceof ApiError) ||
        error.problem.code !== "reference_image_choice_required"
      )
        throw error;
      const [cards, linked] = await Promise.all([
        listProjectCards(projectId),
        referenceContentCardIds(job.uploaded!.id),
      ]);
      if (current.cancelled) throw error;
      const matches = cards.filter(
        (card) =>
          card.kind === job.kind && !card.archived && linked.includes(card.id),
      );
      if (!matches.length) throw new Error("匹配的项目卡片已变化，请重新选择");
      const chosen = await new Promise<Card | null>((resolve) => {
        cardAnswer.current = resolve;
        setChoices(matches);
      });
      if (!chosen) throw new Error("已取消卡片关联，图片保留在项目文件中");
      result = await invoke(chosen.id);
    }
    client.setQueryData<Card[]>(cardsKey, (cards) => [
      ...(cards ?? []).filter((card) => card.id !== result.card.id),
      result.card,
    ]);
    void client.invalidateQueries({ queryKey: projectCardsKey(projectId) });
    client.setQueryData<Card[]>(projectCardsKey(projectId), (cards) => [
      ...(cards ?? []).filter((card) => card.id !== result.card.id),
      result.card,
    ]);
    return {
      asset_id: job.uploaded!.id,
      card_id: result.card.id,
      card_revision: result.card.revision,
      title: result.card.title,
    };
  }
  async function execute(jobs: UploadJob[], current: { cancelled: boolean }) {
    const failed: UploadJob[] = [];
    let added = 0;
    latest.current.onResult("pending", "正在上传并登记项目参考素材…");
    for (const job of jobs) {
      if (current.cancelled) break;
      try {
        latest.current.validate(referenceFileKind(job.file));
        job.uploaded ??= await transfer.run((onProgress) =>
          uploadManagedFile(job.file, projectId, undefined, undefined, {
            onProgress,
          }),
        );
        if (current.cancelled) break;
        const design = job.kind ? await register(job, current) : undefined;
        if (current.cancelled) break;
        latest.current.onUploaded(job.uploaded, design);
        added++;
      } catch (error) {
        failed.push({ ...job, error: apiErrorMessage(error) });
      }
    }
    void invalidateFileScope(client, projectId);
    if (!current.cancelled) {
      setFailures((previous) => [
        ...previous.filter(
          (job) => !jobs.some((item) => item.requestId === job.requestId),
        ),
        ...failed,
      ]);
      latest.current.onResult(
        failed.length ? "error" : "success",
        `${added ? `已添加 ${added} 项参考素材。` : ""}${failed.map((job) => `${job.file.name}：${job.error}`).join("；")}`,
      );
    }
  }
  async function uploadFiles(files: File[]) {
    if (locked.current || !files.length) return;
    locked.current = true;
    const current = session.current;
    setPending(true);
    try {
      let jobs: UploadJob[] | null = files.map((file) => ({
        file,
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "新建素材",
        requestId: crypto.randomUUID(),
      }));
      if (files.some((file) => referenceFileKind(file) === "image")) {
        jobs = await new Promise<UploadJob[] | null>((resolve) => {
          formAnswer.current = resolve;
          setForm(jobs);
        });
      }
      if (jobs && !current.cancelled) await execute(jobs, current);
    } finally {
      locked.current = false;
      if (!current.cancelled) setPending(false);
    }
  }
  function finishForm(value: UploadJob[] | null) {
    formAnswer.current?.(value);
    formAnswer.current = undefined;
    setForm(null);
  }
  function finishCard(card: Card | null) {
    cardAnswer.current?.(card);
    cardAnswer.current = undefined;
    setChoices(null);
  }
  let dialogs: ReactNode = null;
  if (form)
    dialogs = (
      <Dialog.Root
        open
        onOpenChange={(open) => {
          if (!open) finishForm(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="reference-dialog-overlay" />
          <Dialog.Content className="reference-dialog reference-upload-form">
            <Dialog.Title>上传并加入项目设定</Dialog.Title>
            <Dialog.Description>
              为新图片选择分类；视频和音频将保存到项目文件。
            </Dialog.Description>
            {form.map(
              (job, index) =>
                referenceFileKind(job.file) === "image" && (
                  <div className="reference-upload-row" key={job.requestId}>
                    <label>
                      名称
                      <input
                        aria-label={`素材名称 ${index + 1}`}
                        value={job.title}
                        maxLength={120}
                        onChange={(event) =>
                          setForm(
                            form.map((item) =>
                              item === job
                                ? { ...item, title: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <CustomSelect
                      ariaLabel={`素材分类 ${index + 1}`}
                      value={job.kind ?? ""}
                      options={[
                        { value: "", label: "选择分类", disabled: true },
                        { value: "character", label: "人设" },
                        { value: "scene", label: "场景" },
                        { value: "prop", label: "道具" },
                      ]}
                      onChange={(kind) =>
                        setForm(
                          form.map((item) =>
                            item === job
                              ? { ...item, kind: kind as CardKind }
                              : item,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      disabled={!job.kind}
                      onClick={() =>
                        setForm(
                          form.map((item) =>
                            referenceFileKind(item.file) === "image"
                              ? { ...item, kind: job.kind }
                              : item,
                          ),
                        )
                      }
                    >
                      应用分类到全部
                    </button>
                  </div>
                ),
            )}
            <footer>
              <button type="button" onClick={() => finishForm(null)}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                disabled={form.some(
                  (job) =>
                    referenceFileKind(job.file) === "image" &&
                    (!job.kind || !job.title.trim()),
                )}
                onClick={() => finishForm(form)}
              >
                上传并关联
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  if (choices)
    dialogs = (
      <SearchablePickerDialog
        title="选择已有项目设定卡"
        items={choices.map((card) => ({
          id: card.id,
          label: card.title,
          preview: `/v1/files/${card.adopted_asset_id}/thumbnail`,
        }))}
        onClose={() => finishCard(null)}
        onChoose={(item) =>
          finishCard(choices.find((card) => card.id === item?.id) ?? null)
        }
      />
    );
  const feedback = failures.length > 0 && (
    <div className="reference-upload-failures">
      {failures.map((job) => (
        <div key={job.requestId}>
          <span>
            {job.file.name}：{job.error}
            {job.uploaded && "（文件已保留在当前项目）"}
          </span>
          <button
            type="button"
            disabled={pending || locked.current}
            onClick={async () => {
              if (locked.current) return;
              locked.current = true;
              setPending(true);
              const current = session.current;
              try {
                await execute([job], current);
              } finally {
                locked.current = false;
                if (!current.cancelled) setPending(false);
              }
            }}
          >
            重试 {job.file.name}
          </button>
        </div>
      ))}
    </div>
  );
  return {
    pending,
    uploadFiles,
    dialogs,
    feedback,
    progress: transfer.progress,
  };
}
