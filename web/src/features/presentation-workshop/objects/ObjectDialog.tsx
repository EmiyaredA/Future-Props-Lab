import { LoadingState } from "@shared/ui/LoadingState";
import { keepDialogEscapeLocal, useDialogReturnFocus } from "../dialogKeyboard";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import type { SlideElement } from "../types";
import { TableEditor } from "./TableEditor";
import { ChartEditor } from "./ChartEditor";
import { NativeTable } from "./NativeTable";
import { MediaChooser } from "./MediaChooser";
import { newObject, objectLabels, type ObjectKind } from "./objectDefaults";
import "./objects.css";

const ChartPreview = lazy(() => import("./ChartPreview"));

export default function ObjectDialog({
  kind,
  initial,
  onApply,
  onClose,
}: {
  kind: ObjectKind;
  initial?: SlideElement;
  onApply: (element: SlideElement) => void;
  onClose: () => void;
}) {
  const returnFocus = useDialogReturnFocus();
  const [element, setElement] = useState(() =>
    structuredClone(initial ?? newObject(kind)),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);
  const close = () => {
    cancelled.current = true;
    onClose();
  };
  const patch = (values: Partial<SlideElement>) =>
    setElement((current) => ({ ...current, ...values }));
  const apply = async () => {
    setError("");
    setBusy(true);
    try {
      const result = element;
      if (
        kind === "chart" &&
        element.chart?.type === "scatter" &&
        element.chart.categories.some(
          (v) => !v.trim() || !Number.isFinite(Number(v)),
        )
      )
        throw new Error("散点图的 X 坐标必须为有效数字");
      if ((kind === "audio" || kind === "video") && !result.asset_id)
        throw new Error("请先选择或上传媒体文件");
      if (!cancelled.current) {
        onApply(result);
        onClose();
      }
    } catch (e) {
      if (!cancelled.current)
        setError(e instanceof Error ? e.message : "无法应用内容");
    } finally {
      if (!cancelled.current) setBusy(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="presentation-modal-backdrop" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={keepDialogEscapeLocal}
          className={`presentation-dialog presentation-dialog-floating presentation-object-dialog${kind === "chart" || kind === "table" ? " presentation-dialog-large" : ""}`}
          data-presentation-history="local"
        >
          <header>
            <Dialog.Title>
              {initial ? "编辑" : "插入"}
              {objectLabels[kind]}
            </Dialog.Title>
            <Dialog.Close
              className="btn"
              aria-label="关闭内容编辑"
              onClick={close}
            >
              关闭
            </Dialog.Close>
          </header>
          <Dialog.Description>
            预览并调整内容，点击应用后作为一次编辑保存。
          </Dialog.Description>
          <div className="presentation-dialog-body">
            <fieldset disabled={busy}>
              {element.table && (
                <div className="presentation-dialog-split">
                  <div className="presentation-object-preview">
                    <NativeTable element={element} />
                  </div>
                  <div className="presentation-object-settings">
                    <TableEditor
                      data={element.table}
                      change={(table) => patch({ table })}
                    />
                  </div>
                </div>
              )}
              {element.chart && (
                <div className="presentation-dialog-split">
                  <div className="presentation-object-preview presentation-chart-preview">
                    <Suspense
                      fallback={
                        <LoadingState label="正在绘制图表…" variant="region" />
                      }
                    >
                      <ChartPreview element={element} />
                    </Suspense>
                  </div>
                  <div className="presentation-object-settings">
                    <ChartEditor
                      data={element.chart}
                      change={(chart) => patch({ chart })}
                    />
                  </div>
                </div>
              )}
              {element.media && (
                <>
                  <MediaChooser
                    kind={kind as "audio" | "video"}
                    label={objectLabels[kind]}
                    value={element.asset_id}
                    change={(asset_id) => patch({ asset_id })}
                  />
                  {kind === "video" && (
                    <MediaChooser
                      kind="image"
                      label="视频封面"
                      value={element.media.poster_asset_id ?? null}
                      change={(poster_asset_id) =>
                        patch({ media: { ...element.media!, poster_asset_id } })
                      }
                    />
                  )}
                  <div className="presentation-object-actions">
                    <button
                      className="btn"
                      aria-pressed={element.media.autoplay}
                      onClick={() =>
                        patch({
                          media: {
                            ...element.media!,
                            autoplay: !element.media!.autoplay,
                          },
                        })
                      }
                    >
                      自动播放
                    </button>
                    <button
                      className="btn"
                      aria-pressed={element.media.loop}
                      onClick={() =>
                        patch({
                          media: {
                            ...element.media!,
                            loop: !element.media!.loop,
                          },
                        })
                      }
                    >
                      循环播放
                    </button>
                    {kind === "audio" && (
                      <CustomColorPicker
                        ariaLabel="音频图标颜色"
                        value={element.media.icon_color}
                        onChange={(icon_color) =>
                          patch({ media: { ...element.media!, icon_color } })
                        }
                      />
                    )}
                  </div>
                  <p className="muted">
                    浏览器限制自动播放时，可在放映中点击播放。
                  </p>
                </>
              )}
            </fieldset>
            {error && <p role="alert">{error}</p>}
          </div>
          <footer>
            <button className="btn" onClick={close}>
              取消
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? (
                <LoadingState variant="inline" label="正在处理…" />
              ) : (
                "应用"
              )}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
