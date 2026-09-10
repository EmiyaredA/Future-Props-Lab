import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeft,
  ChevronDown,
  Play,
  Download,
  Save,
  Presentation,
} from "lucide-react";
import { PresentationMenu } from "./PresentationMenu";
import { PresentationToolbar } from "./PresentationToolbar";
import { PresentationStatusbar } from "./PresentationStatusbar";
import { PresentationNotes } from "./PresentationNotes";
import { usePresentationDraft } from "./usePresentationDraft";
import { download, exportProject, imageBlob } from "./api";
import { presentationKeys } from "./queryKeys";
import {
  copySlide,
  defaultRun,
  newElement,
  newId,
  newSlide,
} from "./templates";
import { alignElements, boundedElement } from "./geometry";
import { SlideCanvas } from "./SlideCanvas";
import { SelectionToolbar } from "./SelectionToolbar";
import { PresentationInspector } from "./PresentationInspector";
import { PresentationFilmstrip } from "./PresentationFilmstrip";
import { usePresentationMedia } from "./usePresentationMedia";
import { useImageCrop } from "./useImageCrop";
import { ImageCropOverlay, CropToolbar } from "./ImageCropOverlay";
import { MediaPreview } from "./MediaPreview";
import { PresentationShow } from "./PresentationShow";
import type {
  Draft,
  NavigationGuard,
  Project,
  Slide,
  SlideElement,
} from "./types";

