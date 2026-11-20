import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState, type ReactNode, type HTMLAttributes } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { ProjectMediaPicker } from "./ProjectMediaPicker";
import { VideoDesignReferences } from "./VideoDesignReferences";
import { ReferenceSubjectEditor } from "./ReferenceSubjectEditor";
import { ReferenceAssetDetails } from "./ReferenceAssetDetails";
import { TaskOutputReferenceDialog } from "./TaskOutputReferenceDialog";
import { LegacyReferenceSubjects } from "./LegacyReferenceSubjects";
import { orderedReferenceIds } from "./referenceOrder";
import { subjectLabel } from "./referenceSubjects";
import type { useGenerationDrawerController } from "./useGenerationDrawerController";
import type { VisualCanvasEdge } from "../api";

type Media = "image" | "video" | "audio";
export function VideoReferenceStrip({
  controller: c,
  modeControl,
  expandControl,
  dropHandlers,
  dropActive = false,
}: {
  controller: ReturnType<typeof useGenerationDrawerController>;
  modeControl: ReactNode;
  expandControl: ReactNode;
  dropHandlers?: HTMLAttributes<HTMLElement>;
  dropActive?: boolean;
}) {
  const [request, setRequest] = useState<{
    id: number;
    kind: Media;
    action: "upload" | "project" | "cross";
  }>();
  const [taskDialog, setTaskDialog] = useState<{ edge?: VisualCanvasEdge }>();
  const selections = {
    image: c.references,
    video: c.videoReferences,
    audio: c.audioReferences,
  };
  const fields = {
    image: "reference_asset_ids",
    video: "video_asset_ids",
    audio: "audio_asset_ids",
  } as const;
  const labels = {
    image: "参考图片",
    video: c.videoCapabilities?.uses_temporary_reference_urls
      ? "源视频"
      : "参考视频",
    audio: "参考音频",
  };
  const setters = {
    image: c.setReferences,
    video: c.setVideoReferences,
    audio: c.setAudioReferences,
  };
  const ids = (kind: Media) =>
    kind === "image"
      ? c.imageReferences
      : orderedReferenceIds(selections[kind], c.linkedAssetIds[kind]);
  const images = ids("image");
  const titleFor = (id: string) =>
    c.referenceInputs.find((item) => item.assetId === id)?.title ??
    c.designReferences.find((item) => item.asset_id === id)?.title ??
    c.availableReferenceFiles.find((item) => item.id === id)?.display_name ??
    "素材读取中";
  const change = (kind: Media, next: string[]) => {
    setters[kind](next);
    const subjects = c.referenceSubjects;
    c.persistDraft(
      {
        [fields[kind]]: next,
        ...(kind === "image" && subjects
          ? {
              reference_subjects: Object.fromEntries(
                Object.entries(subjects).filter(
                  ([key]) =>
                    !key.startsWith("asset:") ||
                    next.includes(key.slice(6)) ||
                    c.linkedAssetIds.image.includes(key.slice(6)),
                ),
              ),
            }
          : {}),
      },
      true,
    );
  };
  const remove = (kind: Media, id: string) => {
    change(
      kind,
      selections[kind].filter((value) => value !== id),
    );
    const linked = c.referenceInputs.filter((item) => item.assetId === id);
    for (const input of linked) c.referenceContext?.removeEdge(input.edge.id);
  };
  const missing = c.referenceInputs.filter(
    (item) => !item.assetId || item.kind === "text",
  );
  const count =
    new Set([...ids("image"), ...ids("video"), ...ids("audio")]).size +
    missing.length;
  const activeKinds = (Object.keys(selections) as Media[]).filter(
    (kind) => c.referenceLimits[kind] > 0 || ids(kind).length > 0,
  );
  const supportsSubjects = Boolean(
    c.videoCapabilities?.supports_video_subject_to_replace,
  );
  return (
    <VideoDesignReferences controller={c}>
      {({ open, details }) => (
        <section
          className="video-reference-strip"
          aria-label="参考素材"
          {...dropHandlers}
        >
          <div className="reference-strip-toolbar">
            {modeControl}
            <span>参考素材 {count}</span>
            {supportsSubjects &&
              c.referenceSubjects === null &&
              c.effectiveSubject.trim() && (
                <LegacyReferenceSubjects
                  legacy={c.effectiveSubject}
                  images={images}
                  titleFor={titleFor}
                  keyFor={c.subjectKey}
                  onSave={c.replaceReferenceSubjects}
                />
              )}
            <Menu.Root>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  className="reference-add"
                  aria-label="添加参考素材"
                >
                  <Plus size={14} />
                  添加
                  <ChevronDown size={12} />
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content className="reference-menu" sideOffset={5}>
                  {(
                    [
                      ["upload", "本地上传"],
                      ["project", "本项目素材"],
                      ["cross", "跨项目／文件库"],
                    ] as const
                  ).map(([action, label]) => (
                    <Menu.Sub key={action}>
                      <Menu.SubTrigger>
                        {label}
                        <ChevronDown size={12} />
                      </Menu.SubTrigger>
                      <Menu.Portal>
                        <Menu.SubContent
                          className="reference-menu"
                          sideOffset={5}
                        >
                          {activeKinds.map((kind) => (
                            <Menu.Item
                              key={kind}
                              disabled={
                                ids(kind).length >= c.referenceLimits[kind]
                              }
                              onSelect={() =>
                                setRequest({ id: Date.now(), kind, action })
                              }
                            >
                              {labels[kind]}
                            </Menu.Item>
                          ))}
                        </Menu.SubContent>
                      </Menu.Portal>
                    </Menu.Sub>
                  ))}
                  <Menu.Item
                    disabled={images.length >= c.referenceLimits.image}
                    onSelect={open}
                  >
                    设定卡
                  </Menu.Item>
                  {c.referenceContext && (
                    <Menu.Item onSelect={() => setTaskDialog({})}>
                      引用任务输出
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
            {expandControl}
          </div>
          <div
            className={`reference-strip-media${dropActive ? " is-reference-dragover" : ""}`}
            role="group"
            aria-label="固定参考素材"
            onDragOverCapture={dropHandlers?.onDragOver}
            onDropCapture={dropHandlers?.onDrop}
          >
            {activeKinds.map((kind) => (
              <ProjectMediaPicker
                key={kind}
                compactStrip
                minimal
                label={labels[kind]}
                kind={kind}
                projectId={c.projectId}
                value={kind === "image" ? ids(kind) : selections[kind]}
                linkedValue={c.linkedAssetIds[kind]}
                max={c.referenceLimits[kind]}
                multiple
                excludedAssetIds={c.excludedAssetIds}
                addRequest={request?.kind === kind ? request : undefined}
                onFilesLoaded={c.rememberPromptFiles}
                onInvalidSelection={c.invalidSelection}
                onChange={(next) => change(kind, next)}
                onReorder={kind === "image" ? c.reorderImages : undefined}
                renderItemTools={(file, order) => {
                  const input = c.referenceInputs.find(
                    (item) => item.assetId === file.id,
                  );
                  const value =
                    c.referenceSubjects?.[c.subjectKey(file.id)] ??
                    c.referenceSubjects?.[`asset:${file.id}`] ??
                    "";
                  return (
                    <>
                      {kind === "image" && supportsSubjects ? (
                        <ReferenceSubjectEditor
                          disabled={
                            c.referenceSubjects === null &&
                            Boolean(c.effectiveSubject.trim())
                          }
                          value={value}
                          title={titleFor(file.id)}
                          onChange={(target) =>
                            c.changeReferenceSubject(file.id, target)
                          }
                        />
                      ) : (
                        <span
                          className="reference-media-caption"
                          title={titleFor(file.id)}
                        >
                          {kind === "image" ? titleFor(file.id) : labels[kind]}
                        </span>
                      )}
                      <ReferenceAssetDetails
                        title={titleFor(file.id)}
                        input={input}
                        subject={value ? subjectLabel(value) : undefined}
                        order={kind === "image" ? order : undefined}
                        onManage={
                          input
                            ? () => setTaskDialog({ edge: input.edge })
                            : undefined
                        }
                        onRemove={() => remove(kind, file.id)}
                      >
                        {details(file.id)}
                      </ReferenceAssetDetails>
                    </>
                  );
                }}
              />
            ))}
            {missing.map((input) => (
              <button
                type="button"
                key={input.key}
                className="reference-pending"
                onClick={() => setTaskDialog({ edge: input.edge })}
                title={`${input.title} · ${input.error ?? "读取中"}`}
              >
                <strong>{input.title}</strong>
                <small>
                  {input.kind === "text" ? "文本上下文 · " : ""}
                  {input.loading
                    ? "读取中…"
                    : (input.error ?? `v${input.version}`)}
                </small>
              </button>
            ))}
            {!count && (
              <span className="reference-empty">
                添加图片、视频或音频作为参考
              </span>
            )}
            {activeKinds
              .flatMap((kind) =>
                ids(kind).filter(
                  (id) =>
                    !c.availableReferenceFiles.some((file) => file.id === id),
                ),
              )
              .map((id) => (
                <span key={id} className="reference-missing">
                  {titleFor(id)}
                  <small>素材暂不可读，保留引用</small>
                  {activeKinds
                    .filter((kind) => ids(kind).includes(id))
                    .map((kind) => (
                      <button
                        type="button"
                        key={kind}
                        onClick={() => remove(kind, id)}
                      >
                        移除
                      </button>
                    ))}
                </span>
              ))}
          </div>
          {taskDialog && c.referenceContext && c.canvasNodeId && (
            <TaskOutputReferenceDialog
              projectId={c.projectId}
              nodeId={c.canvasNodeId}
              context={c.referenceContext}
              edge={taskDialog.edge}
              onClose={() => setTaskDialog(undefined)}
            />
          )}
        </section>
      )}
    </VideoDesignReferences>
  );
}
