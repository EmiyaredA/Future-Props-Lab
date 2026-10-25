import "./canvas/canvas.css";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@platform/api/client";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  Eye,
  Undo2,
  Redo2,
  Type,
  Square,
  ImagePlus,
  Group,
  Ungroup,
  PanelLeftClose,
  PanelRightClose,
  Maximize,
  Minus,
  Plus,
  Cable,
} from "lucide-react";
import { ConfirmDialog } from "@shared/ui/ConfirmDialog";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { SlidePreview } from "../SlideSurface";
import { SlideCanvas } from "../SlideCanvas";
import { SelectionToolbar } from "../SelectionToolbar";
import { PresentationMenu } from "../PresentationMenu";
import { applyLayout, layoutControls } from "../layoutObjects";
import {
  groupSelection,
  selectedGroup,
  ungroup,
  cloneFragment,
  appendFragment,
  type Fragment,
} from "../scene/model";
import { orderScene, type OrderMode } from "../scene/stacking";
import { uploadImage } from "../api";
import { newElement, newId } from "../templates";
import { ConnectionPanel } from "../scene/ConnectionPanel";
import {
  newConnection,
  patchConnection,
  validConnection,
} from "../scene/connectionEditing";
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest(
    "input,textarea,[contenteditable=true],[role=menu],[role=listbox]",
  );
import type { NavigationGuard, Slide, SlideElement } from "../types";
import {
  studioDefinition,
  studioPreview,
  studioAssets,
  previewPage,
} from "./studioPreview";
import { PresentationPreviewDialog } from "../PresentationPreviewDialog";
import {
  resolveSlide,
  pageTypes,
  type Definition,
  type PageType,
  type Template,
} from "./model";
import { createTemplate, saveTemplate, getTemplate } from "./api";
import { editableDefinition, type Scope } from "./nativeScenes";
import {
  canvasScene,
  commitCanvas,
  objectScope,
  scopes,
  semanticRole,
} from "./canvas/canvasModel";
import { useTemplateHistory } from "./canvas/useTemplateHistory";
import { CanvasInspector } from "./canvas/CanvasInspector";

