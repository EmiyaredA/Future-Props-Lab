import { RichNotesDialog } from "./editor/RichNotesDialog";
import { AnnotationsPanel } from "./editor/AnnotationsPanel";
import { SearchDialog } from "./editor/SearchDialog";
import { AppearancePanel } from "./objects/AppearancePanel";
import { PaintEditor } from "./objects/PaintEditor";
import { AnimationPanel } from "./playback/AnimationPanel";
import { PageDesignControls } from "./editor/PageDesignControls";
import { useObjectEditor } from "./objects/useObjectEditor";
import { useEditorBindings } from "./editor/useEditorBindings";
import { EditorHeader } from "./editor/EditorHeader";
import "./editor/editor.css";
import { SelectionPanel } from "./editor/SelectionPanel";
import { orderScene } from "./scene/stacking";
import { EditorFeedback } from "./editor/EditorFeedback";
import { EditorCanvas } from "./editor/EditorCanvas";
import { lazy, Suspense } from "react";
import { PresentationToolbar } from "./PresentationToolbar";
import { PresentationStatusbar } from "./PresentationStatusbar";
import { PresentationNotes } from "./PresentationNotes";
import { newElement } from "./templates";
import { PresentationInspector } from "./PresentationInspector";
import { PresentationFilmstrip } from "./PresentationFilmstrip";
import { MediaPreview } from "./MediaPreview";
import { SlideThemeDialog } from "./SlideThemeDialog";
import { SlideImageVersion } from "./SlideImageVersion";
import { PresentationShow } from "./PresentationShow";
import {
  usePresentationSession,
  type EditorProps,
} from "./editor/usePresentationSession";

const CodeHighlightDialog = lazy(() => import("./CodeHighlightDialog"));
const ExportDialog = lazy(() => import("./exchange/ExportDialog"));

