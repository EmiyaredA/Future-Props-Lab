import { applyPageStyle } from "./pageStyle";
import { applyFormat } from "./formatBrush";
import { removePages, duplicatePages, movePages } from "./pageOperations";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { editorCommands } from "./commands";
import type { ExportFormat } from "../exchange/ExportDialog";
import { usePresentationDraft } from "../usePresentationDraft";
import { usePresentationHistory } from "../usePresentationHistory";
import { download, exportProject, imageBlob } from "../api";
import { presentationKeys } from "../queryKeys";
import { copySlide, newSlide, newId } from "../templates";
import { boundedElement } from "../geometry";
import {
  applyLayout,
  layoutControls,
  type LayoutCommand,
} from "../layoutObjects";
import { orderScene, type OrderMode } from "../scene/stacking";
import {
  appendFragment,
  cloneFragment,
  updateScene,
  type Fragment,
} from "../scene/model";
import { useSceneTools } from "../scene/SceneTools";
import { usePresentationMedia } from "../usePresentationMedia";
import { useImageCrop } from "../useImageCrop";
import type {
  Draft,
  NavigationGuard,
  Project,
  Slide,
  SlideElement,
} from "../types";

export type EditorProps = {
  initial: Project;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  registerNavigationGuard?: NavigationGuard;
};