export function PresentationEditor({
  initial,
  readOnly,
  onOpen,
  onBack,
  registerNavigationGuard,
}: {
  initial: Project;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  registerNavigationGuard?: NavigationGuard;
}) {
  const cache = useQueryClient();
  const draft = usePresentationDraft(initial, (project) => {
    cache.setQueryData(presentationKeys.project(project.id), project);
    void cache.invalidateQueries({
      queryKey: presentationKeys.all,
      refetchType: "none",
    });
  });
  const [active, setActive] = useState(initial.document.slides[0].id),
    [selected, select] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null),
    [zoom, setZoom] = useState<number | null>(null),
    [scale, setScale] = useState(0.5);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [previewId, setPreviewId] = useState<string | null>(null),
    [show, setShow] = useState<number | null>(null);
  const [panel, setPanel] = useState("slides");
  const clipboard = useRef<{ token: string; elements: SlideElement[] } | null>(
    null,
  );
  const slide =
    draft.draft.document.slides.find((s) => s.id === active) ??
    draft.draft.document.slides[0];
  const slideIndex = draft.draft.document.slides.findIndex(
    (s) => s.id === slide.id,
  );
  const report = useCallback(async (work: () => Promise<void>) => {
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }, []);
  useEffect(() => {
    registerNavigationGuard?.((proceed) => {
      if (!draft.isDirty()) return false;
      void report(async () => {
        await draft.flush();
        proceed();
      });
      return true;
    });
    return () => registerNavigationGuard?.(null);
  }, [registerNavigationGuard, draft, report]);
  const commit = (update: (d: Draft) => Draft, group?: string) => {
    if (!readOnly) draft.commit(update, group);
  };
  const changeSlide = (update: (s: Slide) => Slide, group?: string) =>
    commit(
      (d) => ({
        ...d,
        document: {
          ...d.document,
          slides: d.document.slides.map((s) =>
            s.id === slide.id
              ? ((next) => ({
                  ...next,
                  elements: next.elements.map(boundedElement),
                }))(update(s))
              : s,
          ),
        },
      }),
      group,
    );
  const patch = (values: Partial<SlideElement>) =>
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((e) =>
        selected.includes(e.id) && (!e.locked || "locked" in values)
          ? { ...e, ...values }
          : e,
      ),
    }));
  const media = usePresentationMedia({
    slideId: slide.id,
    selected,
    current: draft.current,
    commit,
    select,
    readOnly,
  });
  const crop = useImageCrop(`${slide.id}:${selected.join(",")}:${readOnly}`);
  const cropSession =
    crop.session &&
    selected.length === 1 &&
    selected[0] === crop.session.base.id &&
    slide.elements.some((e) => e.id === crop.session!.base.id && !e.locked)
      ? crop.session
      : null;
  const displayedSlide = cropSession
    ? {
        ...slide,
        elements: slide.elements.map((e) =>
          e.id === cropSession.draft.id ? cropSession.draft : e,
        ),
      }
    : slide;
  const confirmCrop = () => {
    if (cropSession) patch(cropSession.draft);
    crop.cancel();
  };
  const downloadMedia = (id: string) =>
    void report(async () => {
      const blob = await imageBlob(id);
      download(
        blob,
        `素材.${blob.type === "image/svg+xml" ? "svg" : blob.type.split("/")[1] || "png"}`,
      );
    });
  const onText = (
    id: string,
    paragraphs: SlideElement["paragraphs"],
    format = false,
  ) =>
    changeSlide(
      (s) => ({
        ...s,
        elements: s.elements.map((e) =>
          e.id === id && !e.locked ? { ...e, paragraphs } : e,
        ),
      }),
      format ? undefined : `text:${id}`,
    );
  const chooseSlide = (id: string) => {
    if (editor?.view.composing) return;
    setEditing(null);
    select([]);
    crop.cancel();
    setActive(id);
  };
  const insert = (elements: SlideElement[]) => {
    if (slide.elements.length + elements.length > 200) {
      setError("每页最多 200 个元素");
      return;
    }
    changeSlide((s) => ({ ...s, elements: [...s.elements, ...elements] }));
    select(elements.map((e) => e.id));
    setEditing(null);
  };
  const deleteSelected = () => {
    changeSlide((s) => ({
      ...s,
      elements: s.elements.filter((e) => !selected.includes(e.id) || e.locked),
    }));
    select([]);
    setEditing(null);
  };
  const duplicateSelected = () =>
    insert(
      slide.elements
        .filter((e) => selected.includes(e.id) && !e.locked)
        .map((e) => ({
          ...structuredClone(e),
          id: newId(),
          x: e.x + 24,
          y: e.y + 24,
        })),
    );
  const order = (mode: string) =>
    changeSlide((s) => {
      const isSelected = (e: SlideElement) =>
        selected.includes(e.id) && !e.locked;
      let elements = [...s.elements];
      if (mode === "front")
        elements = [
          ...elements.filter((e) => !isSelected(e)),
          ...elements.filter(isSelected),
        ];
      if (mode === "back")
        elements = [
          ...elements.filter(isSelected),
          ...elements.filter((e) => !isSelected(e)),
        ];
      if (mode === "forward")
        for (let i = elements.length - 2; i >= 0; i--) {
          if (isSelected(elements[i]) && !isSelected(elements[i + 1]))
            [elements[i], elements[i + 1]] = [elements[i + 1], elements[i]];
        }
      if (mode === "backward")
        for (let i = 1; i < elements.length; i++) {
          if (isSelected(elements[i]) && !isSelected(elements[i - 1]))
            [elements[i], elements[i - 1]] = [elements[i - 1], elements[i]];
        }
      return { ...s, elements };
    });
  const moveSlide = (id: string, index: number) =>
    commit((d) => {
      const slides = [...d.document.slides];
      const from = slides.findIndex((s) => s.id === id);
      if (from < 0) return d;
      const [item] = slides.splice(from, 1);
      slides.splice(index, 0, item);
      return { ...d, document: { ...d.document, slides } };
    });
  const addSlide = (copy?: string, layout = "blank") => {
    if (draft.draft.document.slides.length >= 100) {
      setError("文稿最多 100 页");
      return;
    }
    const next = copy
      ? copySlide(draft.draft.document.slides.find((s) => s.id === copy)!)
      : newSlide(layout);
    commit((d) => {
      const slides = [...d.document.slides];
      slides.splice(slideIndex + 1, 0, next);
      return { ...d, document: { ...d.document, slides } };
    });
    chooseSlide(next.id);
  };
  const exportNow = () =>
    report(async () => {
      if (busy) return;
      setBusy(true);
      try {
        const saved = await draft.flush();
        const blob = await exportProject(saved.id, saved.revision);
        download(blob, saved.title + ".pptx");
      } finally {
        setBusy(false);
      }
    });
  const startShow = (index: number) => {
    if (editor?.view.composing) return;
    setEditing(null);
    setShow(index);
  };
  const editableTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    !!target.closest(
      "input,textarea,[contenteditable=true],[role=dialog],[role=alertdialog],[role=menu],[role=menuitem]",
    );
  return (
    <div
      className={`presentation-editor mobile-panel-${panel}`}
      onDragOver={(event) => {
        if (!readOnly && Array.from(event.dataTransfer.types).includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (readOnly) return;
        const file = event.dataTransfer.files[0];
        if (file?.name.toLowerCase().endsWith(".svg")) {
          event.preventDefault();
          media.open("SVG", false, file);
        }
      }}
      onKeyDownCapture={(event) => {
        if (
          !readOnly &&
          !event.nativeEvent.isComposing &&
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (cropSession) return;
          void report(async () => {
            await draft.flush();
          });
        }
      }}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          readOnly ||
          event.nativeEvent.isComposing ||
          editableTarget(event.target) ||
          media.isOpen ||
          previewId ||
          cropSession ||
          show !== null
        )
          return;
        const mod = event.ctrlKey || event.metaKey,
          key = event.key.toLowerCase();
        if (mod && key === "s") {
          event.preventDefault();
          void report(async () => {
            await draft.flush();
          });
        }
        if (mod && key === "z") {
          event.preventDefault();
          if (event.shiftKey) draft.redo();
          else draft.undo();
        }
        if (mod && key === "y") {
          event.preventDefault();
          draft.redo();
        }
        if (mod && key === "a") {
          event.preventDefault();
          select(slide.elements.map((e) => e.id));
        }
        if (mod && key === "d") {
          event.preventDefault();
          duplicateSelected();
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          deleteSelected();
        }
        if (event.key === "Escape") {
          setEditing(null);
          select([]);
        }
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          ) &&
          selected.length
        ) {
          event.preventDefault();
          const amount = event.shiftKey ? 10 : 1;
          changeSlide(
            (s) => ({
              ...s,
              elements: s.elements.map((e) =>
                selected.includes(e.id) && !e.locked
                  ? {
                      ...e,
                      x:
                        e.x +
                        (event.key === "ArrowRight"
                          ? amount
                          : event.key === "ArrowLeft"
                            ? -amount
                            : 0),
                      y:
                        e.y +
                        (event.key === "ArrowDown"
                          ? amount
                          : event.key === "ArrowUp"
                            ? -amount
                            : 0),
                    }
                  : e,
              ),
            }),
            "nudge",
          );
        }
      }}
      onCopy={(event) => {
        if (editableTarget(event.target)) return;
        const elements = slide.elements.filter((e) => selected.includes(e.id));
        if (!elements.length) return;
        const token = newId();
        clipboard.current = { token, elements: structuredClone(elements) };
        event.preventDefault();
        event.clipboardData.setData("application/x-fpl-presentation", token);
        event.clipboardData.setData(
          "text/plain",
          elements
            .flatMap((e) =>
              e.paragraphs.flatMap((p) => p.runs.map((r) => r.text)),
            )
            .join("\n"),
        );
      }}
      onPaste={(event) => {
        if (readOnly || editableTarget(event.target)) return;
        if (
          clipboard.current &&
          event.clipboardData.getData("application/x-fpl-presentation") ===
            clipboard.current.token
        ) {
          event.preventDefault();
          insert(
            clipboard.current.elements.map((e) => ({
              ...structuredClone(e),
              id: newId(),
              x: e.x + 24,
              y: e.y + 24,
            })),
          );
          return;
        }
        const text = event.clipboardData.getData("text/plain");
        if (text) {
          event.preventDefault();
          insert([
            newElement("text", {
              paragraphs: [
                {
                  align: "left",
                  line_height: 1.3,
                  bullet: false,
                  runs: [defaultRun(text.slice(0, 20000))],
                },
              ],
            }),
          ]);
        }
      }}
    >
      <header className="presentation-topbar">
        <button className="icon-btn" aria-label="返回文稿列表" onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <Presentation size={22} className="presentation-mark" />
        <span className="presentation-editor-brand">
          演示工坊 <span>/</span>
        </span>
        <input
          aria-label="文稿名称"
          maxLength={120}
          value={draft.draft.title}
          readOnly={readOnly}
          onChange={(e) => {
            if (e.target.value.trim())
              commit((d) => ({ ...d, title: e.target.value }), "title");
          }}
        />
        <span
          className={`presentation-save-state ${draft.state}`}
          role="status"
        >
          {readOnly
            ? "只读"
            : {
                saved: "已保存",
                dirty: "待保存",
                saving: "正在保存…",
                error: "保存失败",
                conflict: "版本冲突",
              }[draft.state]}
        </span>
        <div className="presentation-topbar-actions">
          {!readOnly ? (
            <button
              className="btn"
              aria-label="保存文稿"
              disabled={!!cropSession}
              onClick={() =>
                void report(async () => {
                  await draft.flush();
                })
              }
            >
              <Save size={16} />
              <span>保存</span>
            </button>
          ) : null}
          <div className="presentation-split-button presentation-show-button">
            <button
              className="btn"
              aria-label="从头放映"
              disabled={!!cropSession}
              onClick={() => startShow(0)}
            >
              <Play size={16} />
              <span>放映</span>
            </button>
            <PresentationMenu
              label="放映选项"
              disabled={!!cropSession}
              actions={[
                {
                  label: "从当前页放映",
                  onSelect: () => startShow(slideIndex),
                },
              ]}
            >
              <ChevronDown size={14} />
            </PresentationMenu>
          </div>
          <button
            className="btn primary"
            disabled={busy || !!cropSession}
            onClick={() => void exportNow()}
          >
            <Download size={16} />
            <span>{busy ? "正在导出…" : "导出 PPTX"}</span>
          </button>
        </div>
      </header>
      {error || draft.error ? (
        <div className="presentation-error" role="alert">
          {error || draft.error}
          {draft.state === "error" ? (
            <button
              className="btn"
              onClick={() =>
                void report(async () => {
                  await draft.flush();
                })
              }
            >
              重试保存
            </button>
          ) : null}
        </div>
      ) : null}
      {draft.state === "conflict" ? (
        <div className="presentation-conflict">
          文稿已在其他窗口更新，本地修改仍保留。
          <button
            className="btn"
            disabled={!draft.conflict}
            onClick={() => {
              if (draft.conflict) {
                draft.adopt(draft.conflict);
                select([]);
                setEditing(null);
              }
            }}
          >
            加载服务器版本
          </button>
          <button
            className="btn"
            onClick={() =>
              void report(async () => {
                const copy = await draft.duplicate();
                draft.adopt(copy);
                onOpen(copy.id);
              })
            }
          >
            另存为副本
          </button>
        </div>
      ) : null}
      <PresentationToolbar
        readOnly={readOnly || !!cropSession}
        canAdd={draft.draft.document.slides.length < 100}
        canUndo={draft.canUndo}
        canRedo={draft.canRedo}
        busy={busy}
        hasSelection={!!selected.length}
        onAdd={(layout) => addSlide(undefined, layout)}
        onUndo={draft.undo}
        onRedo={draft.redo}
        onText={() => insert([newElement("text")])}
        onShape={(kind, values) => insert([newElement(kind, values)])}
        onIcon={media.icon}
        onSvg={() => media.open("SVG")}
        onUpload={() => media.open("上传图片")}
        onLibrary={() => media.open()}
        onCopy={duplicateSelected}
        onDelete={deleteSelected}
      />
      <div className="presentation-mobile-tabs">
        {["slides", "format", "notes"].map((id, i) => (
          <button
            key={id}
            aria-pressed={panel === id}
            onClick={() => setPanel(id)}
          >
            {["幻灯片", "文字与格式", "备注"][i]}
          </button>
        ))}
      </div>
      <div className="presentation-workspace">
        <PresentationFilmstrip
          deck={draft.draft.document}
          active={slide.id}
          onSelect={chooseSlide}
          onMove={moveSlide}
          onCopy={addSlide}
          onAdd={() => addSlide()}
          onDelete={(id) => {
            if (draft.draft.document.slides.length > 1) {
              commit((d) => ({
                ...d,
                document: {
                  ...d.document,
                  slides: d.document.slides.filter((s) => s.id !== id),
                },
              }));
              setEditing(null);
              select([]);
            }
          }}
          readOnly={readOnly}
        />
        <main className="presentation-center">
          {cropSession && (
            <CropToolbar
              onConfirm={confirmCrop}
              onCancel={crop.cancel}
              onPreset={crop.preset}
              naturalRatio={
                cropSession.natural.width / cropSession.natural.height
              }
            />
          )}
          <SlideCanvas
            slide={displayedSlide}
            cropOverlay={
              cropSession ? (
                <ImageCropOverlay
                  session={cropSession}
                  scale={scale}
                  patch={crop.patch}
                  onConfirm={confirmCrop}
                  onCancel={crop.cancel}
                />
              ) : undefined
            }
            selected={selected}
            select={select}
            editing={editing}
            setEditing={setEditing}
            replace={(s) => changeSlide(() => s)}
            onText={onText}
            readOnly={readOnly || !!cropSession}
            zoom={zoom}
            onScaleChange={setScale}
            selectionToolbar={
              <SelectionToolbar
                elements={slide.elements.filter((e) => selected.includes(e.id))}
                editor={editor}
                actions={{
                  patch,
                  media: {
                    replace: () => media.open("文件库", true),
                    crop: () => {
                      setPanel("format");
                      const e = slide.elements.find(
                        (e) => e.id === selected[0],
                      );
                      if (e) void report(() => crop.begin(e));
                    },
                    preview: () => {
                      const e = slide.elements.find(
                        (e) => e.id === selected[0],
                      );
                      if (e?.asset_id) setPreviewId(e.asset_id);
                    },
                    download: () => {
                      const e = slide.elements.find(
                        (e) => e.id === selected[0],
                      );
                      if (e?.asset_id) downloadMedia(e.asset_id);
                    },
                  },
                  duplicate: duplicateSelected,
                  remove: deleteSelected,
                  order,
                  arrange: (mode) =>
                    changeSlide((s) => ({
                      ...s,
                      elements: alignElements(s.elements, selected, mode),
                    })),
                  inspect: () => {
                    setPanel("format");
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLElement>(
                          '.presentation-inspector [role="tab"][id$="elements"]',
                        )
                        ?.click(),
                    );
                  },
                }}
                exit={() => {
                  if (editing) setEditing(null);
                  else select([]);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLElement>(".presentation-canvas")
                      ?.focus(),
                  );
                }}
              />
            }
            onReady={setEditor}
            onComposition={draft.setComposition}
            undo={draft.undo}
            redo={draft.redo}
          />
          <PresentationNotes
            notes={slide.notes}
            readOnly={readOnly}
            onChange={(notes) =>
              changeSlide((s) => ({ ...s, notes }), `notes:${slide.id}`)
            }
          />
        </main>
        <PresentationInspector
          slide={displayedSlide}
          selected={selected}
          patch={cropSession ? crop.patch : patch}
          background={(color) =>
            changeSlide((s) => ({ ...s, background: color }))
          }
          editor={editor}
          arrange={(mode) =>
            changeSlide((s) => ({
              ...s,
              elements: alignElements(s.elements, selected, mode),
            }))
          }
          order={order}
          editText={() => {
            if (selected.length === 1) setEditing(selected[0]);
          }}
          readOnly={readOnly}
        />
      </div>
      <PresentationStatusbar
        page={slideIndex + 1}
        total={draft.draft.document.slides.length}
        scale={scale}
        zoom={zoom}
        onZoom={setZoom}
      />
      {media.dialog}
      {previewId && (
        <MediaPreview
          id={previewId}
          onClose={() => setPreviewId(null)}
          onDownload={() => downloadMedia(previewId)}
        />
      )}
      {show !== null ? (
        <PresentationShow
          deck={draft.draft.document}
          start={show}
          onClose={() => setShow(null)}
        />
      ) : null}
    </div>
  );
}
