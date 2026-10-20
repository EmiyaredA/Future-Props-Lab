import { useState } from "react";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { selectionAtHit } from "../scene/selection";
import { SlideCanvas } from "../SlideCanvas";
import { SelectionToolbar } from "../SelectionToolbar";
import { ImageCropOverlay, CropToolbar } from "../ImageCropOverlay";
import type { PresentationSession } from "./usePresentationSession";
export function EditorCanvas({
  session,
  readOnly,
}: {
  session: PresentationSession;
  readOnly: boolean;
}) {
  const {
    commands,
    cropSession,
    confirmCrop,
    crop,
    scene,
    displayedSlide,
    selected,
    select,
    editing,
    setEditing,
    changeSlide,
    onText,
    zoom,
    setZoom,
    setScale,
    scale,
    layout,
    slide,
    editor,
    patch,
    media,
    setPanel,
    report,
    setPreviewId,
    downloadMedia,
    order,
    arrange,
    setEditor,
    draft,
    history,
  } = session;
  const [context, setContext] = useState<{ x: number; y: number } | null>(null);
  const closeContext = () => setContext(null);
  const focusCanvas = () =>
    session.history.root.current
      ?.querySelector<HTMLElement>(".presentation-canvas")
      ?.focus();
  return (
    <>
      {" "}
      {cropSession && (
        <CropToolbar
          onConfirm={confirmCrop}
          onCancel={crop.cancel}
          onPreset={crop.preset}
          naturalRatio={cropSession.natural.width / cropSession.natural.height}
        />
      )}
      {scene.scopeIndicator}
      <div className="presentation-reconstruction">
        {scene.referenceSide}
        <div
          className="presentation-connection-host"
          data-popover-boundary
          onContextMenu={(event) => {
            if ((event.target as Element).closest(".presentation-text-editor"))
              return;
            event.preventDefault();
            const id =
              (event.target as Element).closest<HTMLElement>(
                "[data-element-id]",
              )?.dataset.elementId ?? null;
            if (id && !selected.includes(id)) {
              const hit = selectionAtHit(
                slide,
                selected,
                id,
                scene.scope,
                false,
              );
              scene.selectInScope(hit.scope, hit.ids);
            } else if (
              !id &&
              !(event.target as Element).closest("[data-connection-id]")
            )
              select([]);
            const box = event.currentTarget.getBoundingClientRect();
            setContext({
              x: event.clientX || box.left + box.width / 2,
              y: event.clientY || box.top + box.height / 2,
            });
          }}
          onKeyDown={(event) => {
            if (event.key === "F10" && event.shiftKey && !editing) {
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              setContext({
                x: box.left + box.width / 2,
                y: box.top + box.height / 2,
              });
            }
          }}
        >
          {context && (
            <CanvasContextMenu
              point={context}
              onClose={closeContext}
              restoreFocus={focusCanvas}
              actions={[
                commands.get("duplicate"),
                commands.get("remove"),
                commands.get("lock"),
                commands.get("unlock"),
                commands.get("front"),
                commands.get("back"),
                ...scene.actions,
                commands.get("selectAll"),
              ]}
            />
          )}

          <SlideCanvas
            size={draft.draft.document}
            drawMode={session.drawMode}
            onDrawCancel={() => session.setDrawMode(null)}
            onDrawFinish={(element) => {
              session.insert([element]);
              session.setDrawMode(null);
            }}
            grid={session.grid}
            rulers={session.rulers}
            onCanvasInteract={scene.closeConnection}
            previewConnection={scene.previewConnection ?? undefined}
            groupScope={scene.scope}
            onGroupScopeChange={scene.selectInScope}
            selectedConnection={scene.edgeId}
            onSelectConnection={scene.onSelectEdge}
            referenceOverlay={scene.referenceOverlay}
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
            onZoomChange={setZoom}
            onScaleChange={setScale}
            selectionToolbar={
              <SelectionToolbar
                layout={layout}
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
                  duplicate: commands.get("duplicate").onSelect,
                  remove: commands.get("remove").onSelect,
                  order,
                  arrange,
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
                  else if (scene.scope) scene.exitGroup();
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
            historyGesture={history.cancelGesture}
          />
          {scene.connectionPanel}
        </div>
      </div>
    </>
  );
}