export function usePresentationSession({
  initial,
  readOnly,
  registerNavigationGuard,
}: EditorProps) {
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
  const [themeSlide, setThemeSlide] = useState<string | null>(null);
  const [codeSlide, setCodeSlide] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat | null>(null);
  const [themeSource, setThemeSource] = useState<Slide | null>(null);
  const [layoutSource, setLayoutSource] = useState<Slide | null>(null);
  const [brush, setBrush] = useState<SlideElement | null>(null);
  const [richNotes, setRichNotes] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [boxSelect, setBoxSelect] = useState(false);
  const [drawMode, setDrawMode] = useState<"pen" | "polygon" | null>(null);
  const [grid, setGrid] = useState(false),
    [rulers, setRulers] = useState(false);
  const [panel, setPanel] = useState("slides");
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const clipboard = useRef<{ token: string; fragment: Fragment } | null>(null);
  const slide =
    draft.draft.document.slides.find((s) => s.id === active) ??
    draft.draft.document.slides[0];
  const slideIndex = draft.draft.document.slides.findIndex(
    (s) => s.id === slide.id,
  );
  const selectedElement = slide.elements.find(
    (element) => element.id === selected[0],
  );
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("future-props:amadeus-context", {
        detail: {
          application: "演示工坊",
          projectId: initial.id,
          title: draft.draft.title,
          selection: selectedElement
            ? {
                id: selectedElement.id,
                name: selectedElement.kind,
                value: `第 ${slideIndex + 1} 页 · ${selectedElement.kind}`,
              }
            : {
                id: slide.id,
                name: `第 ${slideIndex + 1} 页`,
                value: "幻灯片",
              },
          unsaved: draft.state !== "saved",
        },
      }),
    );
  }, [
    initial.id,
    draft.draft.title,
    draft.state,
    slide.id,
    slideIndex,
    selectedElement,
  ]);
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
    if (!readOnly)
      draft.commit(update, group ?? history.group(), {
        slideId: slide.id,
        slideIndex,
        selected,
      });
  };
  const changeSlide = (update: (s: Slide) => Slide, group?: string) => {
    try {
      commit(
        (d) => ({
          ...d,
          document: {
            ...d.document,
            slides: d.document.slides.map((s) =>
              s.id === slide.id
                ? ((next) => ({
                    ...updateScene(s, next),
                    elements: next.elements.map(boundedElement),
                  }))(update(s))
                : s,
            ),
          },
        }),
        group,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法调整页面");
    }
  };
  const patch = (values: Partial<SlideElement>) =>
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((e) =>
        selected.includes(e.id) && (!e.locked || "locked" in values)
          ? { ...e, ...values }
          : e,
      ),
    }));
  const patchElement = (id: string, values: Partial<SlideElement>) =>
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((e) =>
        e.id === id &&
        (!e.locked || (Object.keys(values).length === 1 && "locked" in values))
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
  const scene = useSceneTools({
    slide,
    size: draft.draft.document,
    selected,
    select: (ids) => {
      setEditing(null);
      select(ids);
    },
    change: changeSlide,
    onComposition: draft.setComposition,
    restoreVersion: draft.restoreVersion,
    readOnly: readOnly || !!crop.session,
  });
  const cropSession =
    crop.session &&
    selected.length === 1 &&
    selected[0] === crop.session.base.id &&
    slide.elements.some((e) => e.id === crop.session!.base.id && !e.locked)
      ? crop.session
      : null;
  useEffect(() => {
    if (readOnly || cropSession || drawMode) setBoxSelect(false);
  }, [readOnly, cropSession, drawMode]);
  const history = usePresentationHistory({
    draft,
    scopeKey: `${slide.id}:${selected.join(",")}:${editing ?? ""}`,
    blocked:
      readOnly || !!cropSession || show !== null || media.isOpen || !!previewId,
    onRestore: (location) => {
      setTitleDraft(null);
      setActive(location.slideId);
      select(location.selected);
      const restored = draft
        .current()
        .document.slides.find((s) => s.id === location.slideId);
      setEditing((id) =>
        id && restored?.elements.some((e) => e.id === id && !e.locked)
          ? id
          : null,
      );
    },
  });
  const displayedSlide = cropSession
    ? {
        ...slide,
        elements: slide.elements.map((e) =>
          e.id === cropSession.draft.id ? cropSession.draft : e,
        ),
      }
    : slide;
  const layout = layoutControls(
    slide,
    selected,
    scene.scope,
    readOnly || !!cropSession,
    draft.draft.document,
  );
  const arrange = (mode: LayoutCommand) => {
    if (!layout.commands.find((c) => c.mode === mode)?.reason)
      changeSlide((s) =>
        applyLayout(s, selected, scene.scope, mode, draft.draft.document),
      );
  };
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
    height?: number,
  ) =>
    changeSlide(
      (s) => ({
        ...s,
        elements: s.elements.map((e) =>
          e.id === id && !e.locked
            ? { ...e, paragraphs, ...(height !== undefined ? { height } : {}) }
            : e,
        ),
      }),
      format ? undefined : `text:${id}`,
    );
  const chooseSlide = (id: string) => {
    if (editor?.view.composing) return;
    draft.endGroup();
    setDrawMode(null);
    setBoxSelect(false);
    setEditing(null);
    select([]);
    crop.cancel();
    setThemeSlide(null);
    setCodeSlide(null);
    setActive(id);
  };
  const insert = (elements: SlideElement[]) => {
    setBoxSelect(false);
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
  const insertFragment = (fragment: Fragment) => {
    setBoxSelect(false);
    try {
      changeSlide((s) => appendFragment(s, fragment));
      select(fragment.elements.map((e) => e.id));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法插入片段");
    }
  };
  const duplicateSelected = () =>
    insertFragment(
      cloneFragment(
        slide,
        selected.filter(
          (id) => !slide.elements.find((e) => e.id === id)?.locked,
        ),
        newId,
      ),
    );
  const order = (mode: string) =>
    changeSlide((s) =>
      orderScene(
        s,
        selected.filter((id) => !s.elements.find((e) => e.id === id)?.locked),
        mode as OrderMode,
      ),
    );
  const moveSlide = (id: string, index: number) => {
    if (readOnly) return;
    draft.commit(
      (d) => {
        const slides = [...d.document.slides];
        const from = slides.findIndex((s) => s.id === id);
        if (from < 0) return d;
        const [item] = slides.splice(from, 1);
        slides.splice(index, 0, item);
        return { ...d, document: { ...d.document, slides } };
      },
      "",
      { slideId: id, slideIndex: index, selected: [] },
    );
  };
  const addSlide = (copy?: string, layout = "blank") => {
    if (draft.draft.document.slides.length >= 100) {
      setError("文稿最多 100 页");
      return;
    }
    const next = copy
      ? copySlide(draft.draft.document.slides.find((s) => s.id === copy)!)
      : applyPageStyle(newSlide(layout), themeSource);
    commit((d) => {
      const slides = [...d.document.slides];
      slides.splice(slideIndex + 1, 0, next);
      return { ...d, document: { ...d.document, slides } };
    });
    chooseSlide(next.id);
  };
  const pageOperation = (
    operation: (deck: Project["document"]) => Project["document"],
  ) => {
    try {
      commit((d) => ({ ...d, document: operation(d.document) }));
      if (!draft.current().document.slides.some((s) => s.id === slide.id))
        chooseSlide(draft.current().document.slides[0].id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法修改页面");
    }
  };
  const deletePages = (ids: string[]) =>
    pageOperation((deck) => removePages(deck, ids));
  const copyPages = (ids: string[]) =>
    pageOperation((deck) => duplicatePages(deck, ids));
  const reorderPages = (ids: string[], index: number) =>
    pageOperation((deck) => movePages(deck, ids, index));
  const exportNow = () =>
    report(async () => {
      if (busy) return;
      setBusy(true);
      try {
        const saved = await draft.flush();
        if (
          saved.document.slides.some(
            (s) =>
              s.animations?.length ||
              s.transition ||
              s.annotations?.length ||
              s.elements.some(
                (e) =>
                  !e.hidden &&
                  (e.image_effects ||
                    (["table", "chart"].includes(e.kind) && e.opacity !== 1) ||
                    (e.chart?.type === "area" && e.chart.smooth)),
              ),
          )
        ) {
          setExportFormat("pptx");
          return;
        }
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
  const nudge = (dx: number, dy: number) =>
    changeSlide(
      (s) => ({
        ...s,
        elements: s.elements.map((e) =>
          selected.includes(e.id) && !e.locked
            ? { ...e, x: e.x + dx, y: e.y + dy }
            : e,
        ),
      }),
      "nudge",
    );
  const formatActions = [
    {
      label: layoutSource ? "更新提取的页面版式" : "提取当前页版式",
      onSelect: () => setLayoutSource(structuredClone(slide)),
    },
    {
      label: "插入提取的版式",
      disabled: !layoutSource || draft.draft.document.slides.length >= 100,
      onSelect: () => {
        if (!layoutSource) return;
        const next = copySlide(layoutSource);
        commit((d) => ({
          ...d,
          document: {
            ...d.document,
            slides: [
              ...d.document.slides.slice(0, slideIndex + 1),
              next,
              ...d.document.slides.slice(slideIndex + 1),
            ],
          },
        }));
        chooseSlide(next.id);
      },
    },
    {
      label: themeSource ? "更新提取的页面风格" : "提取当前页风格",
      onSelect: () => setThemeSource(structuredClone(slide)),
    },
    {
      label: "清除提取风格",
      disabled: !themeSource,
      onSelect: () => setThemeSource(null),
    },
    {
      label: "复制所选样式",
      disabled: selected.length !== 1,
      onSelect: () => {
        const e = slide.elements.find((e) => e.id === selected[0]);
        if (e) setBrush(structuredClone(e));
      },
    },
    {
      label: "应用格式刷",
      disabled: !brush || !selected.length,
      onSelect: () => {
        if (brush)
          changeSlide((s) => ({
            ...s,
            elements: s.elements.map((e) =>
              selected.includes(e.id) ? applyFormat(brush, e) : e,
            ),
          }));
      },
    },
  ];
  const commands = editorCommands({
    readOnly,
    blocked: !!cropSession || show !== null || media.isOpen || !!previewId,
    selected: selected.length,
    movable: slide.elements.filter((e) => selected.includes(e.id) && !e.locked)
      .length,
    canUndo: draft.canUndo,
    canRedo: draft.canRedo,
    handlers: {
      save: () =>
        void report(async () => {
          await draft.flush();
        }),
      undo: history.undo,
      redo: history.redo,
      duplicate: duplicateSelected,
      remove: deleteSelected,
      selectAll: () =>
        select(slide.elements.filter((e) => !e.hidden).map((e) => e.id)),
      lock: () => patch({ locked: true }),
      unlock: () => patch({ locked: false }),
      front: () => order("front"),
      forward: () => order("forward"),
      backward: () => order("backward"),
      back: () => order("back"),
      left: (a = 1) => nudge(-a, 0),
      right: (a = 1) => nudge(a, 0),
      up: (a = 1) => nudge(0, -a),
      down: (a = 1) => nudge(0, a),
    },
  });
  return {
    deletePages,
    copyPages,
    reorderPages,
    formatActions,
    commands,
    richNotes,
    setRichNotes,
    searchOpen,
    setSearchOpen,
    drawMode,
    setDrawMode,
    boxSelect,
    setBoxSelect,
    exportFormat,
    setExportFormat,
    grid,
    setGrid,
    rulers,
    setRulers,
    patchElement,
    draft,
    active,
    setActive,
    selected,
    select,
    editing,
    setEditing,
    editor,
    setEditor,
    zoom,
    setZoom,
    scale,
    setScale,
    error,
    setError,
    busy,
    previewId,
    setPreviewId,
    show,
    setShow,
    themeSlide,
    setThemeSlide,
    codeSlide,
    setCodeSlide,
    panel,
    setPanel,
    titleDraft,
    setTitleDraft,
    clipboard,
    slide,
    slideIndex,
    report,
    commit,
    changeSlide,
    patch,
    media,
    crop,
    scene,
    cropSession,
    history,
    displayedSlide,
    layout,
    arrange,
    confirmCrop,
    downloadMedia,
    onText,
    chooseSlide,
    insert,
    deleteSelected,
    insertFragment,
    duplicateSelected,
    order,
    moveSlide,
    addSlide,
    exportNow,
    startShow,
  };
}
export type PresentationSession = ReturnType<typeof usePresentationSession>;