export function PresentationEditor(props: EditorProps) {
  const { readOnly, onOpen, onBack } = props;
  const session = usePresentationSession(props);
  const bindings = useEditorBindings(session, readOnly);
  const objects = useObjectEditor({
    slideId: session.slide.id,
    readOnly: readOnly || !!session.cropSession,
    current: session.draft.current,
    commit: session.commit,
    select: session.select,
  });
  const {
    draft,
    commands,
    selected,
    select,
    setEditing,
    editor,
    zoom,
    setZoom,
    scale,
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
    slide,
    slideIndex,
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
    downloadMedia,
    chooseSlide,
    insert,
    insertFragment,
    order,
    moveSlide,
    addSlide,
  } = session;
  return (
    <div
      ref={history.root}
      {...bindings}
      className={`presentation-editor mobile-panel-${panel}`}
      onDragOver={(event) => {
        if (!readOnly && Array.from(event.dataTransfer.types).includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (readOnly) return;
        const file = event.dataTransfer.files[0];
        if (
          file &&
          (file.type.startsWith("image/") ||
            file.name.toLowerCase().endsWith(".svg"))
        ) {
          event.preventDefault();
          media.open(
            file.name.toLowerCase().endsWith(".svg") ? "SVG" : "上传图片",
            false,
            file,
          );
        }
      }}
    >
      <EditorHeader session={session} readOnly={readOnly} onBack={onBack} />
      <EditorFeedback session={session} onOpen={onOpen} />
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
          onDelete={(id) => session.deletePages([id])}
          onBatchDelete={session.deletePages}
          onBatchCopy={session.copyPages}
          onBatchMove={session.reorderPages}
          readOnly={readOnly}
        />
        <main className="presentation-center">
          <PresentationToolbar
            readOnly={readOnly || !!cropSession}
            canAdd={draft.draft.document.slides.length < 100}
            canUndo={!commands.get("undo").disabled}
            canRedo={!commands.get("redo").disabled}
            busy={busy}
            hasSelection={!!selected.length}
            onAdd={(layout) => addSlide(undefined, layout)}
            onUndo={commands.get("undo").onSelect}
            onRedo={commands.get("redo").onSelect}
            boxSelect={session.boxSelect && !session.drawMode}
            onBoxSelect={() => {
              setEditing(null);
              session.setDrawMode(null);
              scene.closeConnection();
              session.setBoxSelect(!session.boxSelect);
              session.history.root.current
                ?.querySelector<HTMLElement>(".presentation-canvas")
                ?.focus({ preventScroll: true });
            }}
            onText={() => insert([newElement("text")])}
            onCode={() => {
              setEditing(null);
              setCodeSlide(slide.id);
            }}
            onShape={(kind, values) => insert([newElement(kind, values)])}
            onFormula={() => {
              setEditing(null);
              objects.insertFormula();
            }}
            onIcon={media.icon}
            onSvg={() => media.open("SVG")}
            onUpload={() => media.open("上传图片")}
            onLibrary={() => media.open()}
            onCopy={commands.get("duplicate").onSelect}
            onDelete={commands.get("remove").onSelect}
            infoAction={scene.infoAction}
            sceneActions={[
              ...objects.actions,
              ...session.formatActions,
              {
                label: "自由绘制",
                onSelect: () => {
                  setEditing(null);
                  session.setBoxSelect(false);
                  session.setDrawMode("pen");
                },
              },
              {
                label: "绘制多边形",
                onSelect: () => {
                  setEditing(null);
                  session.setBoxSelect(false);
                  session.setDrawMode("polygon");
                },
              },
              ...scene.actions,
            ]}
          />

          <EditorCanvas
            session={session}
            readOnly={readOnly}
            onFormulaEdit={objects.edit}
          />
          {scene.checks}
          <PresentationNotes
            rich={!!slide.notes_rich}
            onRichEdit={() => session.setRichNotes(true)}
            notes={slide.notes}
            readOnly={readOnly}
            onChange={(notes) =>
              changeSlide(
                (s) => ({ ...s, notes, notes_rich: null }),
                `notes:${slide.id}`,
              )
            }
          />
        </main>
        <PresentationInspector
          connectionPanel={scene.connectionPanel}
          connectionId={scene.edgeId}
          connectionSelectionVersion={scene.connectionSelectionVersion}
          annotationsPanel={
            <AnnotationsPanel
              key={slide.id}
              slide={slide}
              selected={selected}
              readOnly={readOnly || !!cropSession}
              change={(next) => changeSlide(() => next)}
            />
          }
          appearancePanel={
            selected.length === 1 &&
            displayedSlide.elements.some((e) => e.id === selected[0]) && (
              <AppearancePanel
                slides={draft.draft.document.slides}
                element={displayedSlide.elements.find(
                  (e) => e.id === selected[0],
                )!}
                patch={patch}
                disabled={
                  readOnly ||
                  !!cropSession ||
                  !!slide.elements.find((e) => e.id === selected[0])?.locked
                }
                editor={editor}
                onBackground={() => {
                  const asset_id = slide.elements.find(
                    (e) => e.id === selected[0],
                  )?.asset_id;
                  if (asset_id)
                    changeSlide((s) => ({
                      ...s,
                      background_style: {
                        type: "image",
                        asset_id,
                        color: s.background,
                        end_color: "#5474E5",
                        angle: 90,
                        fit: "cover",
                      },
                    }));
                }}
              />
            )
          }
          animationPanel={
            <AnimationPanel
              slide={slide}
              selected={selected}
              readOnly={readOnly || !!cropSession}
              change={(next) => changeSlide(() => next)}
            />
          }
          onObjectEdit={objects.edit}
          pageControls={
            <>
              <label className="presentation-field presentation-page-section">
                <span>页面分节</span>
                <input
                  aria-label="页面分节"
                  value={slide.section ?? ""}
                  maxLength={120}
                  disabled={readOnly || !!cropSession}
                  onChange={(event) =>
                    changeSlide((s) => ({ ...s, section: event.target.value }))
                  }
                />
              </label>
              <PaintEditor
                label="页面背景填充"
                value={slide.background_style}
                disabled={readOnly || !!cropSession}
                change={(background_style) =>
                  changeSlide((s) => ({ ...s, background_style }))
                }
              />
              <PageDesignControls
                size={draft.draft.document}
                readOnly={readOnly || !!cropSession}
                change={(size) =>
                  session.commit((d) => ({
                    ...d,
                    document: { ...d.document, ...size },
                  }))
                }
                grid={session.grid}
                rulers={session.rulers}
                onGrid={() => session.setGrid(!session.grid)}
                onRulers={() => session.setRulers(!session.rulers)}
              />
            </>
          }
          selectionPanel={
            <SelectionPanel
              slide={slide}
              selected={selected}
              readOnly={readOnly || !!cropSession}
              select={(ids) => {
                setEditing(null);
                select(ids);
              }}
              patch={session.patchElement}
              order={(id, mode) =>
                changeSlide((s) => orderScene(s, [id], mode))
              }
              selectConnection={scene.onSelectEdge}
            />
          }
          slide={displayedSlide}
          onStyle={() => {
            if (editor?.view.composing) return;
            editor?.commands.blur();
            setEditing(null);
            setThemeSlide(slide.id);
          }}
          styleDisabled={!!cropSession}
          imageVersionPanel={
            <SlideImageVersion
              key={slide.id}
              slide={slide}
              readOnly={readOnly}
              onChange={(image_asset_id) =>
                changeSlide((s) => ({ ...s, image_asset_id }))
              }
            />
          }
          selected={selected}
          patch={cropSession ? crop.patch : patch}
          background={(color) =>
            changeSlide((s) => ({
              ...s,
              background: color,
              background_style: null,
            }))
          }
          editor={editor}
          arrange={arrange}
          layout={layout}
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
      {themeSlide === slide.id && !readOnly && !cropSession && (
        <SlideThemeDialog
          size={draft.draft.document}
          key={slide.id}
          slide={slide}
          onClose={() => setThemeSlide(null)}
          onApply={(next) => {
            setEditing(null);
            changeSlide(() => next);
          }}
        />
      )}
      {codeSlide === slide.id && !readOnly && !cropSession && (
        <Suspense fallback={<p role="status">正在加载代码块…</p>}>
          <CodeHighlightDialog
            key={slide.id}
            onClose={() => setCodeSlide(null)}
            onInsert={insertFragment}
          />
        </Suspense>
      )}
      {session.searchOpen && (
        <SearchDialog
          deck={draft.draft.document}
          readOnly={readOnly}
          onClose={() => session.setSearchOpen(false)}
          onChoose={(id, element) => {
            chooseSlide(id);
            if (element) select([element]);
          }}
          onReplace={(document) => session.commit((d) => ({ ...d, document }))}
        />
      )}
      {session.richNotes && !readOnly && (
        <RichNotesDialog
          key={slide.id}
          notes={slide.notes}
          paragraphs={slide.notes_rich}
          onClose={() => session.setRichNotes(false)}
          onApply={(notes_rich) =>
            changeSlide((s) => ({
              ...s,
              notes_rich,
              notes: notes_rich
                .map((p) => p.runs.map((r) => r.text).join(""))
                .join("\n"),
            }))
          }
        />
      )}
      {media.dialog}
      {objects.dialog}
      {session.exportFormat && (
        <Suspense fallback={<p role="status">正在加载导出工具…</p>}>
          <ExportDialog
            format={session.exportFormat}
            current={slideIndex}
            getSnapshot={draft.flush}
            onClose={() => session.setExportFormat(null)}
          />
        </Suspense>
      )}
      {scene.dialogs}
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
          projectId={props.initial.id}
          onClose={() => setShow(null)}
        />
      ) : null}
    </div>
  );
}