export function TemplateDesigner({
  initial,
  onClose,
  onSaved,
  registerNavigationGuard,
  readOnly,
  onSaveDefinition,
}: {
  initial: Template | null;
  onClose: () => void;
  onSaved: (t: Template) => void;
  registerNavigationGuard?: NavigationGuard;
  readOnly: boolean;
  onSaveDefinition?: (d: Definition) => void;
}) {
  const [saved, setSaved] = useState(initial),
    [title, setTitle] = useState(initial?.title ?? "技术汇报模板");
  const history = useTemplateHistory(
    editableDefinition(
      (initial?.definition ?? studioDefinition()) as Definition,
    ),
  );
  const definition = history.value,
    setDefinition = history.commit;
  const [baseline, setBaseline] = useState(() => JSON.stringify(definition));
  const [pageType, setPageType] = useState<PageType>("content"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [leave, setLeave] = useState<(() => void) | null>(null),
    [conflict, setConflict] = useState(false),
    [showPreview, setShowPreview] = useState(false);
  const [selected, select] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [scope, setScope] = useState<Scope>("defaults");
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const clipboard = useRef<{ fragment: Fragment; scope: Scope } | null>(null);
  const [groupScope, setGroupScope] = useState<string | null>(null),
    [zoom, setZoom] = useState<number | null>(null),
    [scale, setScale] = useState(1);
  const [transient, setTransient] = useState<Slide | null>(null),
    [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true);
  const gesture = useRef<(() => boolean) | null>(null),
    previewOpener = useRef<HTMLButtonElement>(null),
    imageInput = useRef<HTMLInputElement>(null);
  const dirty =
    (!saved && !onSaveDefinition) ||
    title !== (saved?.title ?? "技术汇报模板") ||
    JSON.stringify(definition) !== baseline;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const canvas = canvasScene(definition, pageType),
    display = transient ?? canvas;
  const chosen = display.elements.filter((e) => selected.includes(e.id));
  const selectionScopes = [...new Set(selected.map(objectScope))],
    singleScope = selectionScopes.length === 1;
  const group = selectedGroup(canvas, selected, groupScope);
  const edge = canvas.connections?.find((e) => e.id === edgeId);
  const replace = (slide: Slide) => {
    if (!readOnly && !busy) {
      try {
        setDefinition(commitCanvas(definition, pageType, slide));
        setError("");
      } catch (error) {
        setError(error instanceof Error ? error.message : "模板画布操作失败");
      }
    }
  };
  const patch = (value: Partial<SlideElement>) =>
    replace({
      ...canvas,
      elements: canvas.elements.map((e) =>
        selected.includes(e.id) ? { ...e, ...value } : e,
      ),
    });
  const remove = () => {
    if (edgeId) {
      replace({
        ...canvas,
        connections: canvas.connections?.filter((e) => e.id !== edgeId),
      });
      setEdgeId(null);
      return;
    }
    replace({
      ...canvas,
      elements: canvas.elements.flatMap((e) =>
        !selected.includes(e.id)
          ? [e]
          : semanticRole(definition, pageType, e.id)
            ? [{ ...e, hidden: true }]
            : [],
      ),
    });
    select([]);
  };
  const duplicate = () => {
    if (!singleScope) return;
    const fragment = cloneFragment(
      canvas,
      selected,
      () => `${selectionScopes[0]}:${newId()}`,
    );
    replace(appendFragment(canvas, fragment));
    select(fragment.elements.map((e) => e.id));
  };
  const add = (kind: "text" | "rect" | "image", asset_id?: string) => {
    const e = newElement(kind, {
      id: `${scope}:${newId()}`,
      name:
        kind === "text"
          ? "新增文字"
          : kind === "image"
            ? "固定图片"
            : "装饰形状",
      x: 64,
      y: 200,
      width: kind === "text" ? 380 : 180,
      height: kind === "text" ? 64 : 120,
      asset_id: asset_id ?? null,
      fill_opacity: kind === "text" ? 0 : 1,
    });
    replace({ ...canvas, elements: [...canvas.elements, e] });
    select([e.id]);
  };
  useEffect(() => {
    select([]);
    setEditing(null);
    setGroupScope(null);
    setTransient(null);
    setEdgeId(null);
  }, [pageType]);
  useEffect(() => {
    if (selected.length) setEdgeId(null);
  }, [selected]);
  useEffect(() => {
    registerNavigationGuard?.((proceed) => {
      if (!dirtyRef.current) return false;
      setLeave(() => proceed);
      return true;
    });
    return () => registerNavigationGuard?.(null);
  }, [registerNavigationGuard]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);
  const save = async () => {
    if (onSaveDefinition) {
      onSaveDefinition(definition);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = saved
        ? await saveTemplate(
            saved.id,
            title,
            definition,
            saved.revision,
            saved.description,
          )
        : await createTemplate(title, definition);
      setSaved(result);
      history.reset(result.definition as Definition);
      setBaseline(JSON.stringify(result.definition));
      dirtyRef.current = false;
      setConflict(false);
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="master-designer master-native-designer"
      data-left-open={leftOpen}
      data-right-open={rightOpen}
      onCopy={(event) => {
        if (
          readOnly ||
          editableTarget(event.target) ||
          !selected.length ||
          !singleScope
        )
          return;
        clipboard.current = {
          fragment: cloneFragment(canvas, selected, newId, 0),
          scope: selectionScopes[0],
        };
        event.preventDefault();
        event.clipboardData.setData("text/plain", "演示工坊模板对象");
      }}
      onPaste={(event) => {
        if (
          readOnly ||
          busy ||
          editableTarget(event.target) ||
          !clipboard.current
        )
          return;
        event.preventDefault();
        const { fragment, scope } = clipboard.current;
        const clone = cloneFragment(
          { ...canvas, ...fragment },
          fragment.elements.map((e) => e.id),
          () => `${scope}:${newId()}`,
        );
        replace(appendFragment(canvas, clone));
        select(clone.elements.map((e) => e.id));
      }}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          readOnly ||
          busy
        )
          return;
        const mod = event.metaKey || event.ctrlKey,
          key = event.key.toLowerCase();
        if (mod && key === "s") {
          event.preventDefault();
          void save();
          return;
        }
        if (editableTarget(event.target) || editing) return;
        if (mod && ["z", "y"].includes(key)) {
          event.preventDefault();
          if (gesture.current?.()) return;
          if (event.shiftKey || key === "y") history.redo();
          else history.undo();
          return;
        }
        if (mod && key === "a") {
          event.preventDefault();
          select(canvas.elements.filter((e) => !e.hidden).map((e) => e.id));
        }
        if (mod && key === "d") {
          event.preventDefault();
          duplicate();
        }
        if (mod && key === "g" && singleScope) {
          event.preventDefault();
          replace(
            event.shiftKey && group
              ? ungroup(canvas, group.id)
              : groupSelection(
                  canvas,
                  selected,
                  `${selectionScopes[0]}:${newId()}`,
                  groupScope,
                ),
          );
        }
        if (["Delete", "Backspace"].includes(event.key)) {
          event.preventDefault();
          remove();
        }
        if (event.key === "Escape") {
          setEditing(null);
          if (groupScope) setGroupScope(null);
          else select([]);
        }
        if (event.key.startsWith("Arrow") && selected.length) {
          event.preventDefault();
          const n = event.shiftKey ? 10 : 1;
          replace({
            ...canvas,
            elements: canvas.elements.map((e) =>
              selected.includes(e.id)
                ? {
                    ...e,
                    x:
                      e.x +
                      (event.key === "ArrowRight"
                        ? n
                        : event.key === "ArrowLeft"
                          ? -n
                          : 0),
                    y:
                      e.y +
                      (event.key === "ArrowDown"
                        ? n
                        : event.key === "ArrowUp"
                          ? -n
                          : 0),
                  }
                : e,
            ),
          });
        }
      }}
    >
      <header className="master-header">
        <button
          className="icon-btn"
          aria-label="返回模板库"
          onClick={() => (dirty ? setLeave(() => onClose) : onClose())}
        >
          <ArrowLeft size={16} />
          <span>{onSaveDefinition ? "返回文稿" : "模板与示例"}</span>
        </button>
        <div>
          <input
            aria-label="模板名称"
            maxLength={120}
            value={title}
            readOnly={readOnly || busy || !!onSaveDefinition}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <button
          className="icon-btn"
          aria-label="撤销模板修改"
          disabled={!history.canUndo || readOnly || busy}
          onClick={history.undo}
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="重做模板修改"
          disabled={!history.canRedo || readOnly || busy}
          onClick={history.redo}
        >
          <Redo2 size={16} />
        </button>
        <span className="master-save-state">
          <CheckCircle2 size={15} />
          {dirty ? "未保存" : "已保存"}
        </span>
        <button
          className="btn"
          ref={previewOpener}
          onClick={() => setShowPreview(true)}
        >
          <Eye size={16} />
          <span>预览</span>
        </button>
        {!readOnly && (
          <button
            className="btn btn-primary master-save-button"
            disabled={busy || !title.trim()}
            onClick={() => void save()}
          >
            <Save size={16} />
            <span>
              {busy
                ? "正在保存…"
                : onSaveDefinition
                  ? "应用全稿样式"
                  : "保存模板"}
            </span>
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className="master-feedback">
          {error}
          {conflict && saved && (
            <button
              className="btn"
              onClick={() =>
                void getTemplate(saved.id).then((t) => {
                  setSaved(t);
                  setTitle(t.title);
                  const d = editableDefinition(t.definition as Definition);
                  history.reset(d);
                  setBaseline(JSON.stringify(d));
                  setError("");
                  setConflict(false);
                })
              }
            >
              重新载入服务端版本（放弃本地修改）
            </button>
          )}
        </div>
      )}
      <div
        className="master-canvas-tools"
        role="toolbar"
        aria-label="模板画布工具"
      >
        <button
          aria-label="收起或展开页型栏"
          onClick={() => setLeftOpen((v) => !v)}
        >
          <PanelLeftClose size={16} />
        </button>
        <CustomSelect
          ariaLabel="新增对象影响范围"
          value={scope}
          options={scopes.map((s) => ({ value: s.value, label: s.label }))}
          onChange={(value) => setScope(value as Scope)}
        />
        <button disabled={readOnly || busy} onClick={() => add("text")}>
          <Type size={16} />
          文字
        </button>
        <button disabled={readOnly || busy} onClick={() => add("rect")}>
          <Square size={16} />
          形状
        </button>
        <button
          disabled={readOnly || busy}
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus size={16} />
          图片 / Logo
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            void uploadImage(file)
              .then((a) => add("image", a.id))
              .catch((err) => setError(String(err)))
              .finally(() => {
                setBusy(false);
                if (imageInput.current) imageInput.current.value = "";
              });
          }}
        />
        <button
          aria-label="编组"
          disabled={readOnly || busy || selected.length < 2 || !singleScope}
          onClick={() =>
            replace(
              groupSelection(
                canvas,
                selected,
                `${selectionScopes[0]}:${newId()}`,
                groupScope,
              ),
            )
          }
        >
          <Group size={16} />
        </button>
        <button
          aria-label="解组"
          disabled={readOnly || busy || !group}
          onClick={() => group && replace(ungroup(canvas, group.id))}
        >
          <Ungroup size={16} />
        </button>
        <button
          aria-label="连接所选对象"
          disabled={readOnly || busy || selected.length !== 2 || !singleScope}
          onClick={() => {
            const c = {
              ...newConnection(canvas, selected),
              id: `${selectionScopes[0]}:${newId()}`,
              layer: canvas.elements.length,
            };
            replace({
              ...canvas,
              connections: [...(canvas.connections ?? []), c],
            });
            select([]);
            setEdgeId(c.id);
          }}
        >
          <Cable size={16} />
        </button>
        <PresentationMenu
          label="对齐与分布"
          actions={layoutControls(
            canvas,
            selected,
            groupScope,
            readOnly,
            definition,
          ).commands.map((c) => ({
            label: c.label,
            disabled: !!c.reason,
            onSelect: () =>
              replace(
                applyLayout(canvas, selected, groupScope, c.mode, definition),
              ),
          }))}
        >
          对齐与分布
        </PresentationMenu>
        <span className="master-tool-spacer" />
        <button
          aria-label="收起或展开属性栏"
          onClick={() => setRightOpen((v) => !v)}
        >
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="master-designer-body">
        {leftOpen && (
          <aside className="master-page-types" aria-label="模板页型">
            {pageTypes.map((p, i) => {
              const d = studioPreview(definition, p.value);
              return (
                <button
                  key={p.value}
                  aria-label={`配置${p.label}页型`}
                  aria-pressed={pageType === p.value}
                  onClick={() => setPageType(p.value)}
                >
                  <div className="master-page-type-thumbnail">
                    <SlidePreview
                      slide={previewPage(d)}
                      size={d}
                      assetUrls={studioAssets}
                    />
                  </div>
                  <span className="master-thumbnail-label">
                    <small>{String(i + 1).padStart(2, "0")}</small>
                    {p.label}
                  </span>
                </button>
              );
            })}
          </aside>
        )}
        <main className="master-native-stage">
          <SlideCanvas
            slide={canvas}
            selected={selected}
            select={select}
            editing={editing}
            setEditing={(id) => {
              if (!id || !semanticRole(definition, pageType, id))
                setEditing(id);
            }}
            replace={replace}
            onText={(id, paragraphs) =>
              replace({
                ...canvas,
                elements: canvas.elements.map((e) =>
                  e.id === id ? { ...e, paragraphs } : e,
                ),
              })
            }
            readOnly={readOnly || busy}
            zoom={zoom}
            onZoomChange={setZoom}
            onScaleChange={setScale}
            onReady={() => {}}
            onComposition={() => {}}
            historyGesture={gesture}
            size={definition}
            assetUrls={studioAssets}
            onTransient={setTransient}
            groupScope={groupScope}
            selectedConnection={edgeId}
            onSelectConnection={(id) => {
              setEdgeId(id);
              select([]);
              setRightOpen(true);
            }}
            onGroupScopeChange={(scope, ids) => {
              setGroupScope(scope);
              select(ids);
            }}
            selectionToolbar={
              chosen.length && !readOnly ? (
                <SelectionToolbar
                  elements={chosen}
                  layout={layoutControls(
                    canvas,
                    selected,
                    groupScope,
                    false,
                    definition,
                  )}
                  editor={null}
                  exit={() => select([])}
                  actions={{
                    patch,
                    duplicate,
                    remove,
                    arrange: (mode) =>
                      replace(
                        applyLayout(
                          canvas,
                          selected,
                          groupScope,
                          mode,
                          definition,
                        ),
                      ),
                    order: (mode) =>
                      replace(orderScene(canvas, selected, mode as OrderMode)),
                    inspect: () => setRightOpen(true),
                  }}
                />
              ) : undefined
            }
          />
          <footer className="master-canvas-status">
            <span>
              {groupScope
                ? "组内编辑 · Escape 退出"
                : "拖动移动 · Shift 多选 · 方向键微调"}
            </span>
            <button
              aria-label="缩小画布"
              onClick={() => setZoom(Math.max(0.08, scale - 0.1))}
            >
              <Minus size={14} />
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              aria-label="放大画布"
              onClick={() => setZoom(Math.min(4, scale + 0.1))}
            >
              <Plus size={14} />
            </button>
            <button onClick={() => setZoom(null)}>
              <Maximize size={14} />
              适应页面
            </button>
          </footer>
        </main>
        {rightOpen && (
          <fieldset className="master-properties" disabled={readOnly || busy}>
            <legend className="sr-only">模板对象属性</legend>
            {edge ? (
              <ConnectionPanel
                slide={{
                  ...canvas,
                  elements: canvas.elements.filter(
                    (e) => objectScope(e.id) === objectScope(edge.id),
                  ),
                }}
                value={edge}
                creating={false}
                onClose={() => setEdgeId(null)}
                onCreate={() => {}}
                onRemove={remove}
                onOrder={(mode) => replace(orderScene(canvas, [edge.id], mode))}
                onChange={(value) => {
                  const next = patchConnection(edge, value);
                  if (validConnection(canvas, next))
                    replace({
                      ...canvas,
                      connections: canvas.connections?.map((e) =>
                        e.id === edge.id ? next : e,
                      ),
                    });
                }}
              />
            ) : (
              <CanvasInspector
                definition={definition}
                pageType={pageType}
                slide={display}
                selected={selected}
                onPatch={patch}
                onDefinition={setDefinition}
                select={select}
              />
            )}
          </fieldset>
        )}
      </div>
      {showPreview && (
        <PresentationPreviewDialog
          assetUrls={studioAssets}
          title="预览所有页型"
          slides={pageTypes.map((p) => {
            const d = studioPreview(definition, p.value);
            return {
              ...resolveSlide(d, previewPage(d)),
              id: `preview-${p.value}`,
            };
          })}
          size={definition}
          loading={false}
          failed={false}
          retry={() => {}}
          actionLabel="返回设计器"
          onUse={() => setShowPreview(false)}
          onClose={() => setShowPreview(false)}
          returnFocus={() => previewOpener.current?.focus()}
        />
      )}
      <ConfirmDialog
        open={!!leave}
        title="离开模板设计器？"
        description="尚未保存的模板修改将被丢弃。"
        confirmLabel="放弃修改并离开"
        onCancel={() => setLeave(null)}
        onConfirm={() => {
          const next = leave;
          setLeave(null);
          next?.();
        }}
      />
    </div>
  );
}
